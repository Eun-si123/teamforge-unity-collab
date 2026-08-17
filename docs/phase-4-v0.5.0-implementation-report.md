# TeamForge Phase 4 v0.5.0 Implementation Report

Date: 2026-08-07 (Asia/Seoul)

## Conclusion

Phase 4 Hierarchy Synchronization has been implemented as a `0.5.0` candidate on top of the frozen Phase 3 closure archive. The implementation keeps Realtime Protocol v1 through additive capability negotiation and preserves the Phase 3 metadata-only Coordinator / Direct P2P Project payload architecture.

The implementation is **not yet declared Unity-validated** in this execution environment because Unity Editor/C# compiler execution is unavailable here. Node/server/static evidence is recorded separately in the Phase 4 test report. The exact candidate must still pass Unity `6000.3.21f1` Compile/EditMode and two-Editor manual validation.

## Frozen input

- Input: `Unity-TeamForge-Phase3-v0.4.1-closure.zip`
- SHA-256: `b9c45dba18dbc984804a8fdb7548a78d9f580ae5649d89bd032f37cefd106f5a`
- Phase 3 closure is not modified in place.

## Implemented vertical slice

### Server

Added an authoritative in-memory hierarchy model and integrated it into the existing Session revision stream. Supported operations are create, delete, rename, reparent and sibling reorder. Server behavior includes:

- additive hierarchy capability negotiation;
- authoritative hierarchy seed and late-join snapshot;
- explicit authoritative `sceneIds`, including empty Scenes;
- exact hierarchy revision preconditions;
- deterministic sibling canonicalization;
- logical ID validation for newly created objects;
- subtree tombstones and resurrection rejection;
- target/parent/subtree lock conflict checks;
- retained Transform/Lock cleanup on delete;
- Presence selection cleanup after deletion;
- Phase 2-only authority guard for Phase 4 authoritative Scenes;
- bounded object/tombstone/depth/snapshot limits;
- aggregate health counters for hierarchy Scenes/objects/tombstones.

The Coordinator remains memory-only for hierarchy state and still has no Project payload write/relay path.

### Unity package

Added `Editor/HierarchySync` with:

- `TeamForgeHierarchyIdentityRegistry`
- `TeamForgeHierarchyModel`
- `TeamForgeHierarchySyncService`

Saved objects retain `GlobalObjectId`. New unsaved objects receive `tf:<32 lowercase hex>` logical identities. Mapping is local generated state under `Library/TeamForge` and is intentionally excluded from project transfer.

Unity observes hierarchy changes through `ObjectChangeEvents.changesPublished` plus a rename fallback. Authoritative hierarchy state is applied without adding normal remote Undo entries, and stale target Undo is cleared. Local unsafe or rejected structural edits fail closed and are reverted when possible.

The Transform service now accepts authoritative hierarchy create/reparent/delete changes so Phase 2 Transform baseline state remains coherent with Phase 4 hierarchy state.

### Realtime protocol

Protocol version remains `1`. Additions are capability/DTO/message types only:

- `supportsHierarchySync`
- `hierarchySyncEnabled`
- `hierarchy_seed`
- `hierarchy_seed_accepted`
- `hierarchy_snapshot`
- `hierarchy_operation`
- `hierarchy_applied`
- `hierarchy_conflict`

Hierarchy and Transform share the same Session revision stream.

### Product/UI

Product version is `0.5.0`. The Collaboration window exposes a Hierarchy Sync status row and hierarchy diagnostics counts while keeping the existing Connection/Presence/Transform/Lock/Project Bootstrap surfaces.

## Safety decisions

- No Scene metadata Component is inserted for identity.
- Object names and Hierarchy paths are never identities.
- Cross-Scene moves and Prefab Stage/Prefab structural collaboration are out of scope and fail closed.
- General Component/Asset synchronization is not implemented.
- Persistent operation history and server restart recovery are not implemented; those remain Phase 5.
- A clean local Scene whose object identity set cannot safely match the first authoritative snapshot is rejected instead of guessing identity or duplicating objects.

## Phase 3 closure improvements retained

The Phase 3 closure baseline already carries:

- Windows long Active-path warning;
- successful Sync resume counters;
- unchanged republish guard with explicit force override;
- clarified `publish` versus `seed` workflow;
- explicit partial-seed bandwidth option naming.

All remain part of the `0.5.0` source.

## Files and rollback

Detailed changed files are in [changed-files-v0.5.0](changed-files-v0.5.0.md). Rollback guidance is in [rollback-v0.5.0](rollback-v0.5.0.md).
