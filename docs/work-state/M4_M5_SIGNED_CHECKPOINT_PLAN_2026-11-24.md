# TeamForge P1 — signed M4→M5 checkpoint planning and legacy scope compatibility

Date: 2026-11-24. Draft PR #620, product release state: `FIELD_BLOCKED`.

## Why

The existing SQLite v2 `transitionProjectCheckpoints` primitive atomically repins every M4 Session, preserves its old checkpoint in the same transaction, and creates an unresolved recovery journal. But it did not have a complete source- and Session-scoped caller-produced transition intent derived from **real** saved Coordinator data. A separate concrete issue was found: `DurableSessionRuntime.approveProject` persists the signing Descriptor returned by `verifyProjectDescriptor`; that Descriptor's cryptographic signature is bound to `projectId`, but it does **not** duplicate the ID inside `checkpoint.project`. The SQLite transition writer incorrectly required that optional duplicated value, so a valid real M4 Session could not be repinned despite exact signed Project scope and hash.

## Production code changes

- `server/src/durable-session-store.mjs`: the existing atomic writer now accepts a missing historical `checkpoint.project.projectId` but still rejects any **present and different** Project ID. It continues to require the correct signed Project UUID, old Descriptor hash, Owner key, revision, saved SQLite scope, old epoch/checksum, all Session membership, unchanged Hierarchy/Transform/Collider content, source pin, and separate M4 backup and journal. Original M4 bytes are backed up **exactly**, without inventing a legacy `projectId`.
- `server/src/project-transition-checkpoint-plan.mjs`: new **in-process, read-only**, cryptographically signed source-bound plan construction from `store.loadAll()`. Requires valid old and next signed Owner/Publisher Descriptors, the exact Project UUID and +1 Baseline revision, consistent existing M4 signed Project data and publication across every stored Session, nonempty complete Session set, and safe epoch changes. It fails closed on missing/forged Collider source identity, differing GUID/Scene pinned source metadata, wrong Project scope, duplicate Session, reused current epochs, incompatible publication, unresolved transition journal, modified checkpoint during the plan, or invalid records.
- Plan output carries exact M4 Session IDs, epochs, revisions and checksums, plus a candidate M5 checkpoint containing **unchanged Hierarchy, Transform, Collider properties/structure and original lineage**. Only intended signed Project/Collider source pins and bounded publication attribution are repinned. The old original checkpoint is never overwritten by planning. The storage writer still performs atomic CAS when the input is explicitly used in **disposable test-only storage**.
- New source module added to `server/package.json` syntax check.

## Verified test boundaries

- Real started Coordinator with two separately saved M4 Sessions, then a **clean stop** (the live Coordinator owns exclusive SQLite access), can be loaded via read-only SQLite and converted to a complete candidate signed transition plan without writing any checkpoint or journal.
- Signed legacy M4 Project descriptor missing its duplicate `projectId` successfully plans, can be batch-repinned in disposable SQLite, preserves its original raw backup, and leaves `host_points_previous` / unresolved recovery state. New code does **not** perform that mutation against a live Project.
- Collider + independent Hierarchy/Transform Session: preserves identity, values, Scene byte hashes, exact Collider pinned source and old operation receipts; unrelated Project remains untouched.
- Wrong Owner-signed candidate, wrong Project, old publication timestamp, forged Collider source, invalid/reused epochs, a committed M4 edit between read and re-read, accepted M4 edit after planning but before SQLite compare-and-swap, and existing recovery journal all fail closed without discarding accepted edits.

## Verified in this batch (Ubuntu Mini PC, Node 24)

- Server **503 PASS / 0 FAIL** (including six new regressions covering actual SQLite, real saved Coordinator data, stale accepted operations and source mismatch).
- Cross-phase Node **160 PASS / 0 FAIL** (overlaps Server tests).
- Project Peer **651 PASS / 0 FAIL / 6 environment SKIP** (657 total); run sequentially after cross-phase to avoid child-process timeouts due to concurrent load.
- Server syntax, Host+Seed smoke, engineering/docs governance, GitHub Actions policy for 29 workflows, public-source validation, and `git diff --check`: **PASS**.
- Existing Draft PR CI at prior commit `7aff0b5` completed with no failures or running checks at the time it was inspected. This new commit requires separate GitHub CI; no full Unity or two-physical-Windows-PC test was performed in this batch.

## What is not ready

A read-only plan is **not** an authorization to call `transitionProjectCheckpoints` against production. No Host published pointer, Guest Active pointer, Scene, asset file, Session, or customer-owned SQLite DB is changed by the planner. The actual live transition needs a transaction coordinator that binds this plan to a **fresh current Publisher possession proof**, signed-content recheck at write time, a durable intent before touching the filesystem, crash-consistent Host+SQLite+Guest promotion/rollback, and independent on-device and two-Windows-PC verification. Do not expose the plan or Publisher proof via WebSocket, automatically clear a recovery journal, or merge Draft PR #620 until those boundaries are addressed.
