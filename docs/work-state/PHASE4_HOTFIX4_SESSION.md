# Phase 4 v0.5.0 Hotfix4 session

Date: 2026-08-08 (Asia/Seoul)

## Trigger

User field Hotfix3 EditMode regression failed at `TeamForgeTransformModelTests.cs:416`: expected `clean Scene baseline`, actual `No GameObject selected.`

## Diagnosis

The failure occurs before the authoritative hierarchy apply. The test relied on `Selection.activeGameObject = target` synchronously firing `Selection.selectionChanged`. That event timing is not deterministic under Unity EditMode Test Runner.

## Change

The regression now explicitly invokes `BeginTrackingSelection(false)` after assigning the test target and asserts the active selection before checking the missing-baseline state. Product runtime code is unchanged from Hotfix3.

## Evidence

- Repository validator PASS.
- `.mjs` syntax PASS.
- Full npm rerun blocked before install by absent local cached `ws@8.21.1` tarball (`ENOTCACHED`). No dependency or lockfile was changed.
- Unity Hotfix4 71/71 and targeted two-Editor create+move retest remain pending user execution.
