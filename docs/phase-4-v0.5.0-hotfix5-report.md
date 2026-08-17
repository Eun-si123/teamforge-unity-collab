# TeamForge Phase 4 v0.5.0 Hotfix5 Report

Date: 2026-08-08 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Product version: `0.5.0`
Scope: prevent non-Transform Hierarchy operations from rolling a peer back to stale Transform coordinates, and keep Server Hierarchy transform records coherent with accepted Transform updates.

## Field trigger

Two Editors successfully propagated rename in both directions and Basic Lock ownership remained correct. However, after rename, the observing peer showed the renamed object's Transform as `(0,0,0)` even though the editing peer retained the live non-zero coordinates. As soon as the lock owner moved the object again, the observer received a Transform update and converged.

This is a real Phase 4 integration defect, not expected lock behavior.

## Root cause

Two independent assumptions combined:

1. The Server's authoritative Hierarchy record stored the Transform captured at hierarchy seed/create/reparent time, but ordinary accepted `transform_update` messages updated only `session.transforms`. The Hierarchy record therefore became stale.
2. The Unity remote Hierarchy apply path treated every changed Hierarchy record as a full object state. A `rename_object` acknowledgement contained the stale Hierarchy Transform, and `EnsureAndApplyObject(...)` reapplied that stale value while changing the name.

The next normal Transform update then corrected the peer, which exactly matches the field symptom. The same mechanism could also affect sibling records returned by create/reparent/reorder canonicalization.

## Runtime fix

### Server

When an accepted `transform_update` targets an authoritative Phase 4 Hierarchy object, the Server now updates that Hierarchy record's `localPosition`, `localRotation`, and `localScale` in the same revision. The update is rollback-safe and checks both the Transform snapshot limit and the Hierarchy snapshot limit before committing.

This keeps late-join `hierarchy_snapshot` records coherent with the retained Transform snapshot. `hierarchyRevision` is not advanced by a pure Transform edit.

### Unity package

Remote `hierarchy_applied` handling now applies Transform fields only to the operation target for:

- `create_object`;
- `reparent_object`.

`rename_object` and `reorder_sibling`, plus sibling records changed only by canonical ordering, preserve the peer's current live Transform. Snapshot materialization still applies complete Transform state because initial/late-join snapshot recovery requires it.

`EnsureAndApplyObject(...)` also performs only the fields that actually changed rather than unconditionally reassigning name/parent/Transform/sibling state.

## Regression coverage

- Server integration test: accepted Transform -> rename -> changed Hierarchy record preserves the live Transform, and a late-joining hierarchy-capable peer receives the same live Transform in both Hierarchy and Transform snapshots.
- Unity EditMode regression: applying a remote rename with an intentionally stale Hierarchy Transform changes the name while preserving the current local Transform.
- Repository validator requires both protections.

## Automated verification

Working-tree execution after the fix:

- Server: **50/50 PASS**.
- Project Peer: **62/62 PASS**.
- Repository validator: **PASS**.
- Server + Project Peer smoke: **PASS**; Project payload relay remains `serverRelayUsed=false`.
- Repository-owned `.mjs` syntax: **PASS**.
- Offline audit: **0 vulnerabilities**.

Unity `6000.3.21f1` Compile/EditMode cannot be run in this container. The new Unity test increases the expected EditMode total from 71 to **72**.

## Required field retest

Hotfix5 changes both Server and Unity runtime code. The user must restart the Server from Hotfix5 and replace the Unity package in both Editors before testing. Required targeted result:

1. Unity EditMode `72/72 PASS`.
2. Connect two Editors to the restarted Hotfix5 Server.
3. Use a new or existing synchronized object at a clearly non-zero Transform.
4. Rename A -> B and B -> A without moving the object.
5. Both peers must retain the same non-zero Transform immediately after each rename.
6. Basic Lock ownership must continue blocking the non-owner.

Do not advance to Reparent/Reorder until this regression is field PASS.
