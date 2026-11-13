import { spawnSync } from 'node:child_process';
import { readFileSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const MAX_FILE = 24_000, MAX_PATCH = 24_000;
const BAD = /^(?:\.git|\.env(?:\..*)?|\.npmrc|\.pypirc|secrets?(?:\..*)?|credentials?(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:key|pem|p12|pfx))$/i;
const PATH = /^[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*$/;

export function safePath(path) {
  if (typeof path !== 'string' || !PATH.test(path) ||
      path.split('/').some(s => s === '.' || s === '..' || BAD.test(s))) {
    throw new Error('Unsafe relative source path');
  }
  return path;
}
export function selectedFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 6) throw new Error('Select 1–6 files');
  const unique = [...new Set(files.map(safePath))];
  // Generic guard: do not let models edit hidden tooling/CI/policy directories.
  if (unique.some(x => x.split('/').some(part => part.startsWith('.')))) {
    throw new Error('Hidden configuration and control paths cannot be edited');
  }
  return unique;
}
export function exec(cmd, args, opts = {}) {
  const p = spawnSync(cmd, args, {
    cwd: opts.cwd, input: opts.input, encoding: 'utf8', shell: false,
    timeout: opts.timeout || 30_000, maxBuffer: opts.maxBuffer || 1_500_000,
    // Bound Go CLI threads on shared CI/homelab runners; model never controls env.
    env: opts.env || (cmd === 'docker' ? { ...process.env, GOMAXPROCS: '2' } : process.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (p.error) throw new Error(cmd + ': ' + (p.error.code || 'spawn failed'));
  if (p.signal) throw new Error(cmd + ': killed by ' + p.signal + ' ' + (p.stderr || '').slice(-600));
  if (p.status !== 0 && opts.check !== false) throw new Error(cmd + ' exited ' + p.status + ': ' + p.stderr.slice(0, 320));
  return p;
}
function git(root, ...args) { return exec('git', args, { cwd: root }).stdout; }

function validatePatch(raw, allowed) {
  if (typeof raw !== 'string' || !raw || Buffer.byteLength(raw) > MAX_PATCH ||
      raw.includes('\0') || /(?:^|\n)(?:new file mode|deleted file mode|rename |copy |GIT binary patch|Binary files|old mode|new mode)/.test(raw)) {
    throw new Error('Unsupported or oversized patch');
  }
  if (/^--- \/dev\/null$|^\+\+\+ \/dev\/null$/m.test(raw)) throw new Error('File creation/deletion refused');
  const headers = [...raw.matchAll(/^diff --git a\/([^\n]+) b\/([^\n]+)$/gm)];
  if (!headers.length || headers.length > 6 || !/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(raw)) {
    throw new Error('Expected a bounded unified diff');
  }
  const seen = new Set();
  for (const [, left, right] of headers) {
    safePath(left); safePath(right);
    if (left !== right || !allowed.has(left) || seen.has(left)) throw new Error('Out-of-scope or duplicate patch target');
    if (!raw.includes('--- a/' + left + '\n') || !raw.includes('+++ b/' + right + '\n')) {
      throw new Error('Patch header mismatch');
    }
    seen.add(left);
  }
  const changes = [...raw.matchAll(/^(?:---|\+\+\+) ([^\n]+)$/gm)];
  if (changes.length !== headers.length * 2) throw new Error('Unexpected patch source/destination');
  return [...seen];
}

export function normalizeVerification(spec, testFile) {
  if (!spec) return {
    image: 'node:24-bookworm-slim',
    command: ['node', '--test', testFile],
    expectedText: null,
    timeoutMs: 160000,
  };
  if (typeof spec !== 'object' || Array.isArray(spec) ||
      typeof spec.image !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{1,230}$/.test(spec.image) ||
      !Array.isArray(spec.command) || !spec.command.length || spec.command.length > 20 ||
      spec.command.some(x => typeof x !== 'string' || !x || x.length > 280 ||
        /[\0\r\n]/.test(x)) ||
      typeof spec.expectedText !== 'string' || spec.expectedText.length < 5 ||
      spec.expectedText.length > 160) {
    throw new Error('Verification requires explicit image, argv and observable success marker');
  }
  if (!Number.isFinite(spec.timeoutMs ?? 120000) ||
      (spec.timeoutMs ?? 120000) < 3000 || (spec.timeoutMs ?? 120000) > 240000) {
    throw new Error('Verification timeout outside approved bounds');
  }
  if (['sh', 'bash', 'zsh', 'cmd', 'powershell', 'pwsh'].includes(spec.command[0].split('/').at(-1))) {
    throw new Error('Shell as the verifier is not allowed');
  }
  return {
    image: spec.image, command: spec.command,
    expectedText: spec.expectedText, timeoutMs: spec.timeoutMs ?? 120000,
  };
}

export class Workspace {
  constructor({ root, files, testFile, verification }) {
    this.root = realpathSync(root);
    this.files = selectedFiles(files);
    this.allowed = new Set(this.files);
    this.testFile = safePath(testFile);
    if (this.allowed.has(this.testFile)) throw new Error('AI cannot edit its own verification test');
    this.verification = normalizeVerification(verification, testFile);
    this.tracked = new Set(git(this.root, 'ls-files', '-z').split('\0').filter(Boolean));
    for (const f of [...this.files, this.testFile]) this.file(f);
    this.patchCount = 0;
    this.lastTestPassed = false;
    this.testRuns = 0;
  }
  file(p) {
    safePath(p);
    if (!this.tracked.has(p)) throw new Error('File not tracked in immutable checkout: ' + p);
    const full = resolve(this.root, p);
    if (!full.startsWith(this.root + '/')) throw new Error('Path escaped checkout');
    let at = this.root;
    for (const seg of p.split('/')) {
      at = join(at, seg);
      if (lstatSync(at).isSymbolicLink()) throw new Error('Symlink path denied');
    }
    if (realpathSync(full) !== full || !statSync(full).isFile()) throw new Error('Source file denied');
    return full;
  }
  listFiles({ prefix = '' } = {}) {
    if (typeof prefix !== 'string' || prefix.length > 180) throw new Error('Bad prefix');
    if (prefix && !PATH.test(prefix)) throw new Error('Bad prefix');
    return { ok: true, total: this.tracked.size, files: [...this.tracked].filter(x => x.startsWith(prefix) && !x.split('/').some(s => BAD.test(s))).slice(0, 80) };
  }
  readFile({ path }) {
    const full = this.file(path);
    const size = statSync(full).size;
    if (size > MAX_FILE) return { ok: false, error: 'file over 24KB; select narrower task' };
    return { ok: true, path, content: readFileSync(full, 'utf8') };
  }
  searchText({ query, prefix = '' }) {
    if (typeof query !== 'string' || query.length < 2 || query.length > 100 || /[\0\r\n]/.test(query)) throw new Error('Bad search query');
    if (prefix && (!PATH.test(prefix) || prefix.length > 180)) throw new Error('Bad search prefix');
    const found = [];
    for (const file of [...this.tracked].slice(0, 1500)) {
      if (!file.startsWith(prefix) || file.split('/').some(s => BAD.test(s))) continue;
      try {
        const path = this.file(file);
        if (statSync(path).size > MAX_FILE) continue;
        const lines = readFileSync(path, 'utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) found.push({ path: file, line: i + 1, text: lines[i].slice(0, 180) });
          if (found.length >= 30) return { ok: true, matches: found, truncated: true };
        }
      } catch { /* no access to symlinks, binary or vanished files */ }
    }
    return { ok: true, matches: found, truncated: false };
  }
  changedPaths() {
    const status = git(this.root, 'diff', '--name-status', '--no-renames').trim().split('\n').filter(Boolean);
    const modified = status.map(x => {
      const [flag, p] = x.split('\t');
      if (flag !== 'M' || !this.allowed.has(p)) throw new Error('Unexpected tracked modification');
      this.file(p);
      return p;
    });
    if (git(this.root, 'ls-files', '--others', '--exclude-standard').trim()) throw new Error('Untracked generated files present');
    if (modified.length > this.allowed.size) throw new Error('Excessive changes');
    return modified;
  }
  applyPatch({ patch }) {
    if (this.patchCount >= 3) throw new Error('Patch attempts exhausted');
    validatePatch(patch, this.allowed);
    exec('git', ['apply', '--check', '--whitespace=error', '-'], { cwd: this.root, input: patch });
    exec('git', ['apply', '--whitespace=error', '-'], { cwd: this.root, input: patch });
    this.patchCount++;
    this.lastTestPassed = false;
    const changed = this.changedPaths();
    return { ok: true, changed, patchCount: this.patchCount };
  }
  runTests() {
    const changed = this.changedPaths();
    if (!changed.length) return { ok: false, error: 'No patch to test' };
    exec('git', ['diff', '--check'], { cwd: this.root });
    for (const file of changed.filter(x => /\.(?:mjs|cjs|js)$/.test(x))) {
      const v = exec('node', ['--check', file], { cwd: this.root, check: false, timeout: 12_000 });
      if (v.status !== 0) { this.lastTestPassed = false; return { ok: false, error: 'Syntax check failed: ' + file }; }
    }
    const verify = this.verification;
    // Never download an unapproved image during verification.
    exec('docker', ['image', 'inspect', verify.image], { timeout: 12000 });
    const p = exec('docker', [
      'run', '--rm', '--network', 'none', '--read-only',
      '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '96', '--memory', '1g', '--cpus', '1',
      '--user', '1000:1000', '--tmpfs', '/tmp:rw,nosuid,nodev,size=96m',
      '-v', this.root + ':/workspace:ro', '-w', '/workspace',
      verify.image, ...verify.command,
    ], { check: false, timeout: verify.timeoutMs, maxBuffer: 600_000 });
    this.testRuns++;
    const report = (p.stdout + '\n' + p.stderr).slice(-4200);
    const testCount = /(?:^|\n)[#ℹ]\s*tests\s+(\d+)/m.exec(report);
    this.lastTestPassed = p.status === 0 && (verify.expectedText
      ? report.includes(verify.expectedText) : !!testCount && Number(testCount[1]) > 0);
    return { ok: this.lastTestPassed, exitCode: p.status, testRuns: this.testRuns, report };
  }
}
export function workspaceTools(workspace, mode = 'review') {
  const entries = [
    { name: 'list_files', description: 'List tracked project paths (up to 80).', properties: { prefix: { type: 'string' } }, required: [], execute: a => workspace.listFiles(a) },
    { name: 'read_file', description: 'Read one tracked source file, max 24 KB.', properties: { path: { type: 'string' } }, required: ['path'], execute: a => workspace.readFile(a) },
    { name: 'search_text', description: 'Find exact text in tracked source files.', properties: { query: { type: 'string' }, prefix: { type: 'string' } }, required: ['query'], execute: a => workspace.searchText(a) },
  ];
  if (mode === 'develop') {
    entries.push(
      { name: 'apply_patch', description: 'Apply a standard git unified diff to preapproved existing source files only.', properties: { patch: { type: 'string' } }, required: ['patch'], execute: a => workspace.applyPatch(a) },
      { name: 'run_tests', description: 'Run the trusted configured verifier in isolated network-disabled Docker.', properties: {}, required: [], execute: () => workspace.runTests() },
    );
  }
  return entries.map(x => ({
    type: 'function',
    function: { name: x.name, description: x.description, parameters: {
      type: 'object', additionalProperties: false, properties: x.properties, required: x.required,
    } },
    execute: x.execute,
  }));
}
