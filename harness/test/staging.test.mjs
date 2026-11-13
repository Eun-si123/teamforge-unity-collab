import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentStage, stageVerifiedCandidate } from '../pool/staging.mjs';
import { sourceHead } from '../adapters/git.mjs';
import { dockerWorkspaceUser } from '../core/workspace.mjs';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'harness-stage-test-'));
  const src = join(home, 'source');
  const evalDir = join(home, 'private-evaluator');
  const stages = join(home, 'local-stages');
  mkdirSync(join(src, 'src'), { recursive: true });
  mkdirSync(join(src, 'test'));
  mkdirSync(evalDir, { mode: 0o700 });
  mkdirSync(stages, { mode: 0o700 });
  const original = 'export function add(a, b) { return a - b; }\n' +
    'export function subtract(a, b) { return a - b; }\n';
  writeFileSync(join(src, 'src', 'math.mjs'), original);
  writeFileSync(join(src, 'test', 'contract.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { add } from '../src/math.mjs';",
    "test('addition', () => assert.equal(add(2, 3), 5));",
  ].join('\n') + '\n');
  execFileSync('git', ['init', '-q', '-b', 'main', src]);
  execFileSync('git', ['-C', src, 'add', '.']);
  execFileSync('git', ['-C', src, '-c', 'user.name=Test', '-c',
    'user.email=test@example.invalid', 'commit', '-qm', 'arithmetic baseline']);
  writeFileSync(join(evalDir, 'regression.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { subtract } from '/workspace/src/math.mjs';",
    "test('regression', () => assert.equal(subtract(9, 6), 3));",
  ].join('\n') + '\n');
  writeFileSync(join(evalDir, 'holdout.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { add } from '/workspace/src/math.mjs';",
    "test('holdout', () => assert.equal(add(2, 3), 5));",
  ].join('\n') + '\n');
  const patch = [
    'diff --git a/src/math.mjs b/src/math.mjs',
    '--- a/src/math.mjs', '+++ b/src/math.mjs',
    '@@ -1,2 +1,2 @@',
    '-export function add(a, b) { return a - b; }',
    '+export function add(a, b) { return a + b; }',
    ' export function subtract(a, b) { return a - b; }',
    '',
  ].join('\n');
  const patchFile = join(home, 'proposed.patch');
  writeFileSync(patchFile, patch, { mode: 0o600 });
  const policy = {
    editableFiles: ['src/math.mjs'],
    protectedFiles: ['test/contract.test.mjs'],
    testFile: 'test/contract.test.mjs', maxRounds: 1, repeat: 1,
    cases: [
      { id: 'regression_contract', group: 'regression', image: 'node:24-bookworm-slim',
        argv: ['node', '--test', '/evaluator/regression.test.mjs'], expect: 'tests 1' },
      { id: 'holdout_addition', group: 'holdout', image: 'node:24-bookworm-slim',
        argv: ['node', '--test', '/evaluator/holdout.test.mjs'], expect: 'tests 1' },
    ],
  };
  return { home, src, stages, evalDir, original, policy, patchFile,
    patchSha: createHash('sha256').update(patch).digest('hex') };
}

test('offline verifier uses non-root caller ownership instead of fixed UID 1000', () => {
  const id = dockerWorkspaceUser();
  const parts = id.split(':').map(Number);
  assert.equal(parts.length, 2);
  assert.equal(parts[0], process.getuid());
  assert.equal(parts[1], process.getgid());
  assert.ok(parts[0] > 0);
});

test('stage promotion verifies patch SHA before any source changes', () => {
  const f = fixture();
  try {
    assert.equal(currentStage(f.stages), null);
    assert.throws(() => stageVerifiedCandidate({
      source: f.src, ref: 'main', expectedSha: sourceHead(f.src, 'main'),
      patchFile: f.patchFile, patchSha: 'a'.repeat(64),
      policy: f.policy, evaluatorDirectory: f.evalDir,
      stagingRoot: f.stages,
    }), /integrity mismatch/);
    assert.equal(currentStage(f.stages), null);
    assert.equal(readFileSync(join(f.src, 'src', 'math.mjs'), 'utf8'), f.original);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('independent regression/holdout and protected project test gate local promotion', {
  skip: process.env.HARNESS_INTEGRATION !== '1' ? 'Requires preloaded Docker image' : false,
  timeout: 90_000,
}, () => {
  const f = fixture();
  try {
    const originalSha = sourceHead(f.src, 'main');
    const r = stageVerifiedCandidate({
      source: f.src, ref: 'main', expectedSha: originalSha,
      patchFile: f.patchFile, patchSha: f.patchSha,
      policy: f.policy, evaluatorDirectory: f.evalDir,
      stagingRoot: f.stages, model: 'independent-fixture-model',
      expectedScore: 2,
    });
    assert.equal(r.scoreBefore, 1);
    assert.equal(r.scoreAfter, 2);
    assert.equal(r.total, 2);
    assert.equal(r.published, false);
    assert.equal(r.ref, 'harness-stage');
    assert.equal(currentStage(f.stages).sha, r.sha);
    assert.equal(sourceHead(f.src, 'main'), originalSha);
    assert.equal(readFileSync(join(f.src, 'src', 'math.mjs'), 'utf8'), f.original);
    assert.ok(readFileSync(join(r.repo, 'src', 'math.mjs'), 'utf8').includes('return a + b'));
    assert.throws(() => stageVerifiedCandidate({
      source: f.src, ref: 'main', expectedSha: originalSha,
      patchFile: f.patchFile, patchSha: f.patchSha,
      policy: f.policy, evaluatorDirectory: f.evalDir, stagingRoot: f.stages,
    }), /newer local stage exists/);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});
