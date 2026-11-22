# TeamForge coherent M1–M8 integration review — 2026-11-22

**Draft integration PR #620 staging candidate; not a release or an accepted Windows two-Editor workflow.**

## User outcome / scope

The owner requested integrated improvement of the **whole product**, not repeated one-file fixes: standard Unity Hierarchy and Inspector actions; M1 Collider properties; M2 Collider add/remove; M3 native Cube/Sphere create/delete/Undo and sibling ordering; M4 SQLite durable replay and edit recovery; M5 imported Asset/Prefab project changes, signed source comparison and a future secure Project refresh; Host/Guest launchers, Project Peer, Direct Seed/Swarm, identity/network/security, CI and docs. Changes must reuse existing code and produce complete user pathways instead of introducing TeamForge-specific Object menus. Work may span runs, but each delivered claim needs real evidence and a recovery path. Do not infer arbitrary Component/Asset/Prefab live sync from saved Project file transfer.

## Integrated staging provenance

A clean **isolated** worktree based on `origin/main` at `6070598` was combined by normal Git merges with the exact known heads of three current Drafts: [#607](https://github.com/Eun-si123/teamforge-unity-collab/pull/607) `55df74e` (native M1–M4), stacked [#614](https://github.com/Eun-si123/teamforge-unity-collab/pull/614) `321cb62` (native M3 delete and Undo), and [#616](https://github.com/Eun-si123/teamforge-unity-collab/pull/616) `00a232b` (M5 Asset changes, signed Project source checks and durable nonpublication). The merged tree had **zero textual Git conflicts** across **34 changed files / 2,756 added lines / 102 deleted lines**, but absence of text conflicts is not proof of behavioral compatibility. M5 Guest review / replacement-Publisher trust repair [#578](https://github.com/Eun-si123/teamforge-unity-collab/pull/578) is **already merged into main** in `8c6d285`; it was not duplicated or remerged. This staging candidate neither merges into main nor closes any source PR.

## Evidence matrix and boundaries

| Product area | Combined scenario checked | Actual evidence | Remaining gate |
| --- | --- | --- | --- |
| Host/Coordinator/Seed startup | Signed Host plan/commit, Process lifecycle, health deadline, port fallback, crashed Seed cleanup | Focused Node suite | Real Windows Launcher process lifetime and firewall |
| M1/M2 | Box/Sphere Collider admission, structure/Property updates, rejection, owner witness, Undo topology guards | Server Node, authored Unity tests | Actual Unity two-Editor Inspector behavior |
| M3 | Native Cube/Sphere creation and deletion, lock ownership, exact signed Collider removal, root sibling order and new-ID Undo | Server Node, authored Unity tests | Actual two-Editor Unity Hierarchy and save/reopen |
| M4 | Durable real WebSocket state, replay/reconnect, kill/restart, preserved local edits when wrong baseline is offered | Server Node | Atomic live checkpoint write barrier and real two-PC recovery |
| M5 Host | Source change scan, .meta detection, signed Manifest staging preflight, safe source mismatch refusal | Peer/Server Node, authored Unity decoder tests | Atomic signed live update of durable Session |
| M5 Guest | Signed Project revision review, Publisher trust preservation, cancel/failure rollback, existing Active retained, real Coordinator freshness check | Peer Node | Two-PC Editor activation and actual guest Unity import |
| M6–M8 | Multiple Scenes, generic Inspector Components, market Prefabs and arbitrary assets | NOT IMPLEMENTED / no field claims | Architecture, signed content transfer/identity and full Editor integration |
| Broader app | Connection reliability, self-service Host/Guest UX, large-project efficiency, security, diagnostics, package validation | Existing component-specific tests only | Full product reliability, soak, installation/performance evidence |

**Executed on isolated Ubuntu miniPC:** The combined `node --test` with five test files at default concurrency reported **78 pass/2 fail** on a busy host: a spawned M5 preview CLI hit its 20-second subprocess timeout and an HTTP-body deadline assertion observed no response. Re-running the two exact failing cases isolated **passed**; rerunning the same five test files with `--test-concurrency=1` passed **80/80** in 18.86 seconds. Subsequent signed Guest refresh and real Project Coordinator/Seed tests passed **19/19**. Combined Node targeted evidence: **99/99 with bounded file-level concurrency**. This is not evidence that the original two failures are impossible under load or that Unity PC testing passed. Preserve those failures as a performance/test-infrastructure risk to diagnose rather than modifying timeout guards to obtain green results.

Automated repository source, documentation and engineering policy checks also passed for the combined tree. The standalone Server's transport-free Project source checker remains essential: CI must install server dependencies alone and still boot. Merged legacy PR author/coauthor commit history does not satisfy the current local identity pre-push gate; **do not push the raw merge branch**. A published integration candidate, if created, must preserve attribution and comply with the current rules through a clean, reviewable commit, without rewriting other people's protected branch histories.

Run the reproducible **Node-only** integration smoke command from a checkout with separately installed `server` and `project-peer` npm dependencies:

```bash
npm run test:crossphase-node
```

This command intentionally runs the combined suites at file concurrency 1 to avoid the observed multi-process overload, and does **not** validate Unity compilation, installed Windows Launchers, packaged ZIPs or physical 2-PC field tests. For high-confidence release gates still run all normal CI, Unity Editor regression and future physical acceptance matrices. The released product stays `FIELD_BLOCKED`.

## 2026-11-22 follow-up — cross-Phase M4/M5 completeness and imported Asset GUID evidence

### Confirmed cross-Phase gap 1: M4 no-Collider Sessions were invisible to M5 source preview

Previous `project_baseline_transition_preview` watched `components.ledgers` and its Session revisions, but omitted independent M4 realtime Sessions containing only Transform/Hierarchy state. During an asynchronous signed-Manifest read, a second durable Session could edit, reconnect, change its lease owner, or replace its checkpoint cursor without invalidating a seemingly current candidate review. This is a **confirmed completeness gap in an advisory path**; it did not bypass the separate `durable_checkpoint_required` publication guard, and no accepted edit loss was demonstrated.

The Coordinator now snapshots **every** realtime Session belonging to the exact Project, including object/generation identity, revision, durable epoch, durable lineage, registered connection identities, and lease ownership/expiry. It also checks the Project's durable checkpoint cursors (exact Project UUID, Session key, revision consistency) and retained Collider ledger pins/epochs. The same snapshot is reacquired after asynchronous Manifest and pointer reads; any addition, retirement, reconnection, lease, revision, checkpoint or Component source drift invalidates the preview as `project_transition_stale`. Other Project sessions do not create false conflicts. Response and Project Peer client validate bounded counts `retainedRealtimeSessions`, `retainedDurableCheckpoints`, and `retainedComponentSessions` for correlation. These counts are **not** a quiescence ACK, a write freeze or an M4→M5 commit authorization.

### Confirmed source input blind spot 2: identical copied Unity .meta files

The prior `missingAssetMetaCount` checked presence only; newly imported FBX/Prefab could copy an existing Asset's entire `.meta` bytes and thereby reuse its Unity GUID. The shared, transport-free signed-Manifest source classifier now detects byte-identical `.meta` SHA-256 hashes for distinct `Assets/` companions, restricted to the newly touched Assets/metadata so an untouched old baseline remains a no-op. These become `source_reconciliation_required` blockers and the Host and server report `identicalMetaCount`; the bilingual Unity UI shows this count and affected short relative paths from the existing bounded conflict preview. Project Peer rejects contradictory wire approval/count responses. This is **not** exhaustive GUID uniqueness verification: differing `.meta` bytes can still contain the same GUID, and Source `source_inputs_unchanged` remains non-authorizing even without duplicates.

**Executed focused evidence:** actual Coordinator WebSocket + signed staged M5 import scenarios now include an additional durable Hierarchy-only Session, and a duplicated `.meta` across imported assets, with unchanged M4 signed Collider values after rejected direct publish and restored from disk after Coordinator restart. New deterministic server tests cover changes to Session revision, membership, lock, epoch, lineage, checkpoint cursor, added/removed Sessions and mismatched source pins. Exact focused Node run: **54/54 PASS** (server primitive collaboration, source-fence, Project Peer Coordinator client and Host preview). Unity decoder negative coverage added but Unity Editor NOT RUN locally. Published release and field evidence remain `FIELD_BLOCKED`; no M4→M5 live transition has been enabled.

### Consolidated follow-up validation and implementation checkpoints

- `node --test` for the four changed server/Project Peer suites: **54/54 PASS**.
- `npm --prefix server test -- --test-concurrency=2`: **450/450 PASS**, 0 failures.
- `npm --prefix project-peer test -- --test-concurrency=2`: **622 PASS**, 6 platform skips, 0 failures (628 total).
- `npm run test:crossphase-node`: **103/103 PASS** after adding the all-Session M4→M5 fence tests to the integration lane.
- Server `npm run check` now syntax-checks `project-transition-preflight.mjs` explicitly; no new wire write/commit operation was enabled.
- This is an incremental hardening of Draft #620, not proof of the full live M4→M5 transaction, the entire Unity Inspector/Prefab surface, or physical Windows two-Editor acceptance. Signed candidate chunk availability and all possible GUID collisions remain unverified.
