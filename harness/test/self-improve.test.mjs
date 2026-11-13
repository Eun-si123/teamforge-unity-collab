import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareScores, hashBenchmarkDirectory, loadBenchmarkPolicy, runBenchmark } from '../improve/benchmark.mjs';
import { parseImproveArgs, validateImprovementPolicy, priorImprovementHistory, selfImprove, main } from '../improve/runner.mjs';

const IMG = 'node:24-bookworm-slim';
const ROOT = 'src/math.mjs';
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'portable-self-improve-test-'));
  const repo = join(home, 'repository'), evalDir = join(home, 'eval'), state = join(home, 'state');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'test'));
  mkdirSync(evalDir);
  mkdirSync(state, { mode: 0o700 });
  const code = [
    'export function add(a, b) { return a - b; }',
    'export function multiply(a, b) { return a + b; }',
    'export function subtract(a, b) { return a - b; }',
    '',
  ].join('\n');
  writeFileSync(join(repo, ROOT), code);
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\ntest('smoke', () => {});\n");
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Harness Test', '-c',
    'user.email=test@example.invalid', 'commit', '-qm', 'initial buggy implementation']);
  for (const [id, name, expected, left, right] of [
    ['substract_regression', 'subtract', 3, 9, 6],
    ['addition_holdout', 'add', 5, 2, 3],
    ['multiply_holdout', 'multiply', 12, 3, 4],
  ]) {
    writeFileSync(join(evalDir, id + '.test.mjs'),
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { " + name + " } from '/workspace/src/math.mjs';",
        "test('" + id + "', () => assert.equal(" + name +
          '(' + left + ', ' + right + '), ' + expected + '));',
        '',
      ].join('\n'));
  }
  const policy = {
    editableFiles: [ROOT],
    protectedFiles: ['test/smoke.test.mjs'],
    testFile: 'test/smoke.test.mjs', maxRounds: 2, repeat: 1,
    cases: [
      { id: 'substract_regression', group: 'regression', image: IMG,
        argv: ['node', '--test', '/evaluator/substract_regression.test.mjs'],
        expect: 'tests 1', timeoutMs: 30000 },
      { id: 'addition_holdout', group: 'holdout', image: IMG,
        argv: ['node', '--test', '/evaluator/addition_holdout.test.mjs'],
        expect: 'tests 1', timeoutMs: 30000 },
      { id: 'multiply_holdout', group: 'holdout', image: IMG,
        argv: ['node', '--test', '/evaluator/multiply_holdout.test.mjs'],
        expect: 'tests 1', timeoutMs: 30000 },
    ],
  };
  return { home, repo, evalDir, state, code, policy };
}
function patchFor(operation) {
  const before = operation === 'add'
    ? 'export function add(a, b) { return a - b; }'
    : 'export function multiply(a, b) { return a + b; }';
  const after = operation === 'add'
    ? 'export function add(a, b) { return a + b; }'
    : 'export function multiply(a, b) { return a * b; }';
  const addPatch = [
    'diff --git a/src/math.mjs b/src/math.mjs',
    '--- a/src/math.mjs', '+++ b/src/math.mjs',
    '@@ -1,2 +1,2 @@',
    '-' + before, '+' + after,
    ' export function multiply(a, b) { return a + b; }', '',
  ].join('\n');
  const multiplyPatch = [
    'diff --git a/src/math.mjs b/src/math.mjs',
    '--- a/src/math.mjs', '+++ b/src/math.mjs',
    '@@ -2,2 +2,2 @@',
    '-' + before, '+' + after,
    ' export function subtract(a, b) { return a - b; }', '',
  ].join('\n');
  return operation === 'add' ? addPatch : multiplyPatch;
}
function regressionPatch() {
  return [
    'diff --git a/src/math.mjs b/src/math.mjs',
    '--- a/src/math.mjs', '+++ b/src/math.mjs',
    '@@ -2,2 +2,2 @@',
    '-export function multiply(a, b) { return a + b; }',
    '+export function multiply(a, b) { return a * b; }',
    '-export function subtract(a, b) { return a - b; }',
    '+export function subtract(a, b) { return a + b; }', '',
  ].join('\n');
}
function doublePatchModel({ sabotageSecond = false } = {}) {
  let rounds = 0;
  return async messages => {
    const recent = messages.at(-1);
    if (messages.length === 2) {
      // The runner preloads only the explicitly editable source to avoid
      // repetitive tool calls that exhaust the model's finite budget.
      assert.match(messages[1].content, /Approved source snapshots/);
      assert.match(messages[1].content, /export function add/);
      rounds++;
    }
    if (recent.role === 'user') return {
      model: 'fixture-agent',
      message: { role: 'assistant', content: null, tool_calls: [{
        id: 'read_' + rounds, type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: ROOT }) },
      }] },
    };
    if (recent.role === 'tool' && recent.name === 'read_file') return {
      model: 'fixture-agent',
      message: { role: 'assistant', content: null, tool_calls: [{
        id: 'edit_' + rounds, type: 'function',
        function: { name: 'apply_patch', arguments: JSON.stringify({
          patch: rounds === 2 && sabotageSecond ? regressionPatch() : patchFor(rounds === 1 ? 'add' : 'multiply'),
        }) },
      }] },
    };
    return { model: 'fixture-agent', message: { role: 'assistant', content: 'Proposed a patch for independent verification.' } };
  };
}

test('evaluation never accepts a regression, score inflation or a changed case list', () => {
  const base = { cases: [
    { id: 'reg', group: 'regression', ok: true },
    { id: 'hold', group: 'holdout', ok: false },
  ]};
  assert.deepEqual(compareScores(base, { cases: [
    { id: 'reg', group: 'regression', ok: true },
    { id: 'hold', group: 'holdout', ok: true },
  ]}).accepted, true);
  const worse = compareScores(base, { cases: [
    { id: 'reg', group: 'regression', ok: false },
    { id: 'hold', group: 'holdout', ok: true },
  ]});
  assert.equal(worse.accepted, false);
  assert.deepEqual(worse.regressed, ['reg']);
  assert.throws(() => compareScores(base, { cases: [
    { id: 'OTHER', group: 'regression', ok: true },
    { id: 'hold', group: 'holdout', ok: true },
  ]}), /identity/);
  assert.throws(() => compareScores({ cases: [
    { id: 'reg', group: 'regression', imageId: 'sha256:' + 'a'.repeat(64), ok: true },
  ]}, { cases: [
    { id: 'reg', group: 'regression', imageId: 'sha256:' + 'b'.repeat(64), ok: true },
  ]}), /identity/);
});

test('noneditable checks, strict budgets and held-out evaluator are mandatory', () => {
  const f = fixture();
  try {
    assert.equal(loadBenchmarkPolicy(f.policy).maxRounds, 2);
    assert.throws(() => loadBenchmarkPolicy({ ...f.policy, maxRounds: 3.5 }), /rounds/);
    assert.throws(() => loadBenchmarkPolicy({ ...f.policy, repeat: 0 }), /repetition/);
    assert.equal(validateImprovementPolicy(f.policy).editableFiles[0], ROOT);
    assert.throws(() => validateImprovementPolicy({
      ...f.policy, editableFiles: ['test/smoke.test.mjs'],
    }), /noneditable/);
    assert.throws(() => validateImprovementPolicy({
      ...f.policy, editableFiles: ['harness/improve/runner.mjs'],
    }), /evaluator/);
    assert.throws(() => validateImprovementPolicy({
      ...f.policy, cases: f.policy.cases.filter(x => x.group === 'holdout'),
    }), /both/);
    assert.throws(() => parseImproveArgs(['propose', '--publish']), /Require/);
    assert.equal(hashBenchmarkDirectory(f.evalDir).length, 64);
    const first = hashBenchmarkDirectory(f.evalDir);
    writeFileSync(join(f.evalDir, 'addition_holdout.test.mjs'), 'modified evaluator\n');
    assert.notEqual(hashBenchmarkDirectory(f.evalDir), first);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('skipped Node tests cannot masquerade as evaluator improvement', () => {
  const f = fixture();
  try {
    const policy = loadBenchmarkPolicy(f.policy);
    const digest = 'sha256:' + 'c'.repeat(64);
    const result = runBenchmark({
      workspace: f.repo, evaluatorDirectory: f.evalDir, policy,
      expectedHash: hashBenchmarkDirectory(f.evalDir),
      execImpl: (_command, args) => {
        if (args.includes('inspect')) return { status: 0, stdout: digest, stderr: '' };
        return { status: 0, signal: null,
          stdout: ['ℹ tests 1', 'ℹ pass 0', 'ℹ fail 0', 'ℹ skipped 1'].join(String.fromCharCode(10)),
          stderr: '' };
      },
    });
    assert.equal(result.score, 0);
    assert.equal(result.cases.every(x => x.ok === false), true);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('prior run receipts are private, durable and sanitized before feedback', () => {
  const f = fixture();
  try {
    const id = 'a'.repeat(28);
    const path = join(f.state, id + '.123456789abc.json');
    writeFileSync(path, JSON.stringify({
      id, status: 'candidate_ready', bestScore: 2,
      baseSha: 'b'.repeat(40),
      rounds: [{ status: 'accepted' }, { status: 'rejected' }],
      modelSecret: 'not-for-model',
    }), { mode: 0o600 });
    const history = priorImprovementHistory(f.state, id);
    assert.equal(history.length, 1);
    assert.equal(history[0].score, 2);
    assert.deepEqual(history[0].attempts, ['accepted', 'rejected']);
    assert.equal(JSON.stringify(history).includes('not-for-model'), false);
    const bad = join(f.state, id + '.abcdefabcdef.json');
    symlinkSync(path, bad);
    assert.throws(() => priorImprovementHistory(f.state, id), /Unsafe history receipt/);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('read-only improvement plan requires no credentials and changes nothing', async () => {
  const f = fixture();
  try {
    const p = join(f.home, 'policy.json'), task = join(f.home, 'task.txt'), config = join(f.home, 'config.json');
    writeFileSync(p, JSON.stringify(f.policy));
    writeFileSync(task, 'Improve code for hidden evaluation without modifying tests.');
    writeFileSync(config, JSON.stringify({ models: [], sourceDisclosureApproved: false }));
    const result = await main(['plan', '--source', f.repo, '--ref', 'main',
      '--config', config, '--policy', p, '--eval-dir', f.evalDir, '--task-file', task]);
    assert.equal(result.status, 'PLAN_ONLY');
    assert.equal(result.cases.length, 3);
    assert.equal(existsSync(join(f.state, 'journal.json')), false);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('two recursive improvements: 1/3 -> 2/3 -> 3/3 without changing source repo', {
  timeout: 120_000,
  skip: process.env.HARNESS_INTEGRATION !== '1' ?
    'Set HARNESS_INTEGRATION=1 and preload node:24-bookworm-slim' : false,
}, async () => {
  const f = fixture();
  try {
    const outcome = await selfImprove({
      source: f.repo, ref: 'main', policy: f.policy,
      task: 'Improve addition and multiplication with a correct minimal patch.',
      evaluatorDirectory: f.evalDir, stateDir: f.state,
      complete: doublePatchModel(),
    });
    assert.equal(outcome.status, 'candidate_ready');
    assert.equal(outcome.baseline, 1);
    assert.equal(outcome.best, 3);
    assert.equal(outcome.acceptedRounds, 2);
    assert.equal(outcome.published, false);
    assert.deepEqual(outcome.rounds.map(r => r.status), ['accepted', 'accepted']);
    const patch = readFileSync(outcome.patchFile, 'utf8');
    assert.ok(patch.includes('return a + b'));
    assert.ok(patch.includes('return a * b'));
    assert.equal(readFileSync(join(f.repo, ROOT), 'utf8'), f.code);
    const receipts = (await import('node:fs')).readdirSync(f.state);
    assert.equal(receipts.some(x => x.endsWith('.lock')), false);
    assert.equal(receipts.some(x => x.endsWith('.json')), true);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('regression during recursive improvement is rejected and last accepted patch restored', {
  timeout: 120_000,
  skip: process.env.HARNESS_INTEGRATION !== '1' ?
    'Set HARNESS_INTEGRATION=1 and preload node:24-bookworm-slim' : false,
}, async () => {
  const f = fixture();
  try {
    const result = await selfImprove({
      source: f.repo, ref: 'main', policy: f.policy,
      task: 'Improve arithmetic without introducing regressions.',
      evaluatorDirectory: f.evalDir, stateDir: f.state,
      complete: doublePatchModel({ sabotageSecond: true }),
    });
    assert.equal(result.status, 'candidate_ready');
    assert.equal(result.baseline, 1);
    assert.equal(result.best, 2);
    assert.equal(result.acceptedRounds, 1);
    assert.deepEqual(result.rounds.map(x => x.status), ['accepted', 'rejected']);
    assert.deepEqual(result.rounds[1].difference.regressed, ['substract_regression']);
    const patch = readFileSync(result.patchFile, 'utf8');
    assert.ok(patch.includes('return a + b'));
    assert.equal(patch.includes('return a * b'), false);
    assert.equal(/^[+-]export function subtract/m.test(patch), false);
    assert.equal(readFileSync(join(f.repo, ROOT), 'utf8'), f.code);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('budget-overrun model retries once with only patch-focused tools', {
  timeout: 100_000,
  skip: process.env.HARNESS_INTEGRATION !== '1' ?
    'Requires preloaded Node Docker image' : false,
}, async () => {
  const f = fixture();
  let attempt = 0;
  const observedToolLists = [];
  try {
    const complete = async (messages, tools) => {
      observedToolLists.push(tools.map(x => x.function.name));
      const latest = messages.at(-1);
      if (messages.length === 2) {
        attempt++;
        if (attempt === 1) {
          // Simulate a model trying to issue too many tools in one response.
          return { model: 'over-eager-fixture', message: {
            role: 'assistant', content: null, tool_calls: Array.from({ length: 5 }, (_, i) => ({
              id: 'too_many_' + i, type: 'function',
              function: { name: 'read_file', arguments: '{"path":"src/math.mjs"}' },
            })),
          }};
        }
        assert.ok(tools.every(x => ['read_file','apply_patch'].includes(x.function.name)));
        assert.match(messages[1].content, /Previous proposal made too many tool calls/);
        return { model: 'focused-fixture', message: {
          role: 'assistant', content: null, tool_calls: [{
            id: 'repair_patch', type: 'function',
            function: { name: 'apply_patch', arguments: JSON.stringify({ patch: patchFor('add') }) },
          }],
        }};
      }
      if (latest.role === 'tool') {
        assert.equal(latest.name, 'apply_patch');
        assert.equal(JSON.parse(latest.content).ok, true);
        return { model: 'focused-fixture', message: {
          role: 'assistant', content: 'Repaired with bounded patch' } };
      }
      throw new Error('Unexpected fake model transcript');
    };
    const result = await selfImprove({
      source: f.repo, ref: 'main', policy: f.policy,
      task: 'Repair basic arithmetic in the approved source',
      evaluatorDirectory: f.evalDir, stateDir: f.state,
      complete,
    });
    assert.equal(result.status, 'candidate_ready');
    assert.equal(result.baseline, 1);
    assert.equal(result.best, 2);
    assert.deepEqual(result.rounds.map(x => x.status), ['error', 'accepted']);
    assert.equal(result.rounds[0].reason, 'Tool call budget exceeded');
    assert.ok(readFileSync(result.patchFile, 'utf8').includes('return a + b'));
    assert.ok(observedToolLists.at(-1).every(x => ['read_file','apply_patch'].includes(x)));
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});
