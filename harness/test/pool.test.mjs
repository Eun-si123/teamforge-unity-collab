import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validatePoolConfig, rankCandidates, critiqueCandidate, runModelPool, main,
} from '../pool/runner.mjs';

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'portable-pool-test-'));
  const evalDir = join(home, 'evaluator'), state = join(home, 'private');
  mkdirSync(evalDir); mkdirSync(state, { mode: 0o700 });
  writeFileSync(join(evalDir, 'readonly-test.mjs'), 'Independent evaluator bytes\n');
  const policy = {
    editableFiles: ['src/example.mjs'], protectedFiles: ['test/contract.test.mjs'],
    testFile: 'test/contract.test.mjs',
    cases: [
      { id: 'regression_baseline', group: 'regression', image: 'node:24-bookworm-slim',
        argv: ['node','--test','/evaluator/contract.test.mjs'], expect: 'tests 1' },
      { id: 'holdout_case', group: 'holdout', image: 'node:24-bookworm-slim',
        argv: ['node','--test','/evaluator/holdout.test.mjs'], expect: 'tests 1' },
    ],
    maxRounds: 2, repeat: 1,
  };
  const config = {
    sourceDisclosureApproved: true, pool: { maxModels: 3, maxRequests: 20, minDelayMs: 0, critic: true },
    models: ['vendor/a','vendor/b','vendor/c'].map(id => ({
      id, protocol: 'openai-compatible', baseUrl: 'https://inference.example.net/v1',
      apiKeyEnv: 'SCOPED_TEST_KEY', approved: true,
    })),
  };
  return { home, evalDir, state, policy, config };
}
function fakeCompletionFactory() {
  return ({ models }) => ({
    async complete(_messages, tools) {
      if (tools?.[0]?.function?.name === 'report_risk') {
        return { model: models[0].id, message: {
          role: 'assistant', content: null, tool_calls: [{
            id: 'review_1', type: 'function', function: { name: 'report_risk',
              arguments: '{"severity":"low","evidence":"Check boundary cases."}' },
          }],
        }};
      }
      return { model: models[0].id, message: { role: 'assistant', content: 'candidate' } };
    },
  });
}

test('pool budgets must be explicit and bounded', () => {
  const f = fixture();
  try {
    assert.equal(validatePoolConfig(f.config).maxModels, 3);
    assert.throws(() => validatePoolConfig({ ...f.config, sourceDisclosureApproved: false }));
    assert.throws(() => validatePoolConfig({
      ...f.config, pool: { ...f.config.pool, maxRequests: 1 },
    }));
    assert.throws(() => validatePoolConfig({
      ...f.config, pool: { ...f.config.pool, maxModels: 99 },
    }));
    assert.throws(() => validatePoolConfig({
      ...f.config, pool: { ...f.config.pool, minDelayMs: -1 },
    }));
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('ranking requires independent measured improvement and reproducible patch hash', () => {
  const patchSha = 'a'.repeat(64);
  const proposals = [
    { status: 'candidate_ready', modelIndex: 0, baseline: 1, best: 2, total: 3, patchSha, patchBytes: 80 },
    { status: 'candidate_ready', modelIndex: 1, baseline: 1, best: 3, total: 3, patchSha, patchBytes: 160 },
    { status: 'candidate_ready', modelIndex: 2, baseline: 1, best: 3, total: 3, patchSha, patchBytes: 90 },
    { status: 'candidate_ready', modelIndex: 3, baseline: 2, best: 2, total: 3, patchSha, patchBytes: 4 },
    { status: 'blocked', modelIndex: 4, baseline: 0, best: 3, total: 3, patchSha, patchBytes: 4 },
  ];
  assert.deepEqual(rankCandidates(proposals).map(x => x.modelIndex), [2, 1, 0]);
});

test('three unrelated providers independently propose; reviewer stays advisory', async () => {
  const f = fixture();
  const modelIds = [];
  let headCalls = 0;
  const scores = [2, 3, 2];
  try {
    const result = await runModelPool({
      config: f.config, policy: f.policy,
      task: 'Improve the independent source task', source: '/repo/fixture', ref: 'main',
      evaluatorDirectory: f.evalDir, stateDir: f.state,
      headFn: () => { headCalls++; return 'b'.repeat(40); },
      baselineFn: () => ({ score: 1, total: 3 }),
      routerFactory: fakeCompletionFactory(),
      sleep: () => Promise.resolve(),
      improveImpl: async ({ complete, stateDir, researchTools }) => {
        mkdirSync(stateDir, { recursive: true, mode: 0o700 });
        const { model } = await complete([{ role:'user', content:'fix' }], []);
        assert.deepEqual(researchTools, []);
        modelIds.push(model);
        const idx = modelIds.length - 1;
        const patch = join(stateDir, 'fake.patch');
        writeFileSync(patch, 'diff --git a/a b/a\n+' + model.repeat(idx + 1) + '\n');
        return { status: 'candidate_ready', baseline: 1, best: scores[idx], total: 3,
          patchFile: patch, acceptedRounds: 1 };
      },
    });
    assert.deepEqual(modelIds, ['vendor/a','vendor/b','vendor/c']);
    assert.equal(result.status, 'best_candidate_selected');
    assert.equal(result.best.model, 'vendor/b');
    assert.equal(result.best.best, 3);
    assert.equal(result.best.critique.severity, 'low');
    assert.equal(result.modelRequests, 6);
    assert.equal(headCalls, 2);
    assert.equal(result.results.every(x => x.critique.model !== x.model), true);
    const saved = JSON.parse(readFileSync(result.receipt, 'utf8'));
    assert.equal(saved.published, false);
    assert.equal(saved.best.model, 'vendor/b');
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('small global call budget halts further provider work without infinite loop', async () => {
  const f = fixture();
  const models = [];
  try {
    const config = { ...f.config, pool: { maxModels: 3, maxRequests: 2, minDelayMs: 0, critic: false } };
    const result = await runModelPool({
      config, policy: f.policy, task: 'Improve source but obey call budget',
      source: '/repo/fixture', ref: 'main', evaluatorDirectory: f.evalDir, stateDir: f.state,
      headFn: () => 'a'.repeat(40), baselineFn: () => ({score:1,total:3}),
      routerFactory: fakeCompletionFactory(),
      improveImpl: async ({ complete }) => {
        const r = await complete([{ role:'user', content:'foo' }], []);
        models.push(r.model);
        return { status: 'no_verified_improvement', baseline: 1, best: 1, total: 3 };
      },
    });
    assert.deepEqual(models, ['vendor/a','vendor/b']);
    assert.equal(result.modelRequests, 2);
    assert.equal(result.status, 'no_benchmark_verified_candidate');
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('pool CLI plan never requires account keys nor starts a real worker', async () => {
  const f = fixture();
  try {
    const files = ['config.json','policy.json','task.txt'].map(x => join(f.home,x));
    writeFileSync(files[0], JSON.stringify({ ...f.config, sourceDisclosureApproved: false }));
    writeFileSync(files[1], JSON.stringify(f.policy));
    writeFileSync(files[2], 'Research a safer coding harness behavior.');
    const out = await main(['plan', '--config', files[0], '--policy', files[1],
      '--source', f.home, '--ref','main','--eval-dir',f.evalDir,'--task-file',files[2]]);
    assert.equal(out.status,'PLAN_ONLY');
    assert.equal(out.models.length, 3);
    assert.equal(out.published, false);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});


test('perfect frozen baseline short-circuits all model traffic', async () => {
  const f = fixture();
  try {
    const out = await runModelPool({
      config: f.config, policy: f.policy,
      task: 'Do not attempt unmeasured improvements.',
      source: '/repo/fixture', ref: 'main', evaluatorDirectory: f.evalDir,
      stateDir: f.state, headFn: () => 'c'.repeat(40),
      baselineFn: () => ({ score: 2, total: 2 }),
      routerFactory: () => { throw new Error('No model must initialize'); },
      improveImpl: () => { throw new Error('No proposer must run'); },
    });
    assert.equal(out.status, 'no_measurable_gap');
    assert.equal(out.modelRequests, 0);
    assert.equal(out.results.length, 0);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test('optional local stage is explicitly authorized and never auto-publishes', async () => {
  const f = fixture();
  const config = { ...f.config, pool: {
    ...f.config.pool, critic: false, maxModels: 1,
    localStaging: { enabled: true, directory: join(f.home, 'stages') },
  } };
  let staged = 0;
  try {
    const out = await runModelPool({
      config, policy: f.policy, task: 'Accept measured improvement only',
      source: '/repo/fixture', ref: 'main', evaluatorDirectory: f.evalDir,
      stateDir: f.state, headFn: () => 'd'.repeat(40),
      baselineFn: () => ({ score: 1, total: 2 }),
      routerFactory: fakeCompletionFactory(),
      improveImpl: async ({complete, stateDir}) => {
        await complete([{role:'user',content:'fix'}], []);
        mkdirSync(stateDir, {recursive:true,mode:0o700});
        const patch = join(stateDir,'candidate.patch');
        writeFileSync(patch, 'diff --git a/x b/x\n+safe\n');
        return {status:'candidate_ready',baseline:1,best:2,total:2,patchFile:patch};
      },
      stageFn: args => {
        staged++;
        assert.equal(args.expectedScore, 2);
        assert.equal(args.expectedSha, 'd'.repeat(40));
        return {repo:'/private/stage',sha:'e'.repeat(40),published:false};
      },
    });
    assert.equal(out.status, 'locally_staged');
    assert.equal(out.staged.repo, '/private/stage');
    assert.equal(out.staged.published, false);
    assert.equal(staged, 1);
  } finally { rmSync(f.home, {recursive:true,force:true}); }
});
