# Phase 4 Hierarchy Synchronization session

Date: 2026-08-07 Asia/Seoul

## Frozen baseline
- Exact Phase 3 closure ZIP: `Unity-TeamForge-Phase3-v0.4.1-closure.zip`
- SHA-256: `b9c45dba18dbc984804a8fdb7548a78d9f580ae5649d89bd032f37cefd106f5a`
- Stage B source was freshly extracted from that ZIP; no Stage A/Hotfix archive is modified in place.

## User-approved scope
Hierarchy Synchronization only: create/delete/rename/reparent/sibling order/conflict handling. Phase 5 persistence remains out of scope.

## Initial architecture choices to implement
- Protocol v1 additive `supportsHierarchySync` capability.
- Server-authoritative hierarchy registry shares the same session revision stream as Transform operations.
- New unsaved objects use a session logical object ID (`tf:<32-hex>`) assigned at create time; names/Hierarchy paths/Instance IDs are never identity.
- Existing saved objects continue using GlobalObjectId strings and can participate without Scene metadata components.
- Server retains an in-memory hierarchy snapshot + bounded tombstones only; no persistent DB/log.
- Remote apply uses TeamForge remote-apply scope and explicit Undo clearing/record suppression.

## 2026-08-07 takeover implementation progress
- Assistant took over Stage B implementation after Codex quota exhaustion.
- Stage B remains based on exact frozen Phase 3 closure SHA-256 `b9c45dba18dbc984804a8fdb7548a78d9f580ae5649d89bd032f37cefd106f5a`.
- Added initial pure server Hierarchy model module `server/src/hierarchy-model.mjs` with bounded seed validation, logical `tf:` identity format, deterministic sibling canonicalization, cycle/depth checks, tombstones, exact revision preconditions, operation fingerprints, snapshot sizing, and prepare/commit separation.
- Phase 5 persistence remains explicitly out of scope.

## 2026-08-07 assistant takeover — hierarchy safety hardening
- Server hierarchy integration now blocks edits when an affected current/destination parent child-list is locked by another connection.
- Delete now also fails closed when any object inside the deleted subtree is locked by another connection; the authoritative state is not mutated on rejection.
- Accepted subtree deletion clears stale Presence selection references for deleted objects and broadcasts the cleaned Presence state.
- Unity authoritative apply now explicitly rejects a local parent cycle instead of retaining a no-op cycle check.
- Health diagnostics expose aggregate `hierarchyScenes` in addition to hierarchy object/tombstone counts.
- Expanded pure hierarchy regression coverage for create initial Transform, duplicate names, sibling canonicalization/clamping, root/child reparent, subtree tombstones, ID resurrection rejection, missing parent/cycle rejection, and serialized stale-concurrency behavior.
- Added realtime integration coverage for parent/subtree lock conflicts and deletion-driven Presence selection cleanup.
- Current Server suite after this hardening: **49/49 PASS**.
- Unity 6000.3.21f1 Compile/EditMode remains **NOT RUN** in this environment; C# changes are static/source-tested only until the user runs the candidate in Unity.


## 2026-08-07 documentation/release-candidate preparation
- Added Phase 4 implementation/test/manual-checklist/known-issues/rollback documents.
- Updated current protocol documentation for additive hierarchy capability, authoritative `sceneIds`, exact hierarchy revision semantics, tombstones and older-client authority guard.
- Added Phase 4 architecture decisions for logical identity, shared revision, bounded in-memory hierarchy, ObjectChangeEvents, lock/subtree conflict policy, empty Scene authority and baseline/session mismatch fail-closed behavior.
- Updated root/server/peer/Unity package documentation to product `0.5.0` while retaining historical Phase 3 records.
- Final root/fresh-extract gates and candidate packaging are still pending; no Unity PASS is claimed.


## 2026-08-07 provisional archive + documentation consistency pass
- Built a 204-file provisional source-only archive and verified 204/204 source-to-fresh SHA-256 equality before install.
- Fresh offline install/tests/smoke/validator/syntax all pass; fresh offline audit reports 0 vulnerabilities, while connected audit remains unavailable due mirror HTTP 404.
- Post-test packaged-source hashes remain 204/204 unchanged and the archive contains zero forbidden generated/secret entries.
- A release-document consistency review then corrected stale current-version/status text left from preserved Phase 3 documentation: current product/component version is 0.5.0, Phase 3 is frozen closure, Phase 4 is active candidate, Server max message default is 1 MiB, and hierarchy limit/health fields are documented.
- Because documentation changed after the provisional fresh gate, rebuild and validate one final archive before delivery.
