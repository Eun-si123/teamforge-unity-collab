# TeamForge Phase 4 v0.5.0 Hotfix4 Report

Date: 2026-08-08 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Product version: `0.5.0`
Scope: EditMode regression-harness correction for the Hotfix3 create-to-Transform fix. No runtime/product protocol change.

## Field trigger

The user ran the Hotfix3 EditMode suite. The newly-added regression `AuthoritativeHierarchyCreateRearmsSelectedTransformTrackingAndPreservesPendingDelta` failed before reaching the authoritative-create re-arm assertions:

- expected selected-lock status to contain `clean Scene baseline`;
- actual status was `No GameObject selected.`

The failure occurred at the test's initial selection-status assertion, before `ApplyHierarchyAuthoritativeState(...)` was invoked.

## Finding

The regression test assumed that assigning `Selection.activeGameObject` synchronously dispatches `Selection.selectionChanged` inside the same Test Runner assertion frame. Unity EditMode Test Runner does not guarantee that event timing. Therefore the test could observe the previous selection status even though the target object had been assigned.

This is a test-harness defect. It does not by itself disprove or prove the Hotfix3 runtime re-arm fix.

## Fix

`TeamForgeTransformModelTests.cs` now:

- assigns the target as the active GameObject;
- explicitly invokes the private Transform selection-tracking entry point with `requestImmediately=false` through reflection;
- asserts that Unity's active selection is the intended target;
- then verifies the expected pre-authority `clean Scene baseline` rejection;
- continues with the original authoritative hierarchy admission, re-arm, and pending-delta assertions.

This makes the regression deterministic and tests TeamForge behavior instead of Unity editor-event scheduling.

`scripts/validate-repository.mjs` now requires the regression to explicitly invoke the selection-tracking entry point, preventing this timing dependency from being reintroduced.

## Runtime delta from Hotfix3

None. `TeamForgeTransformSyncService.cs`, hierarchy runtime code, server code, Project Peer code, protocol DTOs, dependencies, and persistent identity formats are byte-for-byte unchanged from Hotfix3.

## Validation in this environment

- Repository validator: PASS.
- Repository-owned `.mjs` syntax: PASS.
- Full npm test/smoke rerun: NOT RUN in this Hotfix4 container because the exact locked `ws@8.21.1` tarball was not present in the local npm cache and `npm ci --offline` stopped with `ENOTCACHED` before installing dependencies.
- The Server and Project Peer source trees are unchanged from Hotfix3; their previous Hotfix3 automated evidence remains previous-build evidence rather than a falsely claimed Hotfix4 rerun.
- Unity Compile/EditMode: NOT RUN here. User rerun required.

## Required field retest

1. Replace the Unity package with Hotfix4.
2. Run EditMode `Run All`; expected total remains 71 and all 71 must pass.
3. Repeat the targeted two-Editor path: creator makes a new GameObject, keeps it selected, peer receives it, creator moves it without deselect/reconnect, lock is acquired, peer Transform converges.
4. Do not advance to Reparent/Reorder/Delete until that targeted runtime path passes.
