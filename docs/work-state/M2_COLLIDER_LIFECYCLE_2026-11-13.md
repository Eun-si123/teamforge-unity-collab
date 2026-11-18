# M2 Collider lifecycle implementation checkpoint

## Scope, base and active ownership

Owner-approved continuation after M1 source implementation and automated Unity
roundtrip evidence. The new user operation is: add Box/SphereCollider through
authority, add another of the same type, edit it, save/reopen/reconnect and remove
the exact selected Component without confusing its peer's native Unity IDs.

Integration writer: Convergence Agent. Branch:
`agent/teamforge/m2-collider-lifecycle-live-20261113`.
Base: hourly M2 `3f59477b97c8ef128b296c185f26b4d0e32e02c0`, which already
includes verified M1 `cd45bff38b2bd2f55900beb280de7f92bbd0cbfa`.
The original hourly branch and commits are preserved. Its two-file reservation
ledger is preflight evidence, not working network/Unity add/remove. No open M2
PR existed at the initial live check. M1 #533 and independent #535 remain open.

The last hourly run completed at 02:02 UTC with a clean source branch. The owner
then requested continued development here. The automation prompt now reserves
M2 authority/protocol/runtime identity/Unity mutation to this integration writer;
the existing hourly schedule and enabled state are unchanged. Hourly independent
Launcher/Windows/field work may continue. Recheck actual activity and remote
heads before publishing or handing off; a branch/prompt is not an atomic lock.

Delegated owners are disjoint: server runtime/transport and its WS tests;
Unity binding/catalog/digest and topology transaction; Unity connection/service
and UI; new actual Unity/Node lifecycle fixture. The integration writer owns
workflow evidence gates, this checkpoint, validation, review and PR publication.

## Required behavior and protected boundaries

- Preserve strict saved-Scene initial witness, signatures, bounded reads and
  immutable source admission. Runtime logical IDs are accepted only as part of
  the server's already admitted catalog; a logical ID alone grants no write.
- Negotiate structure capability separately from properties. A structure Scene
  cannot give edit/lock authority to a property-only client. Existing M1 default
  behavior remains covered by its regression suite.
- Commit identity catalog, exact typed property rows, tombstone, common Session
  revision and operation result atomically under the live GameObject lease.
  Only exact BoxCollider/SphereCollider types and server defaults are allowed.
- Add/remove must continue across dirty edits. Runtime recovery cannot repeat
  the old saved-only seed check or require the original component count. Empty
  runtime catalogs must support reconnect and re-add; signed empty initial
  catalogs use an explicit structure-only admission path.
- New logical IDs are bounded `tf:c:<32 lowercase hex>` identities. Ordinary
  operations cannot reuse a deleted identity. Explicit conditional compensation
  may restore a recorded own deletion; newer target changes make compensation
  refuse rather than overwrite someone else's work.
- Bind each canonical ID to an exact local Component/owner/Scene/context. Persist
  bounded atomic local aliases after save, independently on each Editor. Never
  infer identity by type, name, Inspector position or an unrelated local Collider.
- Bind catalog, tombstones and properties into the versioned snapshot digest.
  Verify source, epoch and digest before native create/delete or property writes.
- Preflight Unity types, ownership, Prefab scope and RequireComponent constraints.
  On partial failure undo only this apply's changes/aliases, retain local work and
  report an explicit conflict. Native global Undo rollback is not a recovery API.
- Server commit, Editor report and disk persistence remain separate. Server
  restart durability is M4; no new package/release/field claim is authorized.

## Wire and runtime contract

Source opt-in `TEAMFORGE_COMPONENT_STRUCTURE_SYNC=1` depends on M1 property sync
and the configured managed signed Project store. Hello negotiates
`supportsComponentStructureSync` / `componentStructureSyncEnabled`.

`component_structure_set` carries request/operation ID, epoch, Scene and current
base revision, add/remove kind, exact owner/Component/type, expected Component
revision and optional own compensation operation ID. Successful
`component_structure_applied` carries a full authenticated runtime snapshot plus
operation metadata. A retry returns the recorded result; a conflicting reuse is
refused. A receiver applies the snapshot's exact catalog, not a native type index.

Structure snapshot v1 uses digest prefix `teamforge-collider-snapshot-v2` and
binds source fields, epoch, Scene, shared revision, structure revision, ordered
Component catalog, ordered tombstones and ordered typed properties. Original M1
digest v1 remains unchanged when structure is disabled.

## Evidence required and current state

Implementation is in progress; changes are saved on the integration branch and
are not yet published. No new M2 PASS or milestone-complete claim is made.

Automated checks must exercise actual WebSocket add/edit/remove, same-type
multiplicity, stale source/epoch/revision/lease, immutable operation replay,
tombstone reuse, compensation refusal, empty-catalog recovery and byte/count
limits before mutation. Run Node 22/24 server checks and appropriate Peer,
repository, workflow and identity regressions.

Actual Unity CI must execute the production add/edit/save/reopen/remove case,
including exact local binding, remote Node peer changes and lost ACK/reconnect.
Require its named passing NUnit case and source-linked Editor/Node evidence;
helper tests and Node simulations do not substitute for this execution.
Physical two/three-Editor Windows LAN, eight-Editor soak and a new exact packaged
artifact remain **NOT RUN** unless independently executed and recorded.

Next safe step: finish the connected runtime and Editor apply path, validate the
same saved source with real WS/Unity tests, independently review identity and
partial failure boundaries, then publish a stacked feature PR against #533.

## Server implementation checkpoint — 2026-11-13

The saved production server now implements separate structure negotiation,
signed saved-owner eligibility and empty signed Scene admission, atomic
catalog/property/tombstone commits, continuous logical-ID property edits,
conditional structural compensation, shared operation replay and empty-catalog
recovery. Existing strict saved-only validators keep their default behavior.
Structural replay returns a current full snapshot and the original
`operationRevision`; it does not retain a full snapshot per history entry.

Full server tests: **410 PASS / 0 FAIL / 0 SKIP** on both Node **22.23.2** and
**24.22.1**, including ten actual M2 WebSocket cases, five runtime atomicity/budget
regressions, new operator configuration cases and all prior M1/WP6 tests.
Server syntax checks pass. Independent review reproduced a property-budget gap
at 7,744 bytes; the fix now refuses before mutation and preserves the same
revision, property values, snapshot hash and immediate recovery. The reviewer
reran the original counterexample successfully after the fix.

The new real CI fixture also passed a clearly **Node-only** smoke: actual signed
publication/admission, Node remote add/edit, owned relay ACK suppression,
all-peers disconnect/rejoin and empty-catalog/re-add. Synthetic Unity result
markers were not used. This smoke does not count as Unity execution.

Workflow guards **38 PASS** and all NUnit/evidence parser regressions **17 PASS**
locally. The new gate requires the exact production lifecycle NUnit case, all
seven behavior flags and matching Editor/Node source pins. These parser fixtures
do not count as product evidence. Unity production binding/topology/service and
the actual NUnit case are being completed/reviewed; **M2 Unity execution remains
NOT RUN locally**. Package and physical evidence remain NOT RUN.

The integration source is saved on the named M2 branch. The hourly agent's later
runs respected the M2 reservation; independent new #536/#537 harness changes do
not overlap server/Unity ownership and are not imported into this feature.
Next: finish receiver rollback/binding tests, compile/run the complete lifecycle
through actual Unity CI, then publish/validate the bounded feature PR. No source
handoff, main merge or release has occurred at this checkpoint.

## Integration resumed — 2026-11-18

The hourly run confirmed its work remained outside the M2 integration area.
`main` advanced to `ea9f7ce` with CI dependency installation and agent guidance.
The M1 stack still points at `cd45bff`, so the lifecycle PR can target that
branch and show reviewers only the M2 changes.

Related work subsequently appeared in #553–#555. They share the original
`3f59477` reservation ancestry. #553 and #554 exercise local Unity operations
and saved identity witnesses. #555 gates a wire reservation on current signed
membership and a live lock. This integration applies equivalent boundaries at
the production commit and receiver, and exercises the saved-removal assertion
after reopening the shared Scene. The original PRs and their commits remain
available for review.

`cf1cbfa` saves the server authority, `29763a0` adds the actual signed-source
Unity/Node fixture, `d52d854` adds local ID binding and `69b6d06` adds native
topology application and rollback. The Editor service integrates these pieces
with negotiated controls, conditional inverse requests and recovery of lost
results. Node 24 server checks reran at 410 PASS. The workflow and parser checks
pass locally. Unity CI will determine whether the implementation compiles and
whether the named production lifecycle case executes successfully. The Windows
LAN and release artifact scenarios remain untested.
