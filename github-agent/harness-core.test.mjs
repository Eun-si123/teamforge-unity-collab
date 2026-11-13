import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeReviewJob, reviewJobKey, failurePolicy, jobDecision, evaluateReview,
} from './harness-core.mjs';
import { parseHarnessArgs } from './harness-runner.mjs';

const A = { repo: 'Eun-si123/teamforge-unity-collab', number: 536, sha: 'a'.repeat(40) };
const B = { ...A, sha: 'b'.repeat(40) };

test('immutable, identity-sensitive review jobs and safe CLI', () => {
  assert.deepEqual(normalizeReviewJob(A), { kind: 'review', ...A });
  assert.equal(reviewJobKey(A).length, 64);
  assert.notEqual(reviewJobKey(A), reviewJobKey(B));
  assert.throws(() => normalizeReviewJob({ ...A, sha: 'nope' }));
  assert.throws(() => normalizeReviewJob({ ...A, repo: '../repo' }));
  assert.deepEqual(parseHarnessArgs(['plan','--repo',A.repo,'--pr','536']).mode, 'plan');
  assert.throws(() => parseHarnessArgs(['review','--repo',A.repo,'--pr','1;rm']));
});

test('deduplicates exact SHA and refuses orphaned running/unknown attempts', () => {
  const key = reviewJobKey(A);
  assert.equal(jobDecision(A, null).run, true);
  assert.equal(jobDecision(B, { jobKey: key, status: 'reviewed' }).reason, 'new_head');
  for (const status of ['reviewed','blocked','needs_human_review']) {
    assert.equal(jobDecision(A, { jobKey: key, status }).run, false);
  }
  assert.equal(jobDecision(A, { jobKey: key, status: 'running' }).reason, 'existing_run_requires_reconciliation');
  assert.equal(jobDecision(A, { jobKey: key, status: 'wat' }).run, false);
});

test('transient 429 and timeouts cool down; authorization errors stop', () => {
  const a = failurePolicy('HTTP 429', 1, 0);
  assert.deepEqual(a, { status: 'cooldown', nextAttemptAt: new Date(60000).toISOString(), class:'transient' });
  assert.equal(failurePolicy('HTTP 429', 30, 0).nextAttemptAt, new Date(3600000).toISOString());
  assert.equal(failurePolicy('HTTP 403', 1).status, 'blocked');
  assert.equal(failurePolicy('read crash', 1).status, 'blocked');
  assert.throws(() => failurePolicy('HTTP 429', -1));
  const rec = { jobKey: reviewJobKey(A), status: 'cooldown', nextAttemptAt: a.nextAttemptAt };
  assert.equal(jobDecision(A, rec, 59000).run, false);
  assert.equal(jobDecision(A, rec, 60000).run, true);
});

test('review evidence stays advisory and pinned to exact head', () => {
  const result = { repo: A.repo, pr: A.number, sha: A.sha, report: { findings: [] } };
  assert.equal(evaluateReview(A, result, A.sha).status, 'reviewed');
  assert.equal(evaluateReview(A, { ...result, report: { findings: [{}] } }, A.sha).status, 'needs_human_review');
  assert.equal(evaluateReview(A, result, B.sha).status, 'stale');
  assert.equal(evaluateReview(A, { ...result, sha: B.sha }, A.sha).status, 'blocked');
  assert.equal(evaluateReview(A, { ...result, report: {} }, A.sha).status, 'blocked');
});
