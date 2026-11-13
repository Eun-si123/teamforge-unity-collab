#!/usr/bin/env node
/**
 * Continuous, strictly bounded discovery -> verified reproduction -> multi-model
 * repair -> independently scored local stage. The test generator is trusted
 * deterministic code, not model-generated executable source.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, dockerWorkspaceUser } from '../core/workspace.mjs';
import { currentStage } from '../pool/staging.mjs';
import { runModelPool } from '../pool/runner.mjs';
import { hashBenchmarkDirectory, runBenchmark, loadBenchmarkPolicy } from '../improve/benchmark.mjs';
import { makeProbe, probeSource, failureGoal } from './probes.mjs';

const REFERENCE_PATH = fileURLToPath(new URL('./reference-engine.mjs', import.meta.url));
const MAX_CATALOG = 24;
const MAX_SCAN_PER_RUN = 3;
const MAX_RETRY_MS = 3 * 60 * 60 * 1000;

function privateDir(path) {
  if (!isAbsolute(path)) throw new Error('State must be absolute');
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && s.uid !== process.getuid())) {
    throw new Error('Discovery state must be an owner-only real directory');
  }
}
function readState(path) {
  if (!existsSync(path)) return { schema: 1, cursor: 0, solved: [], pending: null, backlog: [] };
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 80_000 ||
      (stat.mode & 0o077) !== 0) throw new Error('Unsafe discovery state file');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.schema !== 1 || !Number.isInteger(data.cursor) || data.cursor < 0 ||
      !Array.isArray(data.solved) || data.solved.length > MAX_CATALOG ||
      data.solved.some(x => !Number.isInteger(x) || x < 0 || x >= data.cursor)) {
    throw new Error('Untrusted discovery state');
  }
  if (data.pending !== null && data.pending !== undefined &&
      (!Number.isInteger(data.pending.index) || data.pending.index < 0 ||
       data.pending.index >= data.cursor || !Number.isInteger(data.pending.failures))) {
    throw new Error('Invalid pending discovery entry');
  }
  if (data.backlog !== undefined && (!Array.isArray(data.backlog) ||
      data.backlog.length > 6 || data.backlog.some(x =>
        !Number.isInteger(x.index) || x.index < 0 || x.index >= data.cursor ||
        !Number.isInteger(x.retryAfter)))) {
    throw new Error('Invalid discovery backlog');
  }
  data.backlog ||= [];
  return data;
}
function writeState(path, data) {
  const tmp = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2) + '\n',
      { flag: 'wx', mode: 0o600 });
    renameSync(tmp, path);
  } finally { if (existsSync(tmp)) rmSync(tmp, { force: true }); }
}
function checkJsonSource(name, path) {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink() || s.size > 32000) {
    throw new Error('Unsafe ' + name + ' file');
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}
function dockerCase({ workspace, evaluator, filename, image = 'node:24-bookworm-slim' }) {
  const args = [
    'run', '--rm', '--network', 'none', '--read-only',
    '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '96', '--memory', '1g', '--cpus', '1',
    '--user', dockerWorkspaceUser(),
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=96m',
    '-v', workspace + ':/workspace:ro', '-v', evaluator + ':/evaluator:ro',
    '-w', '/workspace', image, 'node', '--test', '/evaluator/' + filename,
  ];
  const run = exec('docker', args, { check: false, timeout: 55_000, maxBuffer: 300_000 });
  if (run.status === null || run.signal) throw new Error('Docker probe infrastructure failed');
  const content = run.stdout + '\n' + run.stderr;
  const count = name => Number(new RegExp('(?:^|\\n)[#ℹ]\\s*' + name + '\\s+(\\d+)', 'm').exec(content)?.[1] ?? -1);
  return run.status === 0 && count('tests') > 0 &&
    count('pass') === count('tests') && count('fail') === 0 && count('skipped') === 0;
}
export function verifyProbe({
  workspace, probe, root, evaluateCase = dockerCase,
}) {
  privateDir(root);
  const folder = mkdtempSync(join(root, 'probe-'));
  try {
    copyFileSync(REFERENCE_PATH, join(folder, 'reference-engine.mjs'));
    writeFileSync(join(folder, 'candidate.test.mjs'), probeSource(probe),
      { mode: 0o600, flag: 'wx' });
    writeFileSync(join(folder, 'reference.test.mjs'),
      probeSource(probe, '/evaluator/reference-engine.mjs'),
      { mode: 0o600, flag: 'wx' });
    const sourceHash = hashBenchmarkDirectory(folder);
    // The reference oracle must pass twice and the candidate must give the
    // same answer twice. Nondeterminism/infrastructure error is not a defect.
    const reference = [0, 1].map(() => evaluateCase({
      workspace, evaluator: folder, filename: 'reference.test.mjs',
    }));
    if (!reference.every(Boolean)) {
      throw new Error('Generated probe was not independently satisfiable');
    }
    const candidate = [0, 1].map(() => evaluateCase({
      workspace, evaluator: folder, filename: 'candidate.test.mjs',
    }));
    if (hashBenchmarkDirectory(folder) !== sourceHash) throw new Error('Probe mutated during testing');
    if (candidate[0] !== candidate[1]) throw new Error('Candidate probe non-deterministic');
    return { id: probe.id, family: probe.family,
      referencePassed: true, candidatePassed: candidate[0], probeHash: sourceHash };
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

export function buildSuite({
  suiteRoot, existingDir, existingPolicy, solvedIndices = [],
  failingIndex, protectedVerification,
}) {
  if (!Number.isInteger(failingIndex) || failingIndex < 0 ||
      solvedIndices.some(x => !Number.isInteger(x) || x < 0 || x === failingIndex) ||
      solvedIndices.length > MAX_CATALOG) throw new Error('Invalid suite scenario indexes');
  privateDir(suiteRoot);
  const dest = mkdtempSync(join(suiteRoot, 'frozen-'));
  try {
    const old = loadBenchmarkPolicy(existingPolicy);
    for (const item of old.cases) {
      const source = join(existingDir, item.argv.at(-1).split('/').at(-1));
      if (!lstatSync(source).isFile()) throw new Error('Expected frozen baseline fixture missing');
      copyFileSync(source, join(dest, item.argv.at(-1).split('/').at(-1)));
    }
    const cases = [...old.cases];
    // Consolidate previous proven improvements into ONE regression test.
    if (solvedIndices.length) {
      const imports = [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { runAgent } from '/workspace/harness/core/engine.mjs';",
      ];
      const bodies = solvedIndices.map(index => probeSource(makeProbe(index))
        .split('\n').slice(3).join('\n'));
      writeFileSync(join(dest, 'learned_regressions.test.mjs'),
        imports.join('\n') + '\n' + bodies.join('\n'),
        { mode: 0o600 });
      cases.push({
        id: 'learned_regressions', group: 'regression', image: 'node:24-bookworm-slim',
        argv: ['node', '--test', '/evaluator/learned_regressions.test.mjs'],
        expect: 'tests ' + solvedIndices.length, timeoutMs: 90_000,
      });
    }
    const probe = makeProbe(failingIndex);
    const name = 'candidate_probe.test.mjs';
    writeFileSync(join(dest, name), probeSource(probe), { mode: 0o600 });
    cases.push({
      id: probe.id, group: 'holdout', image: 'node:24-bookworm-slim',
      argv: ['node', '--test', '/evaluator/' + name],
      expect: 'tests 1', timeoutMs: 90_000,
    });
    const manifest = {
      editableFiles: ['harness/core/engine.mjs'],
      protectedFiles: ['harness/test/harness.test.mjs'],
      testFile: 'harness/test/harness.test.mjs',
      protectedVerification,
      maxRounds: 2, repeat: 2, cases,
    };
    loadBenchmarkPolicy(manifest);
    // The benchmark hash covers executable input, not mutable model configuration.
    const evaluatorHash = hashBenchmarkDirectory(dest);
    return { evaluatorDirectory: dest, evaluatorHash, manifest, probe };
  } catch (error) {
    rmSync(dest, { recursive: true, force: true });
    throw error;
  }
}
export async function continuousDiscovery({
  config, stageRoot, root, baseEvaluator,
  basePolicy, maxScan = MAX_SCAN_PER_RUN,
  readStage = currentStage, probeFn = verifyProbe,
  poolFn = runModelPool, benchmarkFn = runBenchmark,
  now = () => Date.now(), onEvent = () => {},
}) {
  if (!config || !stageRoot || !root || !baseEvaluator || !basePolicy ||
      ![stageRoot, root, baseEvaluator, basePolicy].every(isAbsolute) ||
      !Number.isInteger(maxScan) || maxScan < 1 || maxScan > 6) {
    throw new Error('Invalid discovery configuration');
  }
  privateDir(root);
  const lease = join(root, 'active.lock');
  mkdirSync(lease, { mode: 0o700 });
  const statePath = join(root, 'state.json');
  let state = readState(statePath);
  const emit = (status, extra = {}) => onEvent({ status, cursor: state.cursor,
    solved: state.solved.length, ...extra });
  try {
    const stage = readStage(stageRoot);
    if (!stage) throw new Error('No independently validated stage available');
    if (stage.published !== false || !/^[a-f0-9]{40}$/.test(stage.sha)) {
      throw new Error('Invalid saved local stage');
    }
    const workspace = stage.repo, refName = stage.ref;
    const policy = checkJsonSource('baseline policy', basePolicy);
    // A previously failing property may have been repaired by a separate,
    // independently validated stage. Recheck before repeating model calls.
    if (state.pending) {
      const p = makeProbe(state.pending.index);
      const observed = probeFn({ workspace, probe: p, root });
      if (observed.candidatePassed) {
        state.solved.push(state.pending.index);
        state.solved = [...new Set(state.solved)].slice(-MAX_CATALOG);
        state.pending = null;
        emit('previous_property_verified_fixed', { id: p.id });
        writeState(statePath, state);
      }
    }

    let targetIndex;
    let retryCount = 0;
    if (state.pending && now() >= (state.pending.retryAfter || 0)) {
      // Retry a previously verified defect after its bounded cooldown.
      targetIndex = state.pending.index;
      retryCount = state.pending.failures;
    } else {
      const due = state.backlog.findIndex(x => now() >= x.retryAfter);
      if (due >= 0) {
        // Rotate pending work so one difficult model task cannot block all
        // independently discovered opportunities.
        const candidate = state.backlog.splice(due, 1)[0];
        if (state.pending) state.backlog.push(state.pending);
        state.pending = candidate;
        targetIndex = candidate.index;
        retryCount = candidate.failures;
      } else {
        const checked = [];
        for (let i = 0; i < maxScan; i++) {
          const index = state.cursor;
          const probe = makeProbe(index);
          state.cursor++;
          const result = probeFn({ workspace, probe, root });
          checked.push(result);
          emit('probe_checked', { id: probe.id, candidatePassed: result.candidatePassed });
          if (!result.candidatePassed) {
            if (state.pending) {
              if (state.backlog.length >= 6) {
                // Do not lose a confirmed problem or an existing pending job.
                state.cursor--;
                break;
              }
              state.backlog.push(state.pending);
              state.pending = null;
            }
            targetIndex = index;
            break;
          }
        }
        writeState(statePath, state);
        if (targetIndex === undefined) {
          const status = state.pending ? 'scanned_while_pending_cooldown' : 'explored_no_defect';
          emit(status, { probesChecked: checked.length, backlog: state.backlog.length });
          return { status, probesChecked: checked.length,
            backlog: state.backlog.length, cursor: state.cursor, modelRequests: 0 };
        }
      }
    }
    // The stage may have moved since a queued issue was discovered. A freshly
    // passing probe is learned, not used as a reason to spend inference tokens.
    const chosenProbe = makeProbe(targetIndex);
    if (retryCount && probeFn({ workspace, probe: chosenProbe, root }).candidatePassed) {
      state.solved.push(targetIndex);
      state.solved = [...new Set(state.solved)].slice(-MAX_CATALOG);
      state.pending = null;
      writeState(statePath, state);
      emit('queued_property_fixed_without_model', { id: chosenProbe.id });
      return { status: 'queued_property_fixed_without_model',
        cursor: state.cursor, modelRequests: 0 };
    }
    const selection = makeProbe(targetIndex);
    const bundleRoot = join(root, 'frozen-evaluators');
    const suite = buildSuite({
      suiteRoot: bundleRoot, existingDir: baseEvaluator,
      existingPolicy: policy, solvedIndices: state.solved,
      failingIndex: targetIndex, protectedVerification: policy.protectedVerification,
    });
    // Reject an unsound suite before spending any provider tokens.
    const baseline = benchmarkFn({
      workspace, evaluatorDirectory: suite.evaluatorDirectory,
      policy: loadBenchmarkPolicy(suite.manifest), expectedHash: suite.evaluatorHash,
    });
    const baselineCases = baseline.cases;
    if (!baselineCases.at(-1) || baselineCases.at(-1).ok ||
        baselineCases.slice(0, -1).some(x => !x.ok)) {
      throw new Error('Existing validated behavior regressed or new probe failed to reproduce');
    }
    // Caller can approve models/routes, but cannot alter the frozen suite.
    state.pending = { index: targetIndex, failures: retryCount + 1,
      suite: suite.evaluatorDirectory, evaluatorHash: suite.evaluatorHash,
      retryAfter: now() + MAX_RETRY_MS, baseSha: stage.sha };
    writeState(statePath, state);
    emit('verified_new_failure', { id: selection.id, baseline: baseline.score,
      total: baseline.total });
    const outcome = await poolFn({
      config, policy: suite.manifest, task: failureGoal([selection]),
      source: workspace, ref: refName,
      evaluatorDirectory: suite.evaluatorDirectory,
      stateDir: join(root, 'model-pool'), onAttempt: onEvent,
    });
    if (outcome.status === 'locally_staged' && outcome.staged?.scoreAfter === baseline.total) {
      const newlyStaged = readStage(stageRoot);
      if (newlyStaged?.sha !== outcome.staged.sha) throw new Error('Stage pointer mismatch');
      // Never assume scoring alone proves a new version behaves correctly.
      const verified = probeFn({ workspace: newlyStaged.repo, probe: selection, root });
      if (!verified.candidatePassed) throw new Error('Stage no longer passes frozen discovery probe');
      state.solved.push(targetIndex);
      state.solved = [...new Set(state.solved)].slice(-MAX_CATALOG);
      state.pending = null;
      writeState(statePath, state);
      emit('new_improvement_verified', { id: selection.id, stagedSha: newlyStaged.sha });
    } else {
      emit('no_verified_model_patch', { id: selection.id, poolStatus: outcome.status });
    }
    return { status: outcome.status, probe: selection.id,
      baseline: baseline.score, total: baseline.total,
      modelRequests: outcome.modelRequests, staged: outcome.staged?.sha || null,
      cursor: state.cursor };
  } finally { rmdirSync(lease); }
}

export async function main(argv) {
  if (argv.length !== 1 || !/^\//.test(argv[0])) throw new Error('Supply one private config JSON path');
  const config = checkJsonSource('operator config', argv[0]);
  if (config.sourceDisclosureApproved !== true) throw new Error('Source disclosure not approved');
  const discovery = config.discovery;
  if (!discovery || discovery.enabled !== true ||
      typeof discovery.stateDir !== 'string' ||
      typeof discovery.stageRoot !== 'string' ||
      typeof discovery.baselineDirectory !== 'string' ||
      typeof discovery.baselinePolicy !== 'string') {
    throw new Error('Missing explicit enabled operator-controlled discovery settings');
  }
  return continuousDiscovery({
    config, root: discovery.stateDir, stageRoot: discovery.stageRoot,
    baseEvaluator: discovery.baselineDirectory,
    basePolicy: discovery.baselinePolicy,
    maxScan: discovery.probesPerRun || 3,
    onEvent: event => {
      if (process.env.HARNESS_DISCOVERY_PROGRESS === '1') {
        process.stderr.write('[discovery] ' + JSON.stringify(event) + '\n');
      }
    },
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(x => console.log(JSON.stringify(x, null, 2)))
    .catch(error => { console.error('Discovery halted: ' + String(error.message).slice(0, 190));
      process.exitCode = 1; });
}
