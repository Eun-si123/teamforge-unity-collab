# Local storage failures during transfer — 2026-10-23

This dated follow-up records source evidence, not release readiness. It was
selected during the user's autonomous reliability request after the independent
[Hierarchy/Seed/test-evidence pass](https://github.com/Eun-si123/teamforge-unity-collab/pull/328).
Base: `1874b6cdf3f241255ae78426b8099b676d2ed686`.
Branch: `agent/reliability/local-store-failure-20261023`.

## Problem and plan

A local `ChunkStore.put()` ENOSPC failure was caught as a source failure. Two
healthy sources therefore caused two downloads and writes, ending with
`direct_transfer_unavailable` instead of the original disk error. The pre-edit
plan and reproductions were saved in the shared task checkpoint.

The smallest correction classifies the failure by **operation origin**, not its
code. A flag covers only the awaited local write; a bounded, per-download set of
those error identities prevents misleading remote-unavailable progress even when
a local error happens to carry that code. The existing worker cleanup retains the
original first error, aborts siblings and waits for settlement. The existing
source retry/backoff and optional callback policy remain unchanged. Moving the
large retry loop or introducing a new error hierarchy was unnecessary.

Risk: medium reliability change in integrity-sensitive transfer code. Hash,
trust, path, previous-Active preservation and activation checks remain intact.
Cached verified chunks survive failure and are reused after repair. No protocol,
runtime, persisted format or packaged artifact changes. Revert this bounded
source/test commit for rollback; no migration is needed.

## Verification

- Initial focused baseline: **11 tests, 5 passed / 6 failed**. A further local
  error-code collision case was then added; final focused tests **12/12 passed**.
- Full Peer suite on unchanged production source: **261 passed, 0 failed,
  5 Windows-only skipped** (266 total); syntax **75 modules passed**. A subsequent
  test-only extension confirmed same-instance retry after repair and cache reuse;
  the final 12 focused tests passed again.
- All **60 SwarmDownloader tests** passed in independent review. Tests distinguish
  source ENOSPC failover from local ENOSPC/EACCES and misleading peer-like codes,
  check sibling abort/settlement, no late publication, unchanged caller signal,
  retained cache, cache read/cleanup failures and hedged winner single-write failure.
- A separate reviewer caused an actual filesystem EEXIST during `ChunkStore.put`:
  one request, original error, no false peer diagnostic/unavailable progress.
  Removing the obstruction and retrying the same downloader verified every chunk.

Current commit, final repository gates and remote CI belong to the task PR; this
record does not predeclare CI success. Unity Editor, Windows GUI, exact package,
physical two-PC, real disk exhaustion and long-running soak were not run locally.
Injected errors and the real filesystem obstruction establish the exercised
classification/cleanup behavior, not every filesystem or field failure mode.
