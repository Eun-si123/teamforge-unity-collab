# Phase 4 — Hierarchy Synchronization

- Product version: `0.5.0`
- Unity target: Unity 6.3 LTS, manual gate `6000.3.21f1`
- Realtime Protocol: v1 additive capability
- Status: implementation candidate; Node/static gates must pass and Unity Compile/EditMode + two-Editor field gate remain required

## Scope

Phase 4 adds realtime hierarchy operations without changing the Phase 3 Direct P2P payload architecture:

- GameObject create
- GameObject delete, including authoritative subtree tombstones
- GameObject rename
- Parent change within the same saved Scene
- Sibling order change
- hierarchy conflict handling and late-join snapshot

Phase 4 deliberately does **not** add general Component synchronization, Prefab Asset/Prefab Stage collaboration, Scene create/delete/rename, cross-Scene object moves, Asset Database synchronization, persistent operation history, or server-side Project payload storage. Persistent recovery remains Phase 5.

## Capability and compatibility

Protocol v1 is retained with additive `supportsHierarchySync` / `hierarchySyncEnabled` capability negotiation. Hierarchy Sync requires Presence and Transform Sync. Phase 0–3 clients continue to negotiate only the features they support.

Once a Scene is seeded as an authoritative Phase 4 hierarchy, a Phase 2-only connection cannot acquire Transform/Lock authority in that Scene. This prevents an older client from structurally editing a hierarchy it cannot understand. Other Phase 0–3 realtime behavior remains available.

## Identity model

Saved baseline GameObjects continue to use Unity `GlobalObjectId`. A GameObject created during an active Phase 4 session receives a logical ID in the form:

```text
tf:<32 lowercase hex>
```

The logical identity is never derived from Object name, Hierarchy path, Runtime Instance ID, or sibling order. Unity keeps logical-to-Global bindings in local generated state at `Library/TeamForge/hierarchy-ids-v1.json`; TeamForge does not insert metadata Components into Scenes.

Because this mapping is local and Phase 5 persistence is not implemented, a freshly republished Project baseline must not be guessed against an older live hierarchy session. Initial snapshot application fails closed when a clean local Scene contains objects not represented by the authoritative hierarchy identity set. The safe MVP boundary is to keep the Project baseline and hierarchy session aligned, or restart/reseed the hierarchy after publishing a new baseline.

## Server authoritative model

The Coordinator retains only bounded in-memory hierarchy metadata:

- authoritative Scene IDs, including empty authoritative Scenes
- hierarchy object records
- tombstones
- shared Session revision
- recent operation fingerprints for idempotence

Hierarchy and Transform operations share the same Session `serverRevision`. Hierarchy operations require exact `baseRevision == serverRevision`; stale or future operations are rejected rather than silently merged.

Each hierarchy object record carries Scene/object identity, name, parent, canonical sibling index, local transform, created revision, and hierarchy revision. Tombstones prevent a deleted logical ID from being recreated later in the same Session.

## Operations

Supported operation kinds:

```text
create_object
delete_object
rename_object
reparent_object
reorder_sibling
```

Create and reparent carry the local transform so the authoritative hierarchy and Phase 2 Transform baseline remain coherent. Sibling indices are canonicalized deterministically by the server; out-of-range requested indices clamp to the valid range.

Delete is subtree-aware. The server removes retained Transform state and locks for deleted identities, records tombstones, and clears stale Presence selections that point at deleted objects.

## Lock and conflict policy

Exact revision is the primary ordering guard. Existing Basic Locks are also respected:

- a target locked by another connection blocks its hierarchy edit;
- parent child-list mutations are blocked when an affected current/destination parent is locked by another connection;
- subtree delete is blocked if any deleted descendant is locked by another connection.

Missing parent, parent cycle, stale revision, deleted/reused ID, unseeded authoritative Scene, invalid logical ID, unsafe Prefab/cross-Scene context, object/snapshot safety limit, or incompatible older-client authority all fail closed.

Rejected local Unity edits attempt to revert through Undo instead of silently retaining an unapproved local hierarchy state.

## Unity change observation

Unity Editor integration uses `ObjectChangeEvents.changesPublished` and relevant Object Change kinds for create/delete/reparent/child-order changes. `hierarchyChanged` is retained as a bounded fallback for rename detection. The service does not rescan every Editor update.

Remote authoritative hierarchy application does not intentionally create normal user Undo history. Stale target Undo is cleared before remote authoritative state is applied.

## Bounds and defaults

Server defaults:

| Limit | Default |
| --- | ---: |
| Input WebSocket message | 1,048,576 bytes |
| Hierarchy objects | 2,048 |
| Hierarchy tombstones | 4,096 |
| Hierarchy snapshot | 1,048,576 bytes |
| Hierarchy depth | 256 |
| GameObject name | 128 characters |
| Retained transforms | 512 |
| Session locks | 256 |

All limits are configurable through documented `TEAMFORGE_*` environment variables. Increasing them changes resource exposure and should be accompanied by load testing.

## Completion gate

Phase 4 is not complete until all of the following are true:

1. Server, Project Peer, repository validator, syntax, smoke and fresh-extract gates pass.
2. Unity `6000.3.21f1` compiles the exact candidate with Console Compile Error 0.
3. EditMode `Run All` reports Failed 0, including hierarchy tests.
4. Two-Editor manual tests pass for create/delete/rename/reparent/reorder, late join, lock/revision conflicts, delete tombstones and Phase 0–3 regression.
5. Phase 3 Publish/Invite/Sync/Active remains functional and Coordinator still reports no Project payload relay.
6. No Critical/High unresolved regression remains.

Phase 5 must not start automatically after this gate.
