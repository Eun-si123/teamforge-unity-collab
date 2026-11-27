# M4→M5 internal SQLite rollback — 2026-11-24

Draft PR #620; product release state **FIELD_BLOCKED**. No live promotion, automatic rollback or public rollback endpoint.

## Implementation

The earlier M4→M5 SQLite repin commits all candidate Session checkpoints, exact prior M4 backups and a recovery journal in one transaction. This change implements its inverse **at the SQLite storage boundary only**:

- `rollbackProjectTransitionCheckpoints` requires the exact Project ID, UUID, transition ID and old/new signed descriptor hashes. It verifies the full journal, backup set, candidate checkpoints, and absence of accepted operations under the quarantined candidate epochs.
- In one SQLite transaction, copy every original M4 checkpoint's canonical bytes back without changing its accepted revision, publication, Hierarchy, Transform, Collider content or lineage. Assign distinct fresh epochs, not the original M4 or proposed M5 epochs, to fence delayed messages. Preserve unrelated Projects and historic operation receipts.
- Update the same checksum-verified journal to `sqlite_rolled_back`, with each restored Session's fresh epoch/checksum. Keep all original backups and original candidate descriptor/manifest hashes, epochs and checksums. The discarded candidate checkpoint projection is **not** separately archived; it contained no accepted new edits and the candidate signed source remains in its existing store. No journal or source files are removed.
- Retrying the identical recovery request returns the existing outcome without rotating any epoch a second time. Invalid identities and corrupt records fail closed. Read-only connections cannot roll back.
- The recovery diagnostic now distinguishes the actual restored M4 SQLite pin from the candidate M5 pin and rejects a stale journal observation if an internal rollback occurs during signed source inspection.
- Older software that does not recognize the new journal stage fails closed. No table/schema migration is needed. Realtime writes and startup restoration remain blocked by the unresolved journal even after rollback.

## Windows CI regression

Both Windows realtime transport recovery jobs at previous SHA `2f34db6` failed with EBUSY unlinking sessions.sqlite or sessions.sqlite-shm after the new checkpoint-planning test. The readonly store was registered in a later cleanup hook than the fixture directory removal. Close the readonly SQLite observer using try/finally in the test body before fixture teardown. Linux test passes; Windows fix requires confirmation on the new SHA.

## Regression evidence

Disposable SQLite tests exercise two distinct saved Sessions, exact original backup restore, fresh epochs, retained historic receipts, unaffected unrelated Project, wrong identity, replay, read-only refusal, corrupt restored checkpoint detection, storage failure after the first real SQL UPDATE, process SIGKILL after the first uncommitted row UPDATE (POSIX) and after COMMIT before a reply. The midpoint-crash test verifies the entire candidate generation survived unchanged and a later rollback succeeds. Signed-source diagnostic tests cover the Host still pointing at M5, restored SQLite pointing at M4, runtime restoration remaining blocked even after matching Host M4, and a concurrent rollback during chunk verification.

## Checks on Ubuntu Mini PC, Node 24.22.1

- Server: 510 PASS, 0 FAIL (seven additional rollback/recovery regressions).
- Cross-phase Node: 165 PASS, 0 FAIL (overlaps Server).
- Server syntax, smoke, engineering/documentation/workflow policy and public-source validation: PASS; release remains FIELD_BLOCKED.
- Project Peer full suite is not repeated in this batch (no Project Peer source changes; prior commit 651 PASS / 6 environment SKIP); cross-phase coverage was rerun.
- Windows Node 22/24 rerun and current-SHA Unity CI are not yet verified.

## Remaining release boundary

Storage rollback is internal, not a live recovery UI or a crash-consistent Host/Guest transaction. Need an authenticated durable cross-store intent, source and pointer reconciliation, Guest-specific recovery, durable commit/rollback acknowledgements and explicit safe journal resolution before allowing Editors to resume. No actual two-Windows-PC Unity field verification performed. Keep Draft and FIELD_BLOCKED.
