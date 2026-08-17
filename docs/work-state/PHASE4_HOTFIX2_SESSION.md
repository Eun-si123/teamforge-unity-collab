# Phase 4 v0.5.0 Hotfix2 session

Date: 2026-08-08 (Asia/Seoul)
Target Unity: 6000.3.21f1
Scope: Phase 4 warning cleanup only; no Phase 5 work.

## User field evidence

- Hotfix1 package compiled successfully in Unity 6000.3.21f1.
- Unity Test Runner EditMode: **70/70 PASS**.
- Two compile warnings remained in `TeamForgeHierarchyIdentityRegistry.cs`:
  - line 138: `Resources.InstanceIDToObject(int)` obsolete; use `EntityIdToObject`.
  - line 182: same warning.
- Therefore Hotfix1 is functionally green in EditMode, but not warning-clean for the target Editor.

## Root cause

Hotfix1 replaced obsolete `EditorUtility.InstanceIDToObject(int)` with `Resources.InstanceIDToObject(int)`. Unity 6000.3.21f1 also marks the Resources int-based overload obsolete. Unity 6000.3 exposes `Resources.EntityIdToObject(EntityId)`, and `Object.GetEntityId()` is available in the 6000.3 line even though Unity's 6000.3 Object API index has incomplete EntityId documentation.

## Hotfix2 implementation

- The live hierarchy identity cache now uses `UnityEngine.EntityId` keys instead of legacy `int` Instance IDs.
- `GameObject.GetEntityId()` replaces registry-local `GetInstanceID()` calls.
- `Resources.EntityIdToObject(EntityId)` replaces both obsolete `Resources.InstanceIDToObject(int)` calls.
- The persisted format remains unchanged: only logical IDs and GlobalObjectId strings are persisted; EntityIds remain live-session-only.
- Repository validator now rejects `InstanceIDToObject` and registry-local `GetInstanceID`, and requires EntityId dictionary/GetEntityId/EntityIdToObject wiring.

## Automated evidence on working tree

After a required `npm ci --offline` because the working tree intentionally had no `node_modules`:

- Server: 49/49 PASS.
- Project Peer: 62/62 PASS.
- Repository validator: PASS.
- Server + Project Peer smoke: PASS; direct project payload relay remains false.
- `.mjs` syntax: 48/48 PASS.
- Offline audit: 0 vulnerabilities.

## Honesty boundary / next gate

This environment cannot compile the C# package with Unity. Hotfix2 must therefore be field-tested in Unity 6000.3.21f1. Required next evidence:

1. Console has no TeamForge `CS0618` warnings for `InstanceIDToObject`.
2. Console has no red compile errors.
3. EditMode `Run All` remains 70/70 PASS (or explain any test-count change before claiming success).


## 2026-08-08 user field rerun — Hotfix2 compile/EditMode gate

- User reports Unity `6000.3.21f1` now opens the Hotfix2 package without the previous TeamForge `CS0618 InstanceIDToObject` warnings.
- Unity Console has no blocking TeamForge compile errors reported.
- EditMode Test Runner: **70/70 PASS**.
- Result: Hotfix2 Artifact/Compile gate PASS for the field environment.
- Next manual gate: two-Editor Phase 4 hierarchy E2E (Presence/RTT + Phase 2 regression baseline first, then Create/Rename/Reparent/Reorder/Delete/Conflict/Late Join).
