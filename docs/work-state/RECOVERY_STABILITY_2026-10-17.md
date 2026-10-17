# Recovery stability investigation — 2026-10-17

## Scope and baseline

Repository baseline: `6de9b89aca061a12bb59504949ca14fd9f7f163a` (`main`).
Task branch: `fix/collaboration-recovery-20261017`. The checkout was clean;
the two open Dependabot PRs (#287, #288) are independent and remain untouched.

Reviewed the root README/AGENTS, engineering/governance/documentation guides,
STATUS, ROADMAP, architecture, source map, recent commits/PRs, open issues and
current CI. Implemented collaboration is Presence, Transform/Lock, same-Scene
Hierarchy and signed direct project bootstrap. Component/Inspector work remains
an isolated read-only/pre-wire foundation; Prefab/Asset sync, durable Session
restart recovery and Internet traversal remain future work. Published r8 and
later source changes have different evidence boundaries.

The user-visible objective is dependable Host → Guest → verified Project and
recovery, before adding a new synchronized data model. Current investigation:

1. Coordinator connection attempts share mutable socket/handshake state. An old
   close/message can affect a replacement; cached snapshots can conceal a failed
   new handshake; simultaneous connects can create competing sockets.
2. Discovery and chunk retry bookkeeping uses display peer IDs as unique keys.
   Duplicate labels can suppress a healthy source or exhaust discovery with an
   internal exception instead of a bounded transfer error.
3. Seed and partial-Seed endpoint preparation happens after binding but before
   the cleanup guard. Invalid advertised configuration can leave a listener
   alive after startup reports failure.
4. Cancellation boundaries during cached-chunk verification and final checking
   need regression coverage; verified data must remain resumable.

## Change plan

Risk: **high** for lifecycle/recovery; changes remain local and reversible.
Project Peer owns socket attempts, source scheduling and listeners. Server
authority, shared revisions, locks, signed descriptors, hashes, trust, path
containment and atomic Active activation remain unchanged. No protocol/schema,
supported runtime, packaging identity or default optimization policy changes.

Implement per-attempt Coordinator lifecycle ownership and immediate handshake
settlement/cleanup. Keep display labels separate from source retry identity.
Put all post-bind failures under listener cleanup. Check cancellation before
reporting completed verification or proceeding toward activation.

Negative cases: stale transport events, overlapping connect, close during
handshake, rejected reconnect after a successful snapshot, duplicate labels with
healthy/failed peers, cancellation with a fully cached project, invalid endpoint
after bind, and repeated stop. Preserve the first meaningful error and verified
chunks; do not invent authority or weaken fail-closed checks to recover.

Required evidence: tests that reproduce failures before fixes, focused tests,
real Coordinator/Seed integration and interruption/resume tests, Server/Peer
suites, source/static checks and repository/documentation/workflow validators.
Unity Editor, Windows/WPF and exact-package/physical two-PC evidence are separate
and must be explicitly marked when unavailable.

Documentation owners: this dated record for investigation/checkpoints/results;
project-peer README and changelog for developer-facing behavior; roadmap for
completed recovery foundations and remaining work. No historical field result
or immutable release artifact will be rewritten.

## Checkpoint

The initial plan is committed as `8e6b396` on the task branch. Baseline `npm test`
passed, including Server/Peer tests and source/docs/workflow/engineering gates;
platform-specific skips remain skips. No Unity or .NET executable was found in
this Linux environment.

Coordinator lifecycle: four focused regressions **failed before the fix**
(overlapping handshakes, cached-snapshot reconnect rejection, close during a
replacement handshake, stale transport events). After isolating attempts and
clearing retired state, the complete Coordinator tests plus real Server publish/
announce and Coordinator-restart Seed integration passed (**15/15**). These are
source/loopback tests, not Windows package or physical evidence.

Coordinator implementation is committed as `659e26a`.

Duplicate-label discovery/chunk failover regressions reproduced an internal
exception and suppression of a healthy source. Retry/exhaustion now uses actual
source instances; replica-count and speculative-request conservatism remains.
Combined Coordinator, real Server integration and complete Swarm tests passed
(**58/58**). Listener/cancellation investigations remain planned. Verify live
branch/HEAD and worktree before resuming; subsequent commits update this record
at each coherent work unit.

Duplicate-label fix is committed as `b424d83`. Invalid advertised configuration
reproduced leaked Host and Guest partial-Seed listeners in four cases. Both
start paths now share endpoint setup/cleanup; conflicting endpoint options are
rejected before binding. Full transfer integration, real Server/Seed restart,
and Host orchestration regression results are recorded in the next checkpoint.
Cancellation during final verification or its progress callback also reproduced
a false successful download; cancellation/activation work is in progress.
