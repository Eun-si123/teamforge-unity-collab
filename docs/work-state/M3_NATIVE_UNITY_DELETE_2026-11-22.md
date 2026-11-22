# Ordinary Unity Hierarchy Delete for a signed shared Cube/Sphere — implementation checkpoint

**Development-only stacked Draft. Not field-ready.** This change is based on PR #607 (native M1–M4 Editor workflow) and must be reconciled with it before any merge. No two-physical-Windows-Editor evidence and **no execution of the new Unity E2E case** has been performed for this commit.

## User flow

For an **already approved and selected** exact built-in root Cube/Sphere with **no children**, in a saved signed Scene, when its current Coordinator edit lock is owned by this Editor:

1. The Editor remembers the original GameObject identity, built-in primitive template, Hierarchy revision, Scene, M2 epoch and the exact native shape **before** any deletion. Merely highlighting a name is not enough; unknown Prefabs/imported meshes, added custom components, altered default collider/material/transform, unadmitted Scenes and foreign locks do not qualify.
2. When the user presses Unity's ordinary Hierarchy Delete (represented by `Undo.DestroyObjectImmediate` in the E2E), the Hierarchy observer uses the **existing M3 `delete_object` operation with `componentEpoch`**, which is committed atomically with the M2 Collider catalog by the Coordinator. No TeamForge menu, new protocol, guessed native aliases, or extra Publisher trust is involved.
3. The deleted object stays in Unity's native Undo history. A **verified exact** server receipt must name that same single deleted object and only expected root-sibling shifts. A denied request does not claim success or recreate an unrelated object: the user is instructed to use Unity Undo, and the Scene is held for explicit recovery.

The Collider observer can tick before the Hierarchy observer; it therefore defers classifying **only this witnessed exact native root deletion** as an independent M2 Component removal. Other missing/edited Colliders retain their existing fail-closed review. A delayed Unity `ObjectChangeEvents` notification re-arms the normal Hierarchy scan without sending a duplicate operation. A new shared create, a child subtree delete, a custom Renderer/Material, or a Prefab stays outside this path.

## Authenticated authority and user-data rules

- The same previously admitted Scene, Project, session epoch, exact object identity and server-owned edit lease are required at intent capture **and** immediately before sending.
- The changed root member count and order must exactly match the signed pre-delete snapshot minus the deleted root. A server receipt can change only siblings after the removed root, shifting their indices by one while preserving name, parent, primitive template, original creation revision and local Transform. Any unrelated differences pause reconciliation, not overwrite them.
- Server refusal, ambiguous local changes, delayed lock, missing pre-delete witness or inability to prove the exact current authority all **do not** authorize a network deletion. The original Unity Undo remains the recovery method; this implementation does not claim offline or arbitrary Prefab deletion.
- This is **not a proof** that the feature works on actual Unity builds until the E2E and cross-client tests run; release remains `FIELD_BLOCKED`.

## Future verification

The existing Unity + real Node signed M3 fixture (`TeamForgeColliderStructureE2ETests`) is amended to select and lock the native Cube, wait for the exact pre-delete witness, invoke Unity's built-in Undo deletion, and then assert the same server-backed M2 Component tombstone and Hierarchy object removal without duplicate components. Follow with both supported Unity 6.3 CI versions, Windows Launcher installation, two separate Windows Editors, lock-loss and reconnect/Undo cases. These are **written or specified, not claimed as passed**.
