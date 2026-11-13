/**
 * Frozen, evaluator-owned offline measurements. The agent never receives
 * this bundle or its source code and cannot edit the scoring function.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { exec } from '../core/workspace.mjs';

const CASE_NAME = /^[a-z][a-z0-9_-]{2,60}$/;
const IMAGE = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{1,220}$/;
const MAX_BUNDLE_BYTES = 2_000_000;
const MAX_BUNDLE_FILES = 100;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'cmd', 'powershell', 'pwsh']);
export function loadBenchmarkPolicy(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.cases) ||
      value.cases.length < 2 || value.cases.length > 12) {
    throw new Error('Benchmark needs 2–12 independent cases');
  }
  if (!Array.isArray(value.editableFiles) || value.editableFiles.length < 1 ||
      value.editableFiles.length > 6 || !Array.isArray(value.protectedFiles)) {
    throw new Error('Benchmark requires explicit editableFiles and protectedFiles');
  }
  if (value.maxRounds !== undefined && (!Number.isInteger(value.maxRounds) ||
      value.maxRounds < 1 || value.maxRounds > 3)) {
    throw new Error('Improvement rounds must be integer 1–3');
  }
  if (value.repeat !== undefined && ![1, 2].includes(value.repeat)) {
    throw new Error('Benchmark repetition must be 1 or 2');
  }
  const cases = [], seen = new Set();
  for (const item of value.cases) {
    if (!CASE_NAME.test(item?.id || '') || seen.has(item.id) ||
        !['regression', 'holdout'].includes(item.group) ||
        typeof item.image !== 'string' || !IMAGE.test(item.image) ||
        !Array.isArray(item.argv) || !item.argv.length || item.argv.length > 16 ||
        item.argv.some(x => typeof x !== 'string' || !x || x.length > 250 ||
          /[\r\n\0]/.test(x)) ||
        SHELLS.has(item.argv[0].split('/').at(-1)) ||
        typeof item.expect !== 'string' || item.expect.length < 4 || item.expect.length > 180 ||
        !Number.isSafeInteger(item.timeoutMs ?? 90_000) ||
        (item.timeoutMs ?? 90_000) < 3_000 || (item.timeoutMs ?? 90_000) > 180_000) {
      throw new Error('Invalid or duplicate benchmark case');
    }
    seen.add(item.id);
    cases.push({ id: item.id, group: item.group, image: item.image, argv: [...item.argv],
      expect: item.expect, timeoutMs: item.timeoutMs ?? 90_000 });
  }
  if (!cases.some(x => x.group === 'holdout') || !cases.some(x => x.group === 'regression')) {
    throw new Error('Need both held-out and regression tests');
  }
  return Object.freeze({
    editableFiles: [...value.editableFiles],
    protectedFiles: [...value.protectedFiles],
    maxRounds: value.maxRounds ?? 2,
    repeat: value.repeat ?? 2,
    cases,
  });
}

export function hashBenchmarkDirectory(dir) {
  const root = resolve(dir);
  if (!existsSync(root) || !lstatSync(root).isDirectory() || realpathSync(root) !== root) {
    throw new Error('Evaluator bundle must be a real directory, not a symlink');
  }
  const digest = createHash('sha256');
  let count = 0, bytes = 0;
  function walk(parent) {
    for (const name of readdirSync(parent).sort()) {
      const path = join(parent, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !(stat.isFile() || stat.isDirectory())) {
        throw new Error('Evaluator bundle cannot contain symlinks or special files');
      }
      if (stat.isDirectory()) { walk(path); continue; }
      count++;
      bytes += stat.size;
      if (count > MAX_BUNDLE_FILES || bytes > MAX_BUNDLE_BYTES) {
        throw new Error('Evaluator bundle exceeds fixed limits');
      }
      digest.update(relative(root, path) + '\0');
      digest.update(readFileSync(path));
    }
  }
  walk(root);
  if (!count) throw new Error('Evaluator bundle is empty');
  return digest.digest('hex');
}

export function compareScores(before, after) {
  if (before?.cases?.length !== after?.cases?.length || !before?.cases?.length) {
    throw new Error('Benchmark identity/length changed');
  }
  const gained = [], regressed = [];
  for (let i = 0; i < before.cases.length; i++) {
    const a = before.cases[i], b = after.cases[i];
    if (a.id !== b.id || a.group !== b.group ||
        (a.imageId !== undefined || b.imageId !== undefined) && a.imageId !== b.imageId) {
      throw new Error('Benchmark case/image identity changed');
    }
    if (a.ok && !b.ok) regressed.push(a.id);
    if (!a.ok && b.ok) gained.push(a.id);
  }
  return {
    accepted: gained.length > 0 && regressed.length === 0,
    scoreBefore: before.cases.filter(x => x.ok).length,
    scoreAfter: after.cases.filter(x => x.ok).length,
    gained, regressed,
  };
}

export function runBenchmark({
  workspace, evaluatorDirectory, policy, expectedHash,
  execImpl = exec,
}) {
  const root = realpathSync(workspace);
  const evalDir = realpathSync(evaluatorDirectory);
  if (root === evalDir || root.startsWith(evalDir + '/') || evalDir.startsWith(root + '/')) {
    throw new Error('Evaluator and candidate workspace must be separate');
  }
  const actualHash = hashBenchmarkDirectory(evalDir);
  if (actualHash !== expectedHash) throw new Error('Independent evaluator changed');
  const result = [];
  for (const item of policy.cases) {
    // Image must already be provisioned; never pull during an improvement run.
    const inspect = execImpl('docker', [
      'image', 'inspect', item.image, '--format', '{{.Id}}',
    ], { timeout: 20_000 });
    const imageId = String(inspect.stdout || '').trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Unverified Docker image identity');
    const attempts = [];
    for (let rep = 0; rep < policy.repeat; rep++) {
      const proc = execImpl('docker', [
        'run', '--rm', '--network', 'none', '--read-only',
        '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '96', '--memory', '1g', '--cpus', '1',
        '--user', '1000:1000', '--tmpfs', '/tmp:rw,nosuid,nodev,size=96m',
        '-v', root + ':/workspace:ro', '-v', evalDir + ':/evaluator:ro',
        '-w', '/workspace', item.image, ...item.argv,
      ], { check: false, timeout: item.timeoutMs, maxBuffer: 600_000 });
      if (proc.status === null || proc.signal) {
        throw new Error('Evaluator infrastructure failed for ' + item.id);
      }
      const output = proc.stdout + '\\n' + proc.stderr;
      attempts.push(proc.status === 0 && output.includes(item.expect));
    }
    result.push({ id: item.id, group: item.group, imageId, ok: attempts.every(Boolean) });
    if (hashBenchmarkDirectory(evalDir) !== expectedHash) {
      throw new Error('Evaluator changed while scoring');
    }
  }
  return { score: result.filter(x => x.ok).length, total: result.length, cases: result,
    evaluatorHash: expectedHash };
}
