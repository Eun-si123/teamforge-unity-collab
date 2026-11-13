#!/usr/bin/env node
/**
 * Bounded, intentionally review-only harness around omniroute-github.mjs.
 * No background timer, no automatic PR comments/merges, no autonomous coding.
 * Job checkpoints live on the operator's local disk (never in Git).
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateReview, failurePolicy, jobDecision, normalizeReviewJob, reviewJobKey } from './harness-core.mjs';

const DEFAULT_ROOT = join(homedir(), '.local', 'state', 'teamforge-nvidia-harness');

export function parseHarnessArgs(argv) {
  const [mode, ...rest] = argv;
  if (!['plan', 'review'].includes(mode)) throw new Error('Use plan or review');
  const opts = { mode, root: DEFAULT_ROOT };
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--repo', '--pr', '--state-dir'].includes(rest[i]) || !rest[i + 1]) throw new Error('Unexpected/missing argument');
    if (rest[i] === '--repo') opts.repo = rest[i + 1];
    if (rest[i] === '--pr') opts.pr = rest[i + 1];
    if (rest[i] === '--state-dir') opts.root = resolve(rest[i + 1]);
  }
  if (!/^[1-9]\d*$/.test(opts.pr || '')) throw new Error('Supply --pr NUMBER');
  const number = Number(opts.pr);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid PR number');
  // Validate repo/number even before reaching GitHub or reading state.
  normalizeReviewJob({ repo: opts.repo, number, sha: '0'.repeat(40) });
  opts.number = number;
  return opts;
}

function exec(command, args, { timeout = 25_000, maxBuffer = 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, {
    shell: false, encoding: 'utf8', timeout, maxBuffer,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result;
}

function githubJson(args) {
  const r = exec('gh', args);
  if (r.error || r.status !== 0) throw new Error('GitHub metadata request failed');
  return JSON.parse(r.stdout);
}

function remoteSnapshot(repo, number) {
  const meta = githubJson(['repo', 'view', repo, '--json', 'visibility,isArchived']);
  if (meta.visibility !== 'PUBLIC' || meta.isArchived) {
    throw new Error('Harness v1 requires a public, non-archived repository');
  }
  const pr = githubJson(['pr', 'view', String(number), '-R', repo, '--json', 'headRefOid,state,url']);
  if (pr.state !== 'OPEN') throw new Error('PR is not open');
  return { ...normalizeReviewJob({ repo, number, sha: pr.headRefOid }), url: pr.url };
}

function statePaths(root, job) {
  const prKey = createHash('sha256').update(job.repo + '#' + job.number).digest('hex');
  const key = reviewJobKey(job);
  return {
    file: join(root, key + '.json'),
    lock: join(root, prKey + '.lock'),
  };
}

function checkRoot(root, create = false) {
  if (!existsSync(root)) {
    if (!create) return false;
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  const s = statSync(root);
  if (!s.isDirectory() || (s.mode & 0o077)) throw new Error('State directory must be private (chmod 700)');
  if (typeof process.getuid === 'function' && s.uid !== process.getuid()) {
    throw new Error('State directory must belong to current user');
  }
  return true;
}

function loadRecord(path) {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 16_384 || (stat.mode & 0o077)) throw new Error('Unsafe checkpoint file');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function checkpoint(path, data) {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
}

function fingerprintedRecord(job, status, attempts, details = {}) {
  return {
    schemaVersion: 1, jobKey: reviewJobKey(job),
    repo: job.repo, pr: job.number, sha: job.sha,
    status, attempts, updatedAt: new Date().toISOString(),
    ...details,
  };
}

export function runHarness(options) {
  const job = remoteSnapshot(options.repo, options.number);
  const paths = statePaths(options.root, job);
  const rootExists = checkRoot(options.root, options.mode === 'review');
  const old = rootExists ? loadRecord(paths.file) : null;
  const decision = jobDecision(job, old);
  if (options.mode === 'plan') {
    return { kind: 'plan', repo: job.repo, pr: job.number, sha: job.sha, url: job.url, ...decision };
  }
  if (!decision.run) return { kind: 'skipped', ...decision, repo: job.repo, pr: job.number, sha: job.sha };

  // Directory create is exclusive. Never reclaim another process's lock by a guessed TTL.
  mkdirSync(paths.lock, { mode: 0o700 });
  try {
    // A PR can change between preflight and acquiring the local lock.
    const current = remoteSnapshot(job.repo, job.number);
    if (current.sha !== job.sha) {
      return { kind: 'skipped', reason: 'head_changed_before_execution', expected: job.sha, current: current.sha };
    }
    const attempts = (old?.attempts || 0) + 1;
    checkpoint(paths.file, fingerprintedRecord(job, 'running', attempts, {
      reason: 'model_review_started', findingCount: 0,
    }));
    const adapter = resolve(dirname(fileURLToPath(import.meta.url)), 'omniroute-github.mjs');
    // --publish is deliberately not passed, even if content/issue text requests it.
    const result = exec(process.execPath, [adapter, 'review', '--repo', job.repo, '--pr', String(job.number)], {
      timeout: 340_000, maxBuffer: 250_000,
    });
    if (result.status !== 0 || result.error) {
      const policy = failurePolicy(result.stderr || String(result.error?.code || 'failed'), attempts);
      checkpoint(paths.file, fingerprintedRecord(job, policy.status, attempts, {
        reason: 'review_adapter_failed', failureClass: policy.class,
        nextAttemptAt: policy.nextAttemptAt, findingCount: 0,
      }));
      return { kind: 'failed', status: policy.status, failureClass: policy.class, nextAttemptAt: policy.nextAttemptAt };
    }
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      checkpoint(paths.file, fingerprintedRecord(job, 'blocked', attempts, { reason: 'adapter_output_invalid', findingCount: 0 }));
      return { kind: 'failed', status: 'blocked', reason: 'adapter_output_invalid' };
    }
    // The Source HEAD is independently read *after* inference, never inferred from the model.
    let currentAfter;
    try {
      currentAfter = remoteSnapshot(job.repo, job.number);
    } catch {
      checkpoint(paths.file, fingerprintedRecord(job, 'blocked', attempts, { reason: 'post_review_github_unavailable', findingCount: 0 }));
      return { kind: 'failed', status: 'blocked', reason: 'post_review_github_unavailable' };
    }
    const outcome = evaluateReview(job, parsed, currentAfter.sha);
    checkpoint(paths.file, fingerprintedRecord(job, outcome.status, attempts, {
      reason: outcome.reason, findingCount: outcome.findingCount,
      model: typeof parsed.model === 'string' ? parsed.model.slice(0, 160) : null,
    }));
    return { kind: 'completed', ...outcome, repo: job.repo, pr: job.number, sha: job.sha };
  } finally {
    rmSync(paths.lock, { recursive: false });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseHarnessArgs(process.argv.slice(2));
    const output = runHarness(options);
    console.log(JSON.stringify(output, null, 2));
    if (output.kind === 'failed') process.exitCode = 2;
  } catch (error) {
    // Do not print arbitrary process/model output, key material, or repo contents.
    console.error('Harness halted:', /^EEXIST$/.test(error.code || '') ?
      'another run owns this PR lock; manual reconciliation required' : error.message.slice(0, 200));
    process.exitCode = 1;
  }
}
