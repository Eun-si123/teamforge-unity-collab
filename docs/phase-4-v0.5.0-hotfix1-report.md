# TeamForge Phase 4 v0.5.0 Hotfix1 Report

Date: 2026-08-08 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Product version: `0.5.0` (candidate hotfix; no released-version bump)

## Trigger

The initial Phase 4 v0.5.0 candidate was actually opened by the user in Unity 6000.3.21f1. C# compilation exposed a release-blocking definite-assignment defect and two obsolete-API warnings.

## H4-001 — `CS0177` in authoritative hierarchy apply

`EnsureAndApplyObject(..., out string error)` returned `true` from the no-change path and from the successful apply path without assigning `error`. Unity C# compilation therefore rejected the package.

Fix: initialize `error = string.Empty` immediately after `target = null`. Every failure path still sets a specific diagnostic before returning `false`.

## H4-002 — obsolete live instance lookup

Unity 6000.3 reports `EditorUtility.InstanceIDToObject(int)` as obsolete. The hierarchy identity registry only needs to resolve objects that are already loaded in the current Scene and already validates Scene validity/load state. Hotfix1 therefore uses `Resources.InstanceIDToObject(int)` for both cached live-ID lookups.

## Regression protection

`validate-repository.mjs` now:

- rejects `EditorUtility.InstanceIDToObject` in the hierarchy registry;
- requires `Resources.InstanceIDToObject`;
- requires `EnsureAndApplyObject` to initialize `error` before successful control flow.

## Actual post-patch evidence

- Root `npm test`: PASS.
  - Server: 49/49 PASS.
  - Project Peer: 62/62 PASS.
  - Repository validator: PASS.
- Root smoke: PASS; direct P2P still reports `serverRelayUsed=false`.
- Repository `.mjs` syntax: PASS.
- Locked `ws@8.21.1` tarball used for offline install matched the lockfile SHA-512 exactly; dependency and lockfiles were not changed.

## Remaining release gate

Unity Hotfix1 compile/EditMode is **NOT RUN after this patch**. The next field action is to test the rebuilt Hotfix1 candidate in Unity 6000.3.21f1. No Phase 4 field PASS is claimed until compile errors are zero and EditMode `Run All` passes.
