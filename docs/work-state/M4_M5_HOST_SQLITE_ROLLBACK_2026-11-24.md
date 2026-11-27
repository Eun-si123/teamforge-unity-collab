# M4→M5 offline Host + SQLite rollback — 2026-11-24

Draft PR #620. Product release remains **FIELD_BLOCKED**. This is an internal offline recovery primitive, not live promotion or a public rollback endpoint.

## Existing behavior reused

- Existing SQLite `rollbackProjectTransitionCheckpoints` restores the exact saved M4 Session checkpoints atomically with fresh epochs, original revisions, retained historic receipts, and the unresolved `sqlite_rolled_back` journal.
- Existing signed publication readers and complete chunk audit independently verify both the old M4 and candidate M5 sources.
- Existing `published.lock` exclusive lock filename and flushed atomic JSON publication are retained, not replaced with a new locking mechanism.

## Implementation

`rollbackOfflineHostTransition({store,managedRoot,request,signal})` requires a writable SQLite store, the exact pending Project/UUID/transition/old+new descriptor hashes and a trusted offline caller. The caller must stop Coordinator, Host, Guest Editors, Seeds and other writers before recovery.

1. Acquire the existing Host publication lock. Reject missing/conflicting Host pointer, invalid signed sources, changed SQLite journal, stale pointer, or another owner of the lock.
2. Audit both signed manifests and content. Persist `metadata/host-transition-recovery.json` **before** changing either SQLite or the Host pointer, using the existing flushed exclusive metadata writer. The marker records the exact transition, original observed pointer, intended restored pointer, and recovery timestamp.
3. Roll back SQLite via its existing atomic/idempotent primitive. Verify the journal and marker again.
4. When necessary, replace the Host pointer with the verified old M4 pin using the flushed temporary-file + atomic rename writer. Preserve an already correct M4 pointer byte-for-byte. For a reconstructed M4 pointer, use the recorded recovery timestamp, not a fabricated original approval time.
5. Confirm the Host pointer, retained marker and restored SQLite stage. An identical retry can finish an interrupted cross-store rollback without rotating epochs or changing the correct pointer again.

The marker is intentionally retained. Normal Peer publish validation, source descriptor repair, seed startup/reconnect and sync refuse even an unreadable marker. The regular Publisher now holds the existing lock across Coordinator approval, local pointer update and Unity source descriptor update; ordinary pointer writers check the recovery fence under that same lock. Read-only diagnostic operations and immutable stored sources remain available.

## Failure and compatibility boundaries

- Abort/failure after SQLite rollback leaves both the durable SQLite journal and Host marker. A later exact retry resumes at the verified saved state. A Host pointer changed by another process is refused, not overwritten.
- A forced process death can leave the preexisting exclusive `published.lock`. It is deliberately **not** auto-deleted. The test removes it only after independently observing its own isolated child exit. A real operator must verify no writer owns it before resolving the lock. New code cannot make unsupported filesystems or older binaries that ignore the marker obey the fence.
- The offline method does not assert that already-running Seeds, independent Guest stores, arbitrary external writers, or the Unity source tree are quiescent. The caller must establish these conditions. Guest Active, Unity source descriptor, and actual project assets are **not** rolled back by this method.
- Requires both signed content sets to verify; damaged candidate data prevents this automated internal path even if the old backup is intact. Existing read-only diagnostics and backups are retained for a separate recovery path. Windows does not expose portable directory fsync; the existing file-flush semantics are reused, not a physical power-cut guarantee.
- No journal or recovery marker is cleared, no live Editor resumes, and no production path invokes the recovery function. Full Guest reconciliation, authenticated orchestration, safe finalization, user-facing recovery, and real two-Windows-PC Unity field tests remain necessary.

## Tests

- Real SQLite/Host file rollback, exact retry, already-correct M4 pointer retention, wrong transition identity and pointer conflict; lock contention; damaged signed chunk and malformed fence; cancellation after SQLite commit; refusal to overwrite a subsequently changed Host pointer.
- Actual POSIX SIGKILL after SQLite rollback but before Host pointer update, then retry only after the test-owned dead process is proven stopped and its lock is explicitly removed.
- Actual Project Peer entry points refuse a damaged recovery marker before seeding, validating publication, repairing the Unity source descriptor or syncing. The shared lock rejects an existing lock without replacing it.
- Recovery test fixture now closes SQLite stores before directory cleanup, preventing the Windows file-lock teardown failure pattern.
- Prior SHA `6cc8bc8`: verified both Windows realtime transport recovery checks succeeded (Node 22.23.2 and 24.19.0). This does not establish the new SHA or physical two-PC Unity field verification.


## Validation results (Ubuntu Mini PC, Node 24.22.1)

- Server 515 PASS / 0 FAIL, including five new Host+SQLite recovery tests.
- Cross-phase Node 165 PASS / 0 FAIL (overlaps Server and Peer).
- Project Peer 653 PASS / 0 FAIL / 6 environment SKIP (659 total), including two new normal-entry/lock regressions.
- Server and Peer syntax checks (Peer 130 modules), smoke, engineering/documentation/workflow and public-source release validation PASS. `git diff --check` PASS.
- New-SHA Windows and Unity CI and physical two-Windows-PC verification remain unconfirmed.
