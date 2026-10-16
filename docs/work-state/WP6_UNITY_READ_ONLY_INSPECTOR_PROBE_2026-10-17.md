# WP6 Unity read-only Inspector property observation — 2026-10-17

## Intent and strict boundary
Move one step beyond server-only WP6 pre-wire validators: gather a **local, in-memory, read-only snapshot** of a deliberately allowlisted saved Unity Scene Component's typed SerializedProperties. This does NOT connect to server authority, approve property edits, send messages, mutate Component values, auto-repair conflicts, create a baseline, or claim live Inspector sync.

- Exact source component types: BoxCollider (m_IsTrigger boolean, m_Center vector3, m_Size vector3) and SphereCollider (m_IsTrigger boolean, m_Center vector3, m_Radius float). No generic MonoBehaviour, Prefab source or references.
- Check saved Scene asset GUID, loaded Scene, matching stable GlobalObjectId for the GameObject and Component, nonzero IDs; avoid relying on Component Inspector order or names.
- Require exact Unity SerializedProperty types and allowlisted paths; bound vectors/floats and reject invalid/NaN/infinite values; return no partial observations when one field fails.
- C# output stays in-memory and immutable/read-only; no Undo, no EditorUtility.SetDirty, no network serialization or shared mutable state. A locally dirty Scene may be observed but is **not** a saved or authoritative baseline.
- Test with actual Unity EditMode assets including duplicated same-type Components, saved/reloaded Scene, unsaved scene, unsupported types, out-of-range values, and no side effects.
- Public source only; Windows r8 stays FIELD_BLOCKED and awaits two physical PCs. Existing user worktrees remain untouched.

## Recovery and rollback
A failed probe returns a safe reason and no partial observation; no local/remote state has changed. Remove this isolated Editor-only helper/tests/docs to roll back. Default runtime path never calls it.

## Source checkpoint
Branch `feat/wp6-unity-readonly-probe-20261017` from `main` `8d0f385`; at creation no tests run. Exact-head CI/Unity automated tests required before merging.


## Implementation checkpoint

- Unity Editor-only `TeamForgeWp6InspectorProbe`: captures exact Box/Sphere Collider SerializedProperty shapes with bounded boolean/vector3/float values and read-only snapshot records. No arbitrary SerializedObject iteration, no component writes or network bridge.
- Verifies Scene asset GUID and matching `GlobalObjectId` identifiers for saved GameObject/Component; no type/index guess and no fallback to unsaved identity.
- EditMode NUnit tests cover two same-type colliders, typed values, saved scene reload, unsaved Scene, unsupported Transform, corrupt/out-of-bounds values and no Undo/scene dirtiness from the probe itself.
- GitHub CI Unity EditMode and source checks required to validate actual Unity compilation and behavior; local Linux host has no Unity Editor binary. Physical two-Windows-PC evidence remains separately required.
