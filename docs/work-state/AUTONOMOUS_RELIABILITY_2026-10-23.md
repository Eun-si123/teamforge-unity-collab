# Autonomous reliability pass — 2026-10-23

This is a dated engineering record, not current release-readiness authority.
Current capability and physical gates remain in [STATUS](../STATUS.md).

## Selection and baseline

The user authorized evidence-backed autonomous discovery, implementation and
verification across the project. The selected outcome is more reliable existing
collaboration and honest test evidence before expanding synchronized features.
Baseline: `1874b6cdf3f241255ae78426b8099b676d2ed686`.
Branch: `agent/reliability/seed-lifecycle-evidence-20261023`.

Live GitHub inspection found six open PRs (#310, #319, #320, #321, #322, #323).
Their complete changed-file lists were checked through the connected GitHub API;
this pass changes none of those files. The standalone preflight CLI failed its
GitHub read and is **not** recorded as successful. Connector reads verified the
base and overlap separately. This is a snapshot, not an exclusive task lease.

Three independent investigations reproduced failures beyond the issue queue:

| Owner | Reproduced behavior | Smallest correction |
| --- | --- | --- |
| Server Hierarchy model | Duplicate object IDs passed validation, then collapsed into one Map entry with the last record winning. A whitespace-wrapped logical ID also entered a saved baseline after normalization. | Validate the same normalized ID that is stored; use `Set.has` before `Set.add`. Correct the same membership error in ancestry traversal. |
| Direct Seed | `start()` followed immediately by `stop()` could return from shutdown before asynchronous binding, then open a listening port. Duplicate starts and synchronous bind-error cleanup also failed. | Retain the pending start promise through shutdown, share owned starts/stops, refuse starts during shutdown, and remove temporary event listeners on either bind outcome. |
| Unity shell test helper | Editor exit 0 with missing XML reported success; stale XML/log remained available. | Require a fresh, well-formed NUnit result with positive passes, consistent nonnegative counts and no failures/inconclusive tests. Preserve nonzero Editor exit status and allow intentional skips alongside real passes. |

## Plan, invariants and rollback

- Risk is high for authority/input and lifecycle correctness. Reject ambiguous
  baseline identities before changing Session state; preserve valid unique saved
  IDs, duplicate display names, depth bounds, revisions and lock semantics.
- Shutdown retains ownership of a pending bind, prevents overlapping listeners,
  aborts/drains existing work, and allows explicit restart after awaited stop.
  Authentication, transfer hashes, payload limits and port fallback stay intact.
- Missing, malformed, stale, skipped-only or failed evidence must fail the shell
  helper. Synthetic Editor tests exercise only the wrapper, never Unity behavior.
- No protocol/schema, runtime version, persistence or activation migration.
  Each correction is a separate commit and can be reverted independently.
- No release, merge, deployment, firewall change or packaged-byte replacement.

## Evidence

On Linux with Node 24.19.0:

- Hierarchy regressions: baseline **14/18 passed, 4 failed**; corrected **18/18
  passed**. Full Server suite: **209 passed, 0 failed, 0 skipped**. Authority
  regression verifies the entire existing Session remains unchanged on rejection
  and a later valid seed still succeeds.
- Direct Seed lifecycle regressions: baseline **1/6 passed, 5 failed**; corrected
  lifecycle plus existing Direct Transfer tests **27/27 passed**. Full Project
  Peer suite: **255 passed, 0 failed, 5 Windows-only skips** (260 total).
- Independent lifecycle review: **100** real concurrent start/stop cycles,
  occupied-port failure, pending shutdown, clean retry, authenticated request
  and restart passed without a remaining listener or temporary event listeners.
- Initial shell regressions: baseline exposed **15 failed assertions** across
  seven methods; corrected **7/7 methods passed**, including invalid XML/counts,
  stale evidence, spaced paths, intentional skips and preserved exit code 7.
- Real WebSocket authority chaos **18 checks**, stress **39 checks**, and recovery
  **14 checks** passed. Stress/recovery used seed `12648430` only, not the complete
  multi-seed CI matrix. The initial local harness omitted CI's short lease and
  timed out at lease expiry; correcting the harness to the workflow's 2500/3000 ms
  settings resolved it without a production change.
- Interrupted Project Transfer E2E passed: previous Active preserved, three
  verified chunks reused on resume, revision 2 activated without another trust
  prompt. Server/Peer smoke and syntax checks passed (76 Peer modules).
- Documentation, engineering, workflow policy (23 workflows, four policy tests),
  public-source validation, 14 Test Lab scenario validation, whitespace and
  maintainability checks passed. Independent Hierarchy review found no blocker.

Final aggregate checks and the shell concurrency follow-up are recorded in the
task PR after completion. Source fixes are initially saved as `9365f62`,
`12e0913`, and `7d46ba0`; later evidence/commits must be checked on the live branch.

## Limits and next candidates

Unity Editor, Windows GUI, physical two-PC and exact packaged-artifact execution
were not available locally. Five Windows-only Peer tests were skipped. Source
results do not update immutable r9 bytes or close physical release gates.

Two separate findings remain candidates for the next bounded pass:

1. `SwarmDownloader` treats a local `store.put()` `ENOSPC` as a remote peer
   failure. A local reproduction with two healthy sources fetched/wrote twice
   and ended with `direct_transfer_unavailable`. Separate local storage failure
   from retryable source failure before adding retries or changing diagnostics.
2. Launcher `BridgeClient` stops its stdout reader after a protocol failure but
   may admit later requests, leaving retries pending. This is source-review
   evidence only; reproduce with the existing synthetic-child harness on .NET
   before changing terminal-state/request-registration ordering.

These candidates are not fixes, field evidence or a reason to broaden this patch.
Physical recovery/onboarding gates in STATUS remain a higher-level release
constraint; automation cannot honestly substitute for those observations.
