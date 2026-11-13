import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeProbe, probeSource, failureGoal, PROBE_FAMILIES } from '../discover/probes.mjs';
import { verifyProbe, buildSuite, continuousDiscovery } from '../discover/controller.mjs';
import { hashBenchmarkDirectory, loadBenchmarkPolicy } from '../improve/benchmark.mjs';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'portable-discover-test-'));
  const state = join(home, 'state'), baselineDir = join(home, 'baseline');
  mkdirSync(state, { mode: 0o700 });
  mkdirSync(baselineDir, { mode: 0o700 });
  const names = ['basic_regression.test.mjs', 'old_holdout.test.mjs'];
  names.forEach(name => writeFileSync(join(baselineDir, name),
    "import test from 'node:test';\ntest('baseline',()=>{});\n",
    { mode: 0o600 }));
  const policy = {
    editableFiles: ['harness/core/engine.mjs'],
    protectedFiles: ['harness/test/harness.test.mjs'],
    testFile: 'harness/test/harness.test.mjs',
    repeat: 1, maxRounds: 1,
    cases: [
      { id: 'basic_regression', group: 'regression', image: 'node:24-bookworm-slim',
        argv: ['node', '--test', '/evaluator/' + names[0]], expect: 'tests 1' },
      { id: 'old_holdout', group: 'holdout', image: 'node:24-bookworm-slim',
        argv: ['node', '--test', '/evaluator/' + names[1]], expect: 'tests 1' },
    ],
  };
  const policyFile = join(home, 'baseline-policy.json');
  writeFileSync(policyFile, JSON.stringify(policy), { mode: 0o600 });
  const stage = { schema: 1, published: false, ref: 'harness-stage',
    sha: 'a'.repeat(40), repo: join(home, 'candidate-source') };
  const config = { sourceDisclosureApproved: true, models: [{ id: 'fixture-1',
    approved: true, protocol: 'openai-compatible',
    baseUrl: 'https://provider.example/v1', apiKeyEnv: 'FAKE_KEY' }] };
  return { home, state, baselineDir, policy, policyFile, stage, config };
}

test('probe families produce deterministic bounded tests rather than model-authored code', () => {
  const first = makeProbe(0);
  assert.equal(first.id, 'probe_malformed_truncated_0');
  assert.equal(first.expected, 'validation_error');
  assert.ok(PROBE_FAMILIES.length >= 8);
  assert.equal(makeProbe(0).rawArguments, first.rawArguments);
  assert.notEqual(makeProbe(PROBE_FAMILIES.length + 2).rawArguments,
    makeProbe(2).rawArguments);
  assert.match(probeSource(first), /runAgent/);
  assert.match(probeSource(first, '/evaluator/reference-engine.mjs'), /reference-engine/);
  assert.throws(() => probeSource(first, 'https://untrusted.example/test.mjs'));
  assert.throws(() => makeProbe(-1));
  assert.match(failureGoal([first]), /malformed_truncated/);
});

test('evaluator bundle combines independently proven regression and a new hidden holdout', () => {
  const f = fixture();
  try {
    const out = buildSuite({ suiteRoot: f.state, existingDir: f.baselineDir,
      existingPolicy: f.policy, solvedIndices: [7, 8], failingIndex: 0 });
    assert.equal(out.manifest.cases.length, 4);
    assert.equal(out.manifest.cases.at(-1).id, makeProbe(0).id);
    assert.equal(out.manifest.cases.at(-1).group, 'holdout');
    assert.equal(out.manifest.cases[2].id, 'learned_regressions');
    assert.equal(out.manifest.cases[2].group, 'regression');
    assert.match(readFileSync(join(out.evaluatorDirectory,
      'learned_regressions.test.mjs'), 'utf8'), /probe_valid_integer/);
    assert.equal(hashBenchmarkDirectory(out.evaluatorDirectory), out.evaluatorHash);
    assert.equal(loadBenchmarkPolicy(out.manifest).cases.length, 4);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('continuous discovery scans even when previous baseline was perfect', async () => {
  const f = fixture();
  let checked = 0, modelCalls = 0;
  try {
    const opts = {
      config: f.config, root: f.state, stageRoot: '/fake-private-stages',
      baseEvaluator: f.baselineDir, basePolicy: f.policyFile,
      readStage: () => f.stage,
      probeFn: ({ probe }) => { checked++; return {
        id: probe.id, candidatePassed: true, referencePassed: true };
      },
      poolFn: () => { modelCalls++; throw new Error('Should not call models'); },
      maxScan: 3,
    };
    const first = await continuousDiscovery(opts);
    const second = await continuousDiscovery(opts);
    assert.equal(first.status, 'explored_no_defect');
    assert.equal(second.cursor, 6);
    assert.equal(checked, 6);
    assert.equal(modelCalls, 0);
    const state = JSON.parse(readFileSync(join(f.state, 'state.json'), 'utf8'));
    assert.equal(state.cursor, 6);
    assert.equal(state.pending, null);
    assert.equal(readdirSync(f.state).some(x => x.endsWith('.lock')), false);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('only confirmed reproducible probe failure triggers the independent model pool', async () => {
  const f = fixture();
  let poolCalls = 0;
  let clock = 10_000;
  try {
    const opts = {
      config: f.config, root: f.state, stageRoot: '/private-stage',
      baseEvaluator: f.baselineDir, basePolicy: f.policyFile,
      readStage: () => f.stage, now: () => clock,
      probeFn: ({ probe }) => ({ id: probe.id,
        referencePassed: true, candidatePassed: probe.family !== 'malformed_truncated' }),
      benchmarkFn: ({ policy }) => ({
        score: policy.cases.length - 1, total: policy.cases.length,
        cases: policy.cases.map((x, i) => ({ id: x.id, group: x.group,
          ok: i !== policy.cases.length - 1 })),
      }),
      poolFn: async ({ task, policy }) => {
        poolCalls++;
        assert.match(task, /malformed_truncated/);
        assert.equal(policy.cases.at(-1).id, makeProbe(0).id);
        return { status: 'no_benchmark_verified_candidate',
          modelRequests: 3, staged: null };
      },
    };
    const first = await continuousDiscovery(opts);
    assert.equal(first.status, 'no_benchmark_verified_candidate');
    assert.equal(first.modelRequests, 3);
    assert.equal(poolCalls, 1);
    const second = await continuousDiscovery(opts);
    assert.equal(second.status, 'scanned_while_pending_cooldown');
    assert.equal(second.modelRequests, 0);
    assert.equal(poolCalls, 1);
    clock += 3 * 60 * 60 * 1000 + 1;
    await continuousDiscovery(opts);
    assert.equal(poolCalls, 2);
    assert.equal(readdirSync(f.state).some(x => x.endsWith('.lock')), false);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('a pending cooldown cannot starve newly discovered independent failures', async () => {
  const f = fixture();
  let poolCalls = 0;
  try {
    const opts = {
      config: f.config, root: f.state, stageRoot: '/private-stage',
      baseEvaluator: f.baselineDir, basePolicy: f.policyFile,
      readStage: () => f.stage, now: () => 200_000,
      probeFn: ({ probe }) => ({ id: probe.id, referencePassed: true,
        candidatePassed: !['malformed_truncated', 'malformed_nonjson'].includes(probe.family) }),
      benchmarkFn: ({ policy }) => ({
        score: policy.cases.length - 1, total: policy.cases.length,
        cases: policy.cases.map((x, i) => ({
          id: x.id, group: x.group, ok: i !== policy.cases.length - 1,
        })),
      }),
      poolFn: async () => {
        poolCalls++;
        return { status: 'no_benchmark_verified_candidate',
          modelRequests: 2, staged: null };
      },
      maxScan: 2,
    };
    const a = await continuousDiscovery(opts);
    const b = await continuousDiscovery(opts);
    assert.equal(a.probe, makeProbe(0).id);
    assert.equal(b.probe, makeProbe(1).id);
    assert.equal(poolCalls, 2);
    const saved = JSON.parse(readFileSync(join(f.state, 'state.json'), 'utf8'));
    assert.equal(saved.pending.index, 1);
    assert.deepEqual(saved.backlog.map(x => x.index), [0]);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('after local stage passes a new property, discovery archives it as a regression', async () => {
  const f = fixture();
  let stage = f.stage, calls = 0;
  try {
    const opts = {
      config: f.config, root: f.state, stageRoot: '/fake-private-stage',
      baseEvaluator: f.baselineDir, basePolicy: f.policyFile,
      readStage: () => stage,
      probeFn: ({ probe }) => ({ id: probe.id, referencePassed: true,
        candidatePassed: stage.sha !== f.stage.sha || probe.family !== 'malformed_truncated' }),
      benchmarkFn: ({ policy }) => ({
        score: policy.cases.length - 1, total: policy.cases.length,
        cases: policy.cases.map((x, i) => ({
          id: x.id, group: x.group, ok: i !== policy.cases.length - 1,
        })),
      }),
      poolFn: async () => {
        calls++;
        const sha = 'b'.repeat(40);
        stage = { ...stage, sha };
        return { status: 'locally_staged', modelRequests: 4,
          staged: { sha, scoreAfter: 3 } };
      },
      maxScan: 2,
    };
    const first = await continuousDiscovery(opts);
    assert.equal(first.status, 'locally_staged');
    assert.equal(calls, 1);
    const saved = JSON.parse(readFileSync(join(f.state, 'state.json'), 'utf8'));
    assert.equal(saved.pending, null);
    assert.deepEqual(saved.solved, [0]);
    const second = await continuousDiscovery(opts);
    assert.equal(second.status, 'explored_no_defect');
    assert.equal(second.cursor, 3);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('live synthetic probes distinguish real Harness bug from reference oracle', {
  skip: process.env.HARNESS_INTEGRATION !== '1' ?
    'Requires preloaded Node Docker image' : false,
  timeout: 120_000,
}, () => {
  const f = fixture();
  try {
    const workspace = process.cwd();
    const invalid = verifyProbe({ workspace, probe: makeProbe(0), root: f.state });
    const valid = verifyProbe({ workspace, probe: makeProbe(7), root: f.state });
    assert.equal(invalid.referencePassed, true);
    // A new implementation may have already fixed invalid JSON handling;
    // don't require failure as a permanent test invariant.
    assert.equal(typeof invalid.candidatePassed, 'boolean');
    assert.equal(valid.referencePassed, true);
    assert.equal(valid.candidatePassed, true);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});
