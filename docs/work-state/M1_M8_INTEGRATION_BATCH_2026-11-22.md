# TeamForge coherent M1–M8 integration review — 2026-11-22

**Worktree-only staging candidate; not a release or an accepted Windows two-Editor workflow.**

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
