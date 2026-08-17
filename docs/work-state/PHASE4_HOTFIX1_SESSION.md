# Phase 4 v0.5.0 Hotfix1 session

Date: 2026-08-08 (Asia/Seoul)

## User field evidence

Initial candidate compilation in Unity 6000.3.21f1 produced CS0177 at `TeamForgeHierarchySyncService.cs` lines 1142/1161 and CS0618 at `TeamForgeHierarchyIdentityRegistry.cs` lines 138/182.

## Fixes

1. Initialize the `EnsureAndApplyObject` out diagnostic to `string.Empty`.
2. Replace obsolete `EditorUtility.InstanceIDToObject` calls with `Resources.InstanceIDToObject`.
3. Add repository-validator regression guards.
4. Record the initial candidate as superseded for Unity field validation.

## Automated evidence after patch

- Server 49/49 PASS.
- Project Peer 62/62 PASS.
- Validator PASS.
- Smoke PASS, `serverRelayUsed=false`.
- `.mjs` syntax PASS.

## Next action

Build/fresh-validate a Hotfix1 candidate, then user reruns Unity 6000.3.21f1 compile and EditMode `Run All`.
