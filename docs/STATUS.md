# TeamForge current status

**English** | [한국어](STATUS.ko.md) | [简体中文](STATUS.zh-Hans.md)

_Current release-metadata review: 2026-11-21 (UTC). r11 is the latest published Windows test candidate and passed exact automated ZIP validation. Historical r9/r10 two-PC field reports are preserved, but the newly packaged M1–M4 features have NOT been validated on two physical Windows Editors. Readiness remains FIELD BLOCKED._

> [!WARNING]
> **Early Public Preview — do not use TeamForge as the only copy or recovery mechanism for an important Unity project.**
>
> r5–r9 historical evidence applies only to each original immutable artifact. r9 passed exact Windows Release validation and reported physical two-PC baseline collaboration/reconnect on 2026-10-20. Published r10 passed its **automated** exact ZIP/Windows validation and has additional reported two-PC evidence, but neither installed PC hash nor the full failure-path field gate has been verified; readiness remains **FIELD BLOCKED**.

This file is the **canonical human-readable source for current capability and release-readiness claims**. Other documents should link here instead of maintaining their own competing copy of current blocker or validation state.

For exact product/runtime/protocol selections, use [`../release-contract.json`](../release-contract.json). For packaged byte identity and superseded-build rules, use [`../builds/README.md`](../builds/README.md). For detailed bug discussion and historical reproduction notes, use the linked GitHub issues.

## Current state at a glance

**Source and package update (2026-11-21 UTC):** M1 Collider collaborative properties, M2 bounded Collider structure changes, M3 Cube/Sphere creation and optional M4 durable confirmed Session recovery are merged and now included in the immutable r11 Windows test ZIP. This is new packaged evidence, **not** new physical two-Editor acceptance. The earlier r9/r10 two-Windows-PC tests were actually performed and their reported PASS results remain valid for their original packages/scenarios. Source, CI, published ZIP and physical field evidence must remain separate.


### Mainline source progress and unmerged work — reviewed 2026-11-21 (UTC)

**As-built, not a release claim:** The public `main` source at [`0da2a77603f1`](https://github.com/Eun-si123/teamforge-unity-collab/commit/0da2a77603f120ca1876b330b9a048844640db0a) includes M1 Collider property collaboration ([#533](https://github.com/Eun-si123/teamforge-unity-collab/pull/533)), M2 allowlisted Collider add/remove ([#559](https://github.com/Eun-si123/teamforge-unity-collab/pull/559), follow-up [#565](https://github.com/Eun-si123/teamforge-unity-collab/pull/565)), M3 built-in shared Cube/Sphere ([#569](https://github.com/Eun-si123/teamforge-unity-collab/pull/569)), and opt-in M4 SQLite-backed confirmed Session restoration ([#572](https://github.com/Eun-si123/teamforge-unity-collab/pull/572)). These source features have CI/one-Editor-with-Node-peer evidence as described below, **not new physical two-Windows-Editor acceptance or an updated published ZIP**.

Post-M4 source hardening merged by this review includes: runtime file hash streaming ([#570](https://github.com/Eun-si123/teamforge-unity-collab/pull/570)), placeholder field-evidence refusal ([#573](https://github.com/Eun-si123/teamforge-unity-collab/pull/573)), Pages generated-output secret guarding ([#575](https://github.com/Eun-si123/teamforge-unity-collab/pull/575)), forged NUnit XML comment/CDATA result refusal ([#577](https://github.com/Eun-si123/teamforge-unity-collab/pull/577)), malformed Guest machine-identity refusal ([#579](https://github.com/Eun-si123/teamforge-unity-collab/pull/579)), and invalid UTF-8 SSH control-frame refusal ([#585](https://github.com/Eun-si123/teamforge-unity-collab/pull/585)). The latest observed `main` CI for `0da2a77603f1` succeeded; this is **source/check evidence**, not packaged or physical certification.

**Source merged during the 2026-11-21 follow-up:** [#574](https://github.com/Eun-si123/teamforge-unity-collab/pull/574) (review/resubmit preserved Transform edits), [#580](https://github.com/Eun-si123/teamforge-unity-collab/pull/580) (Hierarchy name), [#583](https://github.com/Eun-si123/teamforge-unity-collab/pull/583) (same-Scene reparent), [#584](https://github.com/Eun-si123/teamforge-unity-collab/pull/584) (sibling order), and M5's **read-only Host saved-change preview** [#586](https://github.com/Eun-si123/teamforge-unity-collab/pull/586) are now on `main` through merge commit [`50b9b38cb170`](https://github.com/Eun-si123/teamforge-unity-collab/commit/50b9b38cb170d6d868aae10d1e24bff66baa195d). Their latest-base PR required Server/Peer/Launcher/Dependency checks passed before each merge, with previously verified native Unity+Node feature evidence; some *additional post-update Unity matrix* jobs were still pending at merge time. This does not prove completed exact Windows packaged or physical two-Editor field verification.

**Additional source merged on 2026-11-21:** [#601](https://github.com/Eun-si123/teamforge-unity-collab/pull/601) now connects ordinary Unity menu **built-in Cube/Sphere** creation to the same signed M3 Scene/Collider authority path without requiring the custom TeamForge creation menu (`main` merge `401d714`; required CI PASS, source Unity E2E passed on 6000.3.21f1, 6000.3.28f1 and experimental 6000.6.8f1). Non-default meshes, imported materials and Prefab instances are **not silently substituted** for primitives; unsupported edits remain local. [#602](https://github.com/Eun-si123/teamforge-unity-collab/pull/602) merged a real signed Project Peer initial-baseline transfer regression using synthetic external Prefab, FBX, Material, Texture and script files plus `.meta` GUID sidecars (`53df750`; 9/9 focused peer tests PASS and byte-exact Guest Active verification). **Initial Project file transfer is not live Prefab instantiation or post-join asset import**; those remain open in [#600](https://github.com/Eun-si123/teamforge-unity-collab/issues/600). No new packaged ZIP or two-physical-Editor acceptance has been completed. In the [post-merge Unity run](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/44908009678), LTS 6000.3.21f1 and 6000.3.28f1 E2E succeeded, but the experimental 6000.6.8f1 Realtime lane **did not execute tests because Unity Personal license activation assigned no seat**; do not count this as a source regression or a pass. Release status remains **FIELD BLOCKED**.

**Still unmerged:** [#578](https://github.com/Eun-si123/teamforge-unity-collab/pull/578) (Guest signed Project-update review) was **not merged despite passing required CI** because substantive Publisher trust-pin timing, cancellation-after-activation, and last-received-vs-latest-publication consistency concerns remain under independent review. Verify/fix the relevant behavior and resolve review threads before merging; the commit-boundary cancellation, final handoff integrity, and Launcher ACK handling were corrected in `9c2f1e5` (594 local Project Peer PASS, 6 skips, and Windows Launcher CI PASS); **atomic replacement-Publisher trust and Coordinator publication freshness are still unresolved**. Do not mislabel M5 checkpoint/refresh complete. Draft [#587](https://github.com/Eun-si123/teamforge-unity-collab/pull/587) (shared primitive deletion recovery), other Draft stacks, broader Scene/Asset/Prefab scope, and M5 end-to-end publication/activation remain unmerged or incomplete.

**Next honest acceptance gates:** The immutable r11 Windows ZIP has been built, published and exact-validated. Now test the exact same ZIP on two Windows PCs for M1 Collider edits/conflict/conditional Undo, M2 stable Component identity/save/reopen, M3 primitive replication, and explicitly enabled M4 persistence after a real Coordinator restart. Independently check each installed ZIP SHA-256, reconnect/failure paths, previous verified Active preservation and multi-client conditions before changing FIELD BLOCKED.

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- Latest published packaged candidate: **v0.5.1-prealpha-wp5.1-r11**
- r11 source/tag commit: **5868efe02975aa94b2acd79f5dec39a7b830aa26**
- r11 Windows ZIP: **Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r11-win-x64.zip**
- r11 artifact SHA-256: **28774bccb9fb20da0d72fce38d9bab7645dac1b876de182fbd33ee421170a989**
- Packaged target: **Windows x64**
- Release-readiness state: **FIELD BLOCKED**
- Unity line: **`6000.3`**; recorded candidate test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source versus packaged candidate

The latest [r11 Windows test pre-release](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r11) was published 2026-11-21 (UTC) from 5868efe02975aa94b2acd79f5dec39a7b830aa26. The immutable ZIP SHA-256 is 28774bccb9fb20da0d72fce38d9bab7645dac1b876de182fbd33ee421170a989 and [r11 Exact Release Validation #44869428591](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/44869428591) succeeded for the published bytes. It includes the merged M1–M4 features and scoped recovery/Host-preview work. **No post-r10 physical Windows two-Editor acceptance has been claimed.**

The [r10 pre-release](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r10) was published 2026-11-03 (UTC) from 693d3a9d647f9a511012f1ebba3209834531656e. Its ZIP passed [r10 Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102) on the published source SHA; the older [r9 validation #39147057920](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/39147057920) remains historical. Automated packaging validation does not establish the installed bytes or physical field results on both PCs.

2026-10-20 user-reported physical r9 results: Host and Guest Unity Test Lab smoke PASS; bidirectional Cube Transform PASS; same-Scene create/rename/delete PASS; basic Lock contention PASS; Guest close/reopen after Host changed position/name restored exact new state PASS. See [#301](https://github.com/Eun-si123/teamforge-unity-collab/issues/301), [#302](https://github.com/Eun-si123/teamforge-unity-collab/issues/302), [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67). Newly created objects lack Mesh/Renderer/Collider components by current design ([#303](https://github.com/Eun-si123/teamforge-unity-collab/issues/303)). Seed port collision, process-loss recovery and full field matrix remain unverified on exact r9.

On [2026-11-04, the tester reported r10 two-PC field results](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md): Host Ready, signed Publisher trust, Guest transfer/activation, Unity 6000.3.21f1 realtime join, basic Presence/Transform/Lock/Hierarchy, Host restart/recovery, resume, late join, bad-code rejection, and a long destination all **reported PASS**. Both installed Host/Guest ZIP hashes and complete step traces were **not independently confirmed**, so this is not byte-for-byte exact-r10-on-both-PC certification. Actual Guest Wi-Fi/NIC disconnection was **NOT RUN** to avoid losing headless remote management ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)); repeated Launcher double-clicks caused multiple instances on r10, with [post-r10 PR #456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456) merged as a source fix, not retroactively part of r10. Full field recovery/failure checks remain blocked.

Previous r8 Release automation remains historical.

Changes on current `main` do not retroactively change the immutable published r10 ZIP; source and packaged evidence must again be treated separately. Later source changes on `main` are not retroactively included in r10.

### Later r7-on-Host blockers, now packaged for r8 retest

The [2026-10-04 r7 field follow-up](PHYSICAL_FIELD_EVIDENCE_2026-10-04.md#later-r7-on-host-follow-up-new-blockers-exposed) exposed stale Host Ready with no discoverable Direct Project Peer (baseline_unavailable), and an Existing-Active launch bypassing the short path and failing with DirectoryNotFoundException. Source review also identified the risk of selecting a child Project UUID directory as its own managed root.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) merged on 2026-10-08 with ongoing Direct-Seed health, identity-bound Existing-Active execution-alias recovery, and a nested-root guard. Its source CI/Unity checks passed; these changes are now included in **r8**, and r8 package validation passed. The precise original Seed disappearance cause remains unconfirmed, and **none** of these three field failures has yet been physically re-tested on exact r8. Readiness stays **FIELD BLOCKED**.

### Post-r5 stabilization and r6 field fix now packaged in r7

r7 includes the bounded behavior that was newer than r5, plus the field-discovered retry fix:

- Windows LAN firewall onboarding that can create narrow Coordinator/Seed inbound rules after explicit user and UAC approval, scoped to the Private profile and `LocalSubnet`, with TeamForge-owned reconciliation/cleanup behavior;
- Seed startup recovery when the preferred/default port is occupied or unavailable, including Windows bind-context `EACCES`, with one fallback to an OS-assigned port and advertisement of the actual selected endpoint;
- Project identity creation serialization and Windows crash recovery using an OS-owned named-pipe live lock plus a permanent compatibility fence for older writers. Recent Node 22/24 Windows identity-recovery jobs passed; issue #182 remains open as an intermittent-CI watch rather than a demonstrated persistent incompatibility;
- Guest managed-root retry now recognizes only the exact bounded TeamForge-owned Windows v2 `project-identity.lock` compatibility fence instead of rejecting TeamForge's own fence as unmanaged content; malformed or modified fence content remains fail-closed;
- Coordinator rejection cleanup, HTTP cancellation/deadline hardening, improved Host diagnostic context, WebSocket client-role logs, clearer Launcher Invite versus `TF1` code wording, and the current `TeamForge · Locked by <owner>` SceneView feedback. Issue #79 remains open because visual feedback does not necessarily eliminate all transient local Gizmo motion.

Linux/macOS Project identity stale-lock recovery remains outside the Windows-specific recovery implementation.

## Capability status

### M1 source integration — Collider property collaboration

**Source evidence refresh: 2026-11-18 (KST).** M1 PR #533 merged into main. Its exact source-head [Unity CI](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/43329700733) passed real one-Editor/Node-peer Collider edits, conditional Undo and reconnect. This is **not** physical two-Editor Windows LAN, a new packaged candidate or a retrospective PASS for the published r10 ZIP. Release readiness stays **FIELD BLOCKED**.

The M1 integration branch reuses the existing WP6 PR stack and adds a real
signed-source admission → Session Authority → WebSocket → Unity Collider
path. It is an **explicit source opt-in**, separate from the published r10 ZIP.
BoxCollider/SphereCollider trigger, center and size/radius are allowlisted;
initial admission verifies actual stored signed Scene/meta bytes and the
complete saved non-Prefab Collider inventory. Subsequent dirty-Scene edits use
the in-memory runtime ledger, common Session revision/history and GameObject
lease. Property and future structure capabilities are separate.

The Editor's Collider Collaboration window provides join/status, conditional
own Undo/Redo and a project-local recovery inbox with explicit resubmission.
Server commit, Editor apply report and dirty/saved disk state are displayed
separately. An Editor report is a receiver claim, not independent attestation.

| M1 evidence stage | State |
| --- | --- |
| Implementation | **Merged into main via PR #533**; explicit source opt-in, not in published r10 |
| Automated validation | Real Node WebSocket success/conflict/retry/late-join/reconnect and signed-source tests pass; exact final-head evidence is recorded in the PR/checkpoint |
| Unity integration | **Exact PR #533 Unity CI PASS** on 6000.3.21f1, 6000.3.28f1 and experimental 6000.6.8f1 for one real Editor + Node peer; Linux-local Unity and physical two-Editor Windows tests are **NOT RUN** |
| Package / physical Windows validation | **NOT RUN** for M1. No new candidate or field promotion; r10 evidence is unchanged |

Current source bounds: one admitted Scene per Session; at most 128 retained
Collider Sessions; at most 512 Colliders / 1536 properties, finite values within
the documented ±100/0–100 limits. Unsupported Components/fields remain local.
Component add/remove, Prefab changes and deletion of an admitted Collider owner
or its ancestor require M2 and are refused in this active M1 path. All peers
editing that Scene must negotiate/join the compatible property capability.
In the original M1-only runtime, disconnecting all peers retains the in-memory ledger but a Coordinator restart loses it. The separately configured, merged M4 durable mode (#572) now persists accepted Session state; a project-local inbox for unconfirmed edits alone is not server durability. Physical two-Editor, three-Editor late join, save/reopen, 8-Editor/one-hour soak and exact Windows artifact checks remain separate gates.

Operator configuration and Editor steps are in [server/README](../server/README.md).
The [approved roadmap](ROADMAP.md) tracks the remaining milestones; M3 and M4 source integration have now merged, but M4 physical/package evidence and later features remain pending. Source implementation, CI, packaging and physical field evidence remain distinct.

### M2 source integration — Collider component lifecycle

On 2026-11-18, [M2 PR #559](https://github.com/Eun-si123/teamforge-unity-collab/pull/559) **merged into `main`** (merge commit `1e1054096278182a26f8849a0f847bfb8a2df330`), including the late-joining Editor fix [#565](https://github.com/Eun-si123/teamforge-unity-collab/pull/565). In the opt-in structure path, an authorized Editor can add/remove BoxCollider and SphereCollider components using exact shared logical IDs, including same-type siblings, saved Scene reopen, reconnect and bounded conditional Undo/Redo. Structural synchronization requires M1 property synchronization, a managed signed Project root, compatible participating Editors and the explicit `TEAMFORGE_COMPONENT_STRUCTURE_SYNC=1` server flag; it is **off by default**. This is a narrow supported source path, **not arbitrary Component/Prefab/Inspector synchronization**.

The combined PR head passed **36 CI check contexts** with no failures, including real Unity Editor + Node peer E2E on three configured Unity versions and source-linked evidence. One Editor + Node peer is **not** simultaneous physical Windows LAN collaboration between two Editors. Physical multi-Editor Windows LAN, soak, a fresh packaged artifact and installed ZIP identity remain **NOT RUN** for M2. The published immutable r10 package does not contain M1/M2; release readiness stays **FIELD BLOCKED**.

### M3 source integration — built-in shared Cube and Sphere

On 2026-11-19, [M3 PR #569](https://github.com/Eun-si123/teamforge-unity-collab/pull/569) merged into main (merge commit 3fa4232e445d65f449b686687f74307225059d70). In a joined saved non-Prefab Scene, an Editor can use GameObject → TeamForge → Create Shared Cube / Create Shared Sphere. Unity creates its built-in Mesh and Renderer with the exact Box/SphereCollider identity. An authorized lock owner can move it, edit its Collider, or use Delete Selected Shared Primitive. The Coordinator commits Hierarchy and Collider topology in one revision/epoch; exact retries, late join, Scene save/reopen and reconnect are covered in the supported path. The feature is off by default: it requires TEAMFORGE_PRIMITIVE_TEMPLATE_SYNC=1, the existing M1/M2 flags, managed signed Project source, and capable participating Editors. This is not arbitrary Mesh/Asset/Prefab replication and is limited to built-in templates in saved non-Prefab Scenes.

Automated evidence: the [exact-head Unity CI](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/44423032945) and [ordinary CI](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/44423033586) succeeded (40 PR checks, no failures), including real Unity Editor and Node peer on 6000.3.21f1, 6000.3.28f1 and experimental 6000.6.8f1. Physical two-Editor Windows LAN, 8-Editor soak, exact new package/installed ZIP identity: **NOT RUN**. Published immutable r10 excludes M3 and release readiness stays **FIELD BLOCKED**.

### M4 source integration — durable Coordinator Session recovery

On 2026-11-20, [M4 PR #572](https://github.com/Eun-si123/teamforge-unity-collab/pull/572) **merged into `main`** (merge commit `f3b33413ecaa7f06c87e99734694d336a8acf4c6`). M4 is **opt-in source behavior**, not part of the published r10 ZIP. With `TEAMFORGE_DURABLE_SESSION_DB` pointing to a local SQLite database and `TEAMFORGE_COMPONENT_PROJECT_ROOT` to the approved managed signed Project store, the Coordinator persists confirmed Hierarchy, Transform and Collider Session state and operation outcomes **before acknowledgement**. After restart, the same signed Session restores under a **new authority epoch**, without restoring old connections, Presence or locks; invalid source, corrupted storage and failed writes must fail closed. See [Coordinator setup](../server/README.md#m4-coordinator-restart-recovery).

**Automated evidence:** The merged M4 PR passed **36 latest-head CI checks**, including SQLite/restart/process-loss paths and a real Unity Editor plus Node peer on Unity 6000.3.21f1, 6000.3.28f1 and experimental 6000.6.8f1. This does **not** prove a new Windows release package, two physical Editors concurrently testing M4, or long-duration soak.

**Field evidence boundary:** Earlier r9/r10 [real two-Windows-PC tests](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md) **already reported PASS** for basic collaboration, Guest reconnect, and Host Stop/Start. Those tests did **not** exercise newly implemented M4 **SQLite durable Session restoration**; that specific scenario is **NOT RUN on two physical Editors**. Preserved local Transform review/resubmission is now merged via [#574](https://github.com/Eun-si123/teamforge-unity-collab/pull/574), but its new source path has **no two-physical-Editor field acceptance**. The published r10 ZIP and overall **FIELD BLOCKED** readiness remain unchanged.

| Area | Current source state | Current evidence boundary |
| --- | --- | --- |
| Connected-user presence | ✅ Implemented / exercised | Physical two-PC baseline worked; broader external testing remains useful |
| Selection / Editor awareness | ✅ Implemented / exercised | Broader external testing remains useful |
| Transform synchronization | 🟡 Implemented / stabilizing | Exact r5 two-PC late-join/contention recovery passed; r7 exact-package automation passed; broader physical coverage and #79 UX follow-up remain |
| Basic locking / ownership | 🟡 Implemented / stabilizing | Exact r5 contention/recovery passed; r7 includes foreign-lock SceneView feedback; #79 remains open for transient-edit prevention/clarity |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 Implemented / stabilizing | Supported subset was exercised physically; broader field coverage remains useful |
| Project bootstrap / Collaboration Invite | 🟡 Implemented / stabilizing | Exact r5 saved-Guest reconnect passed; r7 packages Windows Project identity crash recovery plus the Guest fence-retry fix and passed exact-package automation; physical process-loss/conflict recovery remains pending |
| Direct P2P project transfer | 🟡 Implemented / stabilizing | Exact r5 `5091` Stop/Start + real transfer passed; r7 packages firewall onboarding, unavailable-port fallback, and the Guest retry fix found during the r6 field pass; actual two-PC LAN lifecycle evidence remains pending |
| Diagnostics / recovery UX | 🟡 Implemented / stabilizing | r7 packages the later diagnostics/recovery refinements and privacy-safe support-bundle path; broader field usability remains useful |
| Windows path resilience / execution alias | 🟡 Implemented / stabilizing | Exact r5 real long/deep-path handoff passed; exact r7 Windows path/junction automation passed; malicious/unrelated alias refusal remains fail-closed coverage |
| Collider and built-in primitive collaboration | 🟡 M1/M2/M3 source opt-ins merged | Collider properties, exact Box/SphereCollider add/remove and built-in Cube/Sphere shared creation/deletion are in main; actual single-Editor/Node CI passed. Physical two-Editor, exact package and field evidence NOT RUN. General Inspector/Prefab/Asset replication and arbitrary SerializedProperty sync are not supported |
| Prefab / general Asset collaboration | 🟡 Initial Project file transfer only verified | #602 proves signed initial Project transfer of synthetic Prefab/FBX/Material/Texture/scripts and byte-exact `.meta` GUIDs. Live Prefab instantiation and post-join asset updates remain unimplemented/unverified under #600 |
| Durable server/session restart recovery | 🟡 M4 opt-in source merged (#572) | Confirmed shared state persists in SQLite and restores under a new epoch in source CI. M4 physical two-Windows-Editor, new exact package and soak tests NOT RUN; without M4 configuration, the runtime remains memory-resident |
| Automatic Internet NAT traversal / relay | 🔬 Research / future | No WebRTC, ICE, STUN, TURN, relay, discovery, or automatic NAT traversal |

## Exact r5 physical closure record

The following table replaces the older wording that incorrectly treated the original blocker set as still awaiting exact physical validation.

| Issue | Exact r5 physical result | Remaining boundary today |
| --- | --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) — saved Guest reconnect | **PASS** — legitimate collaborative edit/save → Guest Unity close → same verified Active Project reopen → realtime rejoin without `guest_handoff_mismatch` | Fresh/unverified identity rejection remains protected by strict implementation and automated regression coverage |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) — fresh late-join snapshot conflict | **PASS** — fresh Guest received authoritative Hierarchy/Transform/Lock state and later live Transform without false protected conflict | Broader scenarios remain useful, but this original field blocker is closed |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) — stale lock-contention protected conflict | **PASS** — losing-side contention recovered to authoritative state and collaboration remained usable | UX clarity while another peer owns the lock is tracked separately in #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) — receive shutdown | **PASS** — Launcher was force-ended during receive multiple times; verified partial data was reused and resume completed without reproducing the original CLR/application error | Future runtime changes should keep regression coverage, but this original r5 field blocker is closed |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) — Seed/firewall onboarding | **PARTIAL FOR r5 PRODUCT GOAL / PASS FOR STABLE-SEED PATH** — packaged Host Stop/Start rebound on TCP `5091` and a real Guest transfer succeeded once firewall access existed | Fresh automatic Windows firewall onboarding and newer unavailable-port fallback were added after r5 and still need exact replacement-package physical evidence |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) — execution-alias handoff | **PASS** — long/deep destination triggered path optimization, Unity opened, and realtime collaboration worked | Malicious/unrelated/retargeted alias refusal remains automated fail-closed coverage |

Detailed timelines belong in the GitHub issues. This page owns their current release effect.

## Automated and local evidence

Before PR #81 merged, its final integrated head passed the repository protection gates recorded in `docs/MAIN_PATCH_STATUS_2026-08-27.md`:

- CI run #216: Server, Project Peer, Launcher runtime loader, Windows Launcher, and public-source contract — **PASS**
- Dependency Review run #140 — **PASS**
- Unity Tests run #73 — **PASS**
  - Unity Lock Contention E2E
  - Unity Realtime Authority E2E
  - Realtime Authority Chaos E2E
  - Project Transfer Resume E2E
- Earlier local Unity Test Runner: **143 / 143 locally runnable tests PASS**; two CI-only real-server tests intentionally ignored locally
- Same-machine A/B contention recovery — **PASS**
- A/B/C late-join Hierarchy/Transform convergence — **PASS**, zero protected conflicts in the recorded run

Later source hardening has also been exercised by focused Project Peer/Launcher/Unity tests and the normal repository quality gates. In particular, the Windows Project identity crash/concurrency suite passed on supported Node 22 and Node 24 lines, and the unavailable-Seed-port regression path passed the full Project Peer suite on the reproduced Windows environment.

The published r7 artifact additionally passed Exact Release Validation run `37118580632`: Release download/hash identity, release-manifest file hashes, Korean/space-path fresh extraction from a foreign CWD, staged public/source validation, bundled Runtime/Node verification, Launcher fail-closed Runtime behavior, and exact-candidate Windows path-resilience/real-junction checks all passed. This is package evidence for those automated checks; it is not a substitute for the remaining two-PC LAN/UAC/process-loss/realtime field scenarios.

## Recorded physical two-PC evidence

### 2026-10-03/04 r6 → r7 field pass

A physical r6 pass on two Windows PCs first confirmed the unauthenticated-LAN fail-closed gate, external-local-package refusal, Windows firewall onboarding, and Host Ready after rule configuration. The Host Unity process in that pass was already elevated, so a clean non-elevated UAC prompt remains unverified.

The first Guest connection attempt hit `coordinator_timeout`; a retry then exposed `destination_contains_unmanaged_content` because TeamForge's own Windows v2 `project-identity.lock` compatibility fence was not recognized by Guest destination validation. PR #200 fixed that contradiction without accepting arbitrary lock files, and the exact r7 Guest physically re-used the real r6-managed root without reproducing the self-blocking error.

The remaining Coordinator timeout was then isolated to Windows network policy in this run: the Host Coordinator was listening on `0.0.0.0:5080`, while TeamForge's inbound rules were correctly Private-only but the active Host Wi-Fi profile was Public. After the trusted LAN was changed to Private, Guest TCP 5080 succeeded and the same r7 flow advanced through Publisher trust, Project receive, Unity launch, and a user-reported TeamForge connection. See `PHYSICAL_FIELD_EVIDENCE_2026-10-04.md` for the dated evidence boundary.

### 2026-08-22 baseline

Before the targeted blockers were isolated, the recorded physical Windows flow demonstrated:

- Host → signed Collaboration Invite → fresh Guest → authentication → direct Project transfer → Publisher trust → verified Active Project → Unity realtime connection;
- Presence and bidirectional Transform synchronization;
- normal lock/ownership contention;
- supported same-Scene Hierarchy create/rename/reparent/sibling-order/delete;
- unsaved Guest exit/reopen with authoritative Hierarchy/Transform/Lock recovery from the still-running session;
- Coordinator TCP interruption → retry → automatic reconnect without restarting Unity.

### 2026-08-31 exact r5 closure

The exact r5 ZIP/SHA pair was then used on two physical Windows PCs to close the targeted saved reconnect, fresh late-join, repeated receive-resume, long/deep-path and lock-contention recovery scenarios described above. The same field pass also verified the packaged stable-Seed `5091` Stop/Start path and a real LAN transfer, while recording that fresh firewall onboarding still required manual allowance at that time.

## Evidence boundaries

A result proves only what it exercised.

- Source CI does not prove a packaged ZIP is correct.
- Unity automation does not reproduce every SceneView input ordering, Windows process condition, LAN/firewall state, or second-machine timing path.
- Same-machine multi-project testing strengthens confidence but still shares one OS, network stack, timing environment, and hardware.
- Exact r5 physical evidence proves the r5 bytes and scenarios that were exercised; it does not prove r6/r7-specific networking/identity behavior.
- Exact r7 automated Release validation proves the r7 artifact/hash/manifest/extraction/Runtime/Launcher/path checks that ran. The mixed r6 Host / exact-r7 Guest field pass additionally proves the fixed Guest retry and one real LAN bootstrap path after correcting the Host Windows network profile; it still does not prove exact-r7-on-both-machines, fresh non-elevated UAC/firewall onboarding, preferred-port fallback, physical process-loss recovery, or SceneView UX timing.
- Exact r8 Windows Release validation run 38019297086 passed for its immutable ZIP and hash. Exact r10 Windows Release validation run 41630492102 also passed for the r10 packaged ZIP. Neither automated result establishes verified installed hashes on both PCs, Wi-Fi/NIC loss, UAC/firewall, port fallback, identity process-loss recovery or SceneView interaction behavior.
- Product version alone is not byte identity; exact packaged evidence requires the exact artifact filename and SHA-256.
- A closed bug does not automatically prove that every later implementation touching the same subsystem has package/field evidence.
- Historical phase/work-state/evidence notes remain valid for their recorded snapshots but do not override this page for current readiness.

## Remaining release-readiness gate

Before release promotion, use the immutable r11 ZIP/hash for the new M1–M4 physical collaboration and recovery/negative gates. Preserve older r5–r10 field evidence rather than assigning it to r11.

1. Record the r11 tag, source commit, ZIP filename and SHA-256; verify the exact downloaded ZIP independently on each Host/Guest PC. Never replace or repack any previously published immutable release bytes.
2. Test **exact r11 on both physical Windows PCs**: fresh Host → signed Invite → Guest verified receive → Active Project → Unity launch → realtime connection; then Host Stop/Start and a new transfer.
3. Reproduce or safely simulate missing Host Direct Seed while Host is Ready; verify that stale Ready is revoked and the Guest receives truthful, recoverable diagnostics instead of misleading availability.
4. Reopen a previously verified Existing-Active project under long/deep paths; confirm identity-bound short execution alias and no old Unity PackageCache DirectoryNotFoundException. Selecting an individual Project UUID directory as the managed root must fail closed without creating nested UUID directories.
5. From a fresh non-elevated Windows Host, verify UAC/firewall onboarding and Private + LocalSubnet rules. Keep Public-profile refusal; do not broaden exposure merely to obtain a PASS.
6. Occupy the preferred Seed port, verify fallback and advertised reachability, stop/start, and a second successful transfer; test process-loss Project identity recovery without admitting ambiguous/conflicting identities.
7. Exercise realtime Presence/Transform/Hierarchy and foreign-owner Lock feedback on two Editors. PR #217's later warning-repaint refinement is not part of the r8 ZIP; issue #79 still tracks transient Gizmo motion clarity.
8. Watch intermittent Windows Node 22 Project identity issue #182 without weakening fail-closed assertions. Preserve historical r5–r10 evidence and record only newly observed r11 outcomes. Test safe Guest Wi-Fi/NIC loss only when remote administration is protected (#457).
9. Test r11-specific M1 Collider concurrent edits/Undo, M2 Component identity/save/reopen, M3 primitive replication and opt-in M4 durable SQLite recovery after an actual Coordinator process restart. Historical r10 Host Stop/Start is not M4 evidence. Keep Installer/Update/Uninstall and UX work independently tracked (#590).

Package and source checks do not substitute for these field scenarios.

## Information ownership

To avoid documentation drift, use these sources for these questions:

| Question | Canonical source |
| --- | --- |
| What works now? What is blocked? | **This `STATUS.md`** |
| What exact versions/runtimes/protocols are selected? | [`release-contract.json`](../release-contract.json) |
| What exact packaged bytes are current/superseded? | [`builds/README.md`](../builds/README.md) + GitHub Release SHA-256 |
| How does TeamForge work end to end? | [`HOW_IT_WORKS.md`](HOW_IT_WORKS.md) |
| What is planned? | [`ROADMAP.md`](ROADMAP.md) |
| How is the current system structured? | [`architecture.md`](architecture.md) |
| Why was an architecture decision made? | [`architecture-decisions.md`](architecture-decisions.md) |
| How are named validation scenarios run? | [`TEST_LAB.md`](TEST_LAB.md) |
| What is the detailed state of a bug? | GitHub Issues |
| What happened in an older test or stabilization pass? | Dated phase/work-state/evidence notes |
