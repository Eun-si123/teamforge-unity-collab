# TeamForge Phase 4 v0.5.0 Hotfix2 Report

## Trigger

The user field-tested Hotfix1 in Unity `6000.3.21f1`. All 70 EditMode tests passed, but the Editor emitted two `CS0618` warnings for `Resources.InstanceIDToObject(int)` in the hierarchy identity registry.

## Finding

The Hotfix1 substitution was incomplete for Unity 6000.3: the `Resources` int-based API is itself obsolete. Unity 6000.3 provides `Resources.EntityIdToObject(EntityId)`, so the correct cleanup is to keep the registry's ephemeral live-object map in `EntityId` form end-to-end rather than converting through legacy int Instance IDs.

## Changes

- `TeamForgeHierarchyIdentityRegistry.cs`
  - `Dictionary<int, string>` -> `Dictionary<EntityId, string>` for the live forward map.
  - `Dictionary<string, int>` -> `Dictionary<string, EntityId>` for the live reverse map.
  - `GetInstanceID()` -> `GetEntityId()` inside the registry.
  - `Resources.InstanceIDToObject(int)` -> `Resources.EntityIdToObject(EntityId)`.
  - Persistent JSON remains based on logical IDs + GlobalObjectId and is unchanged.
- `scripts/validate-repository.mjs`
  - Rejects any `InstanceIDToObject` in the registry.
  - Rejects registry-local `GetInstanceID`.
  - Requires `EntityId` map, `GetEntityId()`, and `Resources.EntityIdToObject(...)`.
- Work-state/test evidence documents updated with the user's 70/70 Hotfix1 result and Hotfix2 pending field gate.

## Automated verification

On the Hotfix2 working tree, after restoring locked dependencies with `npm ci --offline`:

- Server 49/49 PASS.
- Project Peer 62/62 PASS.
- Repository validator PASS.
- Smoke PASS; `serverRelayUsed=false`.
- `.mjs` syntax 48/48 PASS.
- Offline audit reports 0 vulnerabilities.

## Unity status

Hotfix2 itself has **not** been compiled by Unity in this environment. Required user gate: no TeamForge CS0618 warnings or compile errors, then EditMode `Run All` remains green.
