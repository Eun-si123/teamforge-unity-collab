/**
 * Local-only promotion gate: independently re-score a model-generated patch,
 * run the repository's protected tests, then commit into an isolated staging
 * Git repository. Never changes/merges/pushes the user's source checkout.
 */
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
  renameSync, rmSync, realpathSync, lstatSync, statSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { Workspace, exec } from '../core/workspace.mjs';
import { clonePinned, ensureUnchanged, git, validateGitRef, validateGitSource } from '../adapters/git.mjs';
import { hashBenchmarkDirectory, runBenchmark, compareScores } from '../improve/benchmark.mjs';
import { validateImprovementPolicy } from '../improve/runner.mjs';

function privateRoot(root) {
  if (!isAbsolute(root)) throw new Error('Stage root must be absolute');
  if (!existsSync(root)) mkdirSync(root, { recursive: true, mode: 0o700 });
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) ||
      typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error('Stage root must be a real private directory (chmod 700)');
  }
  return realpathSync(root);
}
function atomicJson(file, data) {
  const temp = file + '.new-' + process.pid;
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' });
    renameSync(temp, file);
  } finally { if (existsSync(temp)) rmSync(temp, { force: true }); }
}
export function currentStage(stagingRoot) {
  if (!existsSync(stagingRoot)) return null;
  const root = privateRoot(stagingRoot);
  const file = join(root, 'current.json');
  if (!existsSync(file)) return null;
  const stats = lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o077) ||
      stats.size > 8192) throw new Error('Unsafe current stage pointer');
  const row = JSON.parse(readFileSync(file, 'utf8'));
  if (row.schema !== 1 || typeof row.repo !== 'string' ||
      !row.repo.startsWith(root + '/') || !/^[a-f0-9]{40}$/.test(row.sha) ||
      row.ref !== 'harness-stage') throw new Error('Invalid current stage pointer');
  if (!existsSync(row.repo) || realpathSync(row.repo) !== row.repo) {
    throw new Error('Staging repository disappeared/changed');
  }
  const actual = git(['rev-parse', 'refs/heads/harness-stage'], row.repo);
  if (actual !== row.sha) throw new Error('Staging repository changed since promotion');
  return row;
}
export function stageVerifiedCandidate({
  source, ref, expectedSha, patchFile, patchSha, policy,
  evaluatorDirectory, stagingRoot, model = 'operator-selected',
  expectedScore,
}) {
  validateGitSource(source);
  validateGitRef(ref);
  const p = validateImprovementPolicy(policy);
  if (!/^[a-f0-9]{40}$/.test(expectedSha || '') ||
      !/^[a-f0-9]{64}$/.test(patchSha || '')) {
    throw new Error('Source and patch SHA identifiers required');
  }
  const root = privateRoot(stagingRoot);
  const frozenHash = hashBenchmarkDirectory(evaluatorDirectory);
  const pathInfo = lstatSync(patchFile);
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink() || (pathInfo.mode & 0o077) ||
      pathInfo.size < 20 || pathInfo.size > 30_000) {
    throw new Error('Unsafe proposed patch artifact');
  }
  const patch = readFileSync(patchFile, 'utf8');
  if (createHash('sha256').update(patch).digest('hex') !== patchSha) {
    throw new Error('Proposed patch integrity mismatch');
  }
  const current = currentStage(root);
  if (current && (source !== current.repo || ref !== current.ref ||
      expectedSha !== current.sha)) {
    throw new Error('A newer local stage exists; use its pinned HEAD as source');
  }
  ensureUnchanged({ source, ref, expected: expectedSha });
  const stage = mkdtempSync(join(root, 'revision-'));
  const dest = join(stage, 'repository');
  try {
    const base = clonePinned({ source, ref, target: dest });
    if (base !== expectedSha) throw new Error('Cloned source no longer matches pinned HEAD');
    const w = new Workspace({ root: dest, files: p.editableFiles,
      testFile: p.testFile, verification: p.protectedVerification });
    const before = runBenchmark({ workspace: dest, evaluatorDirectory,
      policy: p, expectedHash: frozenHash });
    exec('git', ['apply', '--check', '--whitespace=error', '-'],
      { cwd: dest, input: patch });
    exec('git', ['apply', '--whitespace=error', '-'],
      { cwd: dest, input: patch });
    const changed = w.changedPaths();
    if (!changed.length) throw new Error('No allowed candidate source change');
    git(['diff', '--check'], dest);
    const independent = w.runTests();
    if (!independent.ok) throw new Error('Protected project tests failed during promotion');
    const after = runBenchmark({ workspace: dest, evaluatorDirectory,
      policy: p, expectedHash: frozenHash });
    const difference = compareScores(before, after);
    if (!difference.accepted || expectedScore !== undefined && after.score !== expectedScore) {
      throw new Error('Candidate did not reproduce the measured improvement');
    }
    ensureUnchanged({ source, ref, expected: expectedSha });
    if (ref !== 'harness-stage') git(['checkout', '-b', 'harness-stage'], dest);
    git(['add', '--update'], dest);
    git(['-c','user.name=Portable Harness Agent',
      '-c','user.email=portable-harness@example.invalid',
      'commit','-m','improve: independently benchmarked local candidate',
      '-m','Co-authored-by: Verified Harness Candidate <ai-assisted@users.noreply.github.com>'], dest);
    const sha = git(['rev-parse', 'HEAD'], dest);
    const pointer = { schema: 1, repo: dest, ref: 'harness-stage', sha,
      parentSha: expectedSha, patchSha, evaluatorHash: frozenHash,
      scoreBefore: before.score, scoreAfter: after.score, total: after.total,
      model: String(model).slice(0, 180), createdAt: new Date().toISOString(),
      published: false };
    // Only an operator/trusted worker can update this pointer. Model cannot.
    atomicJson(join(root, 'current.json'), pointer);
    return pointer;
  } catch (error) {
    rmSync(stage, { force: true, recursive: true });
    throw error;
  }
}
