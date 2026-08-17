# TeamForge Phase 4 v0.5.0 Hotfix6 Report

Date: 2026-08-08 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Product: `0.5.0`
Protocol: `1`

## Trigger
During the tombstone field gate, Editor B disconnected while the object still existed locally. Editor A deleted the object. While offline, B renamed/moved the stale object and then reconnected. The server correctly rejected B's stale lock/Transform request with `hierarchy_object_deleted`, but B's local stale GameObject remained visible instead of being removed by the authoritative reconnect snapshot.

## Root cause
The server tombstone state was correct. The Unity client rejected the first reconnect Hierarchy snapshot before applying it whenever the loaded Scene was dirty. Offline rename/move made the Scene dirty, so `CanApplyInitialSnapshot` stopped reconciliation before the tombstone-delete materialization path ran. This made the dirty-Scene safety guard accidentally stronger than delete/tombstone authority.

## Fix
- Reconnect initial snapshots now apply **only authoritative tombstone deletes first**.
- After tombstone cleanup, a dirty Scene is allowed to continue only when every remaining live GameObject can be matched to the authoritative snapshot and its name, parent, sibling index, and local Transform already match authority.
- Unknown local objects, missing authoritative live objects, or divergent live rename/reparent/reorder/Transform state still fail closed and are not overwritten.
- Tombstone deletion also clears the live logical-ID cache entry.
- Component-only dirty state on otherwise matching live objects is not overwritten by Hierarchy reconciliation.

This is intentionally a narrow exception to the dirty-Scene guard: **delete/tombstone authority wins; unrelated live edits remain protected.**

## Regression coverage added
- `InitialSnapshotDeletesOfflineEditedTombstoneAndAcceptsMatchingDirtyLiveHierarchy`
- `InitialSnapshotStillRejectsDirtyLiveHierarchyDivergenceAfterTombstoneCleanup`

Expected Unity EditMode count increases from Hotfix5's 72 to **74 tests**.

## Non-changes
- Server source: byte-for-byte unchanged from Hotfix5.
- Project Peer source: byte-for-byte unchanged from Hotfix5.
- Protocol remains v1.
- Direct P2P Project payload architecture is unchanged.
- No Phase 5 persistence is introduced.

## Validation in this environment
- Repository validator: PASS.
- `.mjs` syntax: PASS, 46/46 files.
- Server source comparison vs Hotfix5: 17 files, 0 changed.
- Project Peer source comparison vs Hotfix5: 38 files, 0 changed.
- Full Node reinstall/test could not be rerun because this environment does not currently contain the locked `ws@8.21.1` tarball and the package gateway returns 404 for it. Hotfix5's 50/50 server and 62/62 Project Peer evidence therefore remains prior evidence for byte-identical Node source, not a newly executed Hotfix6 Node PASS.
- Unity Editor is unavailable in this container; exact Hotfix6 compile/EditMode and two-Editor reconnect behavior remain field gates.

## Required targeted field retest
1. Replace `com.eunsung.teamforge` in both Editors with Hotfix6. Server restart is not required because server source is unchanged from Hotfix5.
2. Run EditMode and require **74/74 PASS**.
3. Connect A and B and create `TF_Tombstone_HF6`.
4. Disconnect B only.
5. Delete the object on A.
6. While B is offline, rename and move B's stale object.
7. Reconnect B.
8. Expected: B's stale object disappears automatically; A never resurrects it; no further `hierarchy_object_deleted` loop remains for that object.
9. Then verify a separate live object's unsaved rename while disconnected still causes a fail-closed reconnect warning rather than being silently overwritten.
