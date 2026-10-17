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

Listener cleanup is committed as `6a82302`; transfer integration, real Server/
Seed restart and Host orchestration passed **22/22**. Cancellation failures were
also reproduced during materialization, Publisher approval and pre-aborted
activation. Optional cancellation now flows from sync to activation, preserves
the old Active pointer before the final directory move, checks cached/final
verification, and avoids false network-unavailable progress on pause. After the
directory move begins, existing atomic commit/cleanup finishes without a
mid-commit cancellation check.

Managed/Swarm/Guest orchestration/refresh regression tests passed **66/66**;
transfer integration including real approval-cancel → cached retry passed
**8/8**. Peer syntax check passed (74 modules). Implementation and tests are
saved locally pending the cancellation commit. Next: whole-repository regression
and improve the Launcher feedback that currently ignores progress `state`.

Cancellation changes are committed as `c9db68d`. The Launcher presentation now
uses the actual phase, keeps verification busy after byte completion, rejects
NaN/Infinity counters, and ignores queued progress while paused. A small pure
Core presentation owner replaces the old UI-local parser; no trust/launch
decision moves into presentation.

Installed the contract-selected .NET SDK for local checks. WPF Launcher and UI
tests **cross-build with zero warnings/errors**. The new Core progress regression
passes. The full Core executable reports **28/34** on Linux; an isolated baseline
checkout reports **27/33**, with the same six Windows path/locking fixture
failures. Do not call this a full Core PASS; Windows execution is still required.
Diagnostics support-bundle tests passed. Two new native WPF regressions are
compiled but not executed locally. Whole-repository `npm test` is running.

Launcher feedback is committed as `c05ec31`; draft PR
[#289](https://github.com/Eun-si123/teamforge-unity-collab/pull/289) preserves the
reviewable work. A final lifecycle review found a related pause-control race:
the runtime event could apply before its ACK, after which the UI toggled the
confirmed state back. The handler now applies the requested state. A native
real-Bridge regression gates the ACK until the actual UI event handler has run,
then waits for the UI continuation before checking both pause and resume.

The complete local `npm test` passed: Server **194/194**, Peer **239 passed / 5
platform skips**, plus workflow, documentation, candidate, maintainability,
engineering, Test Lab and public-source checks. Both production dependency
audits report zero known vulnerabilities. Maintainability review flags growth
of the existing Peer engine and Swarm owner; changes remain confined to their
existing lifecycle/cancellation responsibilities, with one shared endpoint
startup helper. No unrelated large-file refactor was added.

## Investigation outcome and remaining work

This batch implements recovery/stability foundations already aligned with the
roadmap, rather than enabling an unproven general Inspector protocol. Current
Server realtime state and Coordinator registries remain memory-resident; project
payloads still travel directly between Peers. There is no new offline merge,
server persistence, relay, Component mutation or authentication mode.

| Reviewed item | Current source/evidence and remaining boundary |
| --- | --- |
| Host onboarding #222 | Source already has generated access codes, masking/copy/regeneration and Host-address selection. A trusted-LAN no-code mode is not added; keep exposed listeners authenticated. Recheck the source changes in a new selected package. |
| Host timeout #223 | Source has commit-stage diagnostics; this batch additionally preserves exact handshake errors and clears stale connection state. The original physical timeout's root cause is not established or declared fixed. |
| One-paste invite #224 | Reusable access codes remain separate. Scoped/expiring Guest authorization needs an explicit contract before implementing this convenience. |
| Guest retry code #225 | Source already scopes code retention to the current invite/window; existing tests remain. Physical packaged evidence remains separate. |
| Foreign-lock UX #79 | Notices exist, but transient SceneView gizmo motion and two-Editor input timing still need physical observation; authority checks are not weakened. |
| Windows identity #182 | Intermittent unsupported-lock report remains a watch item; no fail-closed lock behavior is relaxed without a reproducer. |
| Search indexing #255/#256 | Third-party sitemap/IndexNow reporting issues are separate from runtime reliability. No working sitemap/key is replaced. |

No existing Issue is automatically closed on source-only evidence. The open
Dependabot branches and immutable published r8 stay unchanged. Future work is
still required for WP6 authority/identity/replay/Undo/reconnect contracts before
live editing, durable Session recovery, wider Prefab/Asset support and external
testing. Module READMEs own the new behavior, CODEMAP the new presentation owner,
and ROADMAP (English/Korean) the completed recovery foundation versus future
direction. STATUS's capability/package/field classification remains unchanged.

### One-batch manual validation for a newly selected package

Keep the existing [Test Lab](../TEST_LAB.md) exact-artifact discipline. Test these
changes together after packaging this branch; the published r8 does not contain
them. Record the new tag/commit/ZIP/hash and keep its evidence separate.

1. On two physical Windows PCs, start Host → invite → Guest receive → Publisher
   approval → verified Active → Unity. Confirm byte completion shows verification
   rather than implying launch readiness.
2. Pause/resume rapidly during transfer, cached resume and verification. Verify
   the button/notice agree, delayed progress never erases a confirmed pause, and
   a late control ACK never reverses the requested state.
3. Cancel during file preparation or the Publisher dialog, before final
   activation. Confirm the prior Active project remains selected, verified
   chunks are reused on retry and no Unity handoff opens the cancelled attempt.
   A cancellation after the final directory move begins finishes the existing
   atomic activation; it is not a rollback request.
4. Interrupt Coordinator/network, retry authentication and stop/start Host.
   Confirm stale availability is revoked, current errors are meaningful, fresh
   state is received and direct transfer resumes without orphan processes/ports.
5. Continue Presence/Transform/Hierarchy/lock-contention and saved/fresh Guest
   reconnect checks under the existing field plan. Keep UAC/firewall, preferred
   port fallback, process-loss identity and long/deep-path checks separate from
   source automation; their existing release gates remain open.

## Completion checkpoint

Implementation units are committed on the task branch (plan `8e6b396`,
Coordinator `659e26a`, source retries `b424d83`, listener cleanup `6a82302`,
cancellation `c9db68d`, receive feedback `c05ec31`, pause ACK race `f390d87`).
This final documentation unit records the completed investigation, behavior,
remaining backlog and combined manual plan. Verify live branch/HEAD rather than
treating this dated record as a later release status.

Local source checks, regression tests, documentation/translation-source pins and
Windows cross-build are complete with the explicit Linux Core limitations above.
Final Windows/Unity/CodeQL CI results and the exact checked head are owned by
[PR #289](https://github.com/Eun-si123/teamforge-unity-collab/pull/289). No local
uncommitted implementation is required to resume. Next safe action after source
review/CI is selecting a new packaged candidate and running its one-batch field
plan; this task neither merges main nor replaces/publishes release artifacts.
