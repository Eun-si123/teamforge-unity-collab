# TeamForge Phase 4 v0.5.0 Hotfix3 Report

Date: 2026-08-08 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Product version: `0.5.0`
Scope: Phase 4 Hierarchy-to-Transform integration hotfix only. Phase 5 is not started.

## Field trigger

Two connected Unity Editors successfully converged on the newly-created `TF_Create_Test` hierarchy object and rename operation, but the selected object's Transform did not converge. Editor A reported `Object is not in the clean Scene baseline...` while Editor B could acquire a lock. The screenshot showed different Y positions for the same logical object.

## Root cause

Unity selects a newly-created GameObject before TeamForge receives the server-authoritative `create_object` acknowledgement. The first Transform selection callback therefore runs before the logical object has been added to the Transform baseline and intentionally refuses to track it. The Phase 4 hierarchy acknowledgement later upserted the baseline but did not retry Transform selection tracking. The creator could therefore remain permanently untracked until an unrelated selection change/reconnect.

A second edge case exists in the same window: the creator may move the new object while `create_object` is in flight. Re-arming tracking must not silently treat that newer local value as the confirmed authoritative create transform, otherwise no Transform delta would be emitted after lock acquisition.

## Fix

`TeamForgeTransformSyncService.ApplyHierarchyAuthoritativeState(...)` now:

- remembers the single active selection when it is not currently tracked;
- detects when the authoritative hierarchy change just admitted that exact logical object into the Transform baseline;
- retries Transform selection tracking after the baseline is persisted;
- requests the lock when Transform Sync is actively connected;
- if the local Transform changed while the create operation was in flight, preserves the server-approved create Transform as `_lastObservedState`, `_lastConfirmedState`, and `_stateAtLockRequest`, marks the selection dirty, and leaves the local value in place so the post-lock delta can be sent;
- does not change protocol version, logical-ID persistence, server hierarchy state, or Project Transfer behavior.

## Regression coverage

Added EditMode source test `AuthoritativeHierarchyCreateRearmsSelectedTransformTrackingAndPreservesPendingDelta` to verify:

1. a selected logical object is initially rejected when it is absent from the Transform baseline;
2. hierarchy authority upserts that object and automatically re-arms Transform tracking;
3. an in-flight local Transform delta is retained locally;
4. the last confirmed/observed/lock-request state remains the server-approved create Transform so the delta remains sendable after lock acquisition.

Repository validation now requires both the re-arm wiring and this regression test.

## Automated evidence in this environment

- Server: 49/49 PASS.
- Project Peer: 62/62 PASS.
- Repository validator: PASS.
- Unity C# compile/EditMode: NOT RUN in this environment.

## Required field retest

Use the exact Hotfix3 package in Unity `6000.3.21f1`:

1. Compile with zero TeamForge errors/warnings introduced by Hotfix3.
2. EditMode `Run All`; expected test count increases from 70 to 71 and all must pass.
3. With two connected Editors, create a new empty GameObject in A and leave it selected.
4. Confirm B receives it.
5. Move the new object in A without deselect/reconnect.
6. Confirm A reaches `Lock owned` / Transform synchronized and B converges to the same Transform.
7. Only after this targeted regression passes continue with Reparent/Reorder/Delete/Conflict/Late Join.
