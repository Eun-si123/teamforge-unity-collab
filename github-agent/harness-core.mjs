// Deterministic, no-network decisions for the GitHub/NVIDIA review harness.
// A model result is advisory evidence, never an approval to merge.
import { createHash } from 'node:crypto';

const TERMINAL = new Set(['reviewed', 'needs_human_review', 'blocked']);
const HEX_SHA = /^[a-f0-9]{40}$/i;
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export function normalizeReviewJob(input) {
  if (!REPO.test(input?.repo || '') || String(input.repo).includes('..')) {
    throw new Error('Invalid repository');
  }
  if (!Number.isSafeInteger(input?.number) || input.number <= 0) {
    throw new Error('Invalid PR number');
  }
  if (!HEX_SHA.test(input?.sha || '')) throw new Error('Invalid PR head SHA');
  return Object.freeze({
    kind: 'review',
    repo: input.repo,
    number: input.number,
    sha: input.sha.toLowerCase(),
  });
}

export function reviewJobKey(job) {
  const j = normalizeReviewJob(job);
  return createHash('sha256').update(JSON.stringify([j.kind, j.repo, j.number, j.sha])).digest('hex');
}

// Explicitly recognize only known outcome classes, no blind retry storm.
export function failurePolicy(reason, failures = 1, now = Date.now()) {
  const code = String(reason || '').slice(0, 1000);
  if (!Number.isInteger(failures) || failures < 1) throw new Error('Invalid failure count');
  if (/HTTP 401|HTTP 403|invalid credentials|authentication|private repository|invalid JSON|ENOENT|not found/i.test(code)) {
    return { status: 'blocked', nextAttemptAt: null, class: 'manual_action' };
  }
  if (/HTTP 429|HTTP 500|HTTP 502|HTTP 503|HTTP 504|ETIMEDOUT|Timeout|terminated|abort|unavailable|rate.?limit/i.test(code)) {
    const delayMs = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 6));
    return { status: 'cooldown', nextAttemptAt: new Date(now + delayMs).toISOString(), class: 'transient' };
  }
  return { status: 'blocked', nextAttemptAt: null, class: 'unknown' };
}

export function jobDecision(job, record, now = Date.now()) {
  const j = normalizeReviewJob(job);
  const expected = reviewJobKey(j);
  if (!record) return { run: true, reason: 'new_head' };
  if (record.jobKey !== expected) return { run: true, reason: 'new_head' };
  if (TERMINAL.has(record.status)) return { run: false, reason: 'already_recorded' };
  if (record.status === 'running') return { run: false, reason: 'existing_run_requires_reconciliation' };
  if (record.status === 'stale') return { run: false, reason: 'stale_head_requires_recheck' };
  if (record.status === 'cooldown') {
    const at = Date.parse(record.nextAttemptAt || '');
    if (!Number.isFinite(at)) return { run: false, reason: 'invalid_cooldown_checkpoint' };
    return now >= at ? { run: true, reason: 'cooldown_elapsed' } : { run: false, reason: 'cooldown_active' };
  }
  return { run: false, reason: 'unrecognized_checkpoint' };
}

export function evaluateReview(job, result, currentSha) {
  const j = normalizeReviewJob(job);
  if (typeof currentSha !== 'string' || currentSha.toLowerCase() !== j.sha) {
    return { status: 'stale', reason: 'pr_head_changed_during_review', findingCount: 0 };
  }
  if (!result || result.repo !== j.repo || result.pr !== j.number || result.sha?.toLowerCase() !== j.sha) {
    return { status: 'blocked', reason: 'invalid_review_evidence_identity', findingCount: 0 };
  }
  if (!result.report || !Array.isArray(result.report.findings)) {
    return { status: 'blocked', reason: 'invalid_review_evidence_shape', findingCount: 0 };
  }
  return {
    status: result.report.findings.length ? 'needs_human_review' : 'reviewed',
    reason: 'ai_report_requires_independent_verification',
    findingCount: result.report.findings.length,
  };
}
