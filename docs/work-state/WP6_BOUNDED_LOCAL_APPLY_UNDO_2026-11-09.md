# WP6 bounded local-only Inspector write and Undo experiment — 2026-11-09

## Problem, scope and rationale

The WP6 source-only chain now identifies exact saved Scene
BoxCollider/SphereCollider Components (#506), collects complete
limited snapshots (#507), checks clean saved Scene bytes (#512),
and checks actual text-YAML serialized values against the Editor
observations (#513). Server-side prototypes (#509–#510) inspect
complete observations and Publisher-signed approvals separately,
and an existing pre-wire transaction simulates revision/lock/replay.
Before connecting a new network feature, Unity still needs a
narrowly specified **actual Inspector write** with correct Undo
and stale-state semantics, not a direct field assignment disguised
as a synchronized operation.

This PR stacks one change on #513. It does not modify that branch,
the independent read-only comparison #508, the Server/Project Peer
PRs, network dispatch or production Editor behavior.

## Intended behavior and invariants

- Explicit internal `TryBeginForLocalTest` accepts an expected
  source baseline/meta hash and a nonnegative bounded *test*
  revision, capturing a complete local serialized-value witness.
  Expected values and test revision are **not authenticated**;
  the helper is for deliberately controlled Unity Editor tests
  only. Freeze the copied Scene-source expectation before use.
- A single `TryApplyForLocalTest` accepts a local test record
  identifying one exact owner/Component GlobalObjectId, narrow
  `m_IsTrigger`, `m_Center`, `m_Size` or `m_Radius` value and
  consecutive revision. It revalidates the full clean saved
  source/value witness, all observed Collider state, exact live
  Component resolution, typed serialized property and numeric bounds.
- Refuse stale/gapped revisions, changed Scene/Component/owner,
  wrong type/path, unexpected shape, unsupported values, no-op
  changes and untrusted operation-ID format **before opening Undo**.
  Never search by GameObject name or Component index. No automatic
  Scene save, reimport, broadcast, new network route, project
  activation or disk mutation.
- Use `SerializedObject.ApplyModifiedProperties()` within a
  uniquely named Unity Undo group for one bounded property,
  reread exact values, and attempt to revert the newly opened
  group if the actual result mismatches. Do not swallow an error
  into a success. Failures after a partial write require operator
  recapture; the rollback attempt is best effort.
- A successful local test preview is **one-shot**. Identical
  operation ID/payload replays return a local acknowledgement
  **only if the complete current Collider inventory equals the
  accepted after-image**. Undo or a changed live Scene requires
  a fresh witness/revision. Same ID with altered content is never
  acknowledged.
- Explicitly **do not** interpret an AppliedRecord as a signed
  authority packet or a valid Session grant. No Server registry,
  Owner/Publisher signature, lock ownership, session epoch or
  authenticated peer is checked here. Direct invocation is only
  appropriate inside a disposable local Editor test Scene.

## Risk, negative tests and merge evidence

Write/Undo is high-risk even for an internal source-only
prototype. NUnit EditMode checks actual Unity SaveScene with
multiple same-type BoxColliders and nested SphereCollider,
one exact bounded property write and one-step Unity Undo,
replayed identical operation without duplicate Undo, replay
rejected after Undo, conflicting same-ID replay rejected,
stale/gapped revisions, wrong IDs/owners/type/path/kind,
NaN/negative float and forged metadata, no-op rejection,
unchanged Undo group/revision on preflight refusal, and
dirty/local-state conflict.

Local checks: C# syntax parsing, repository source/docs/
engineering/workflow validation, meta GUID uniqueness and
one-commit independent diff review. Only **actual Unity
Editor NUnit** can establish C# semantic API compatibility,
SerializedObject Undo behavior and real saved Scene behavior.
CI and physical Windows Host/Guest evidence remain separate;
no live network feature or released product functionality is
claimed. The earlier read-only #513 Unity workflow was pending
when this work began, so its eventual result is a dependency.

## Rollback, next phase

Revert the single stacked commit; no schema migration, production
Session mutation or release artifact change. Reject a failed
partial write conservatively and do not try to resynchronize
by guessing. Next separate WP6 work: a server-issued,
cryptographically/contextually authenticated applied operation
delivery with durable session-epoch/authority fencing, safe
duplicate/rejection/Undo-repair semantics, and a deterministic
two-Editor integration test. Only after those gates should a
normal user-facing Collider Inspector change be enabled.
