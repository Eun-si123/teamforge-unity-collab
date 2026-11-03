# TeamForge current status

**English** | [한국어](STATUS.ko.md) | [简体中文](STATUS.zh-Hans.md)

_Last documentation review: 2026-10-20 (UTC). r9 is the current candidate; targeted physical two-PC collaboration has passed, while release readiness remains FIELD BLOCKED._

> [!WARNING]
> **Early Public Preview — do not use TeamForge as the only copy or recovery mechanism for an important Unity project.**
>
> r5–r8 historical evidence remains valid for each original immutable artifact. r9 passed exact Windows Release validation and user-reported physical two-PC baseline collaboration and normal Guest reconnect on 2026-10-20. The complete recovery and failure-path field gate remains **FIELD BLOCKED**.

This file is the **canonical human-readable source for current capability and release-readiness claims**. Other documents should link here instead of maintaining their own competing copy of current blocker or validation state.

For exact product/runtime/protocol selections, use [`../release-contract.json`](../release-contract.json). For packaged byte identity and superseded-build rules, use [`../builds/README.md`](../builds/README.md). For detailed bug discussion and historical reproduction notes, use the linked GitHub issues.

## Current state at a glance

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- Latest published packaged candidate: **v0.5.1-prealpha-wp5.1-r9**
- r9 source/tag commit: **8b4f8ec00e452c8901e0a47ba689d7e368d5ba00**
- r9 Windows ZIP: **Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r9-win-x64.zip**
- r9 artifact SHA-256: **8f53f98ad39ac98326cc5031751648954416582714de01a1f3f379f53e8a94ea**
- Packaged target: **Windows x64**
- Release-readiness state: **FIELD BLOCKED**
- Unity line: **`6000.3`**; recorded candidate test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source versus packaged candidate

The [r9 pre-release](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r9) was published 2026-10-18 (UTC) from 8b4f8ec00e452c8901e0a47ba689d7e368d5ba00. [Exact Release Validation #39147057920](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/39147057920) passed. This validates the tested immutable Windows package, not every physical field gate.

2026-10-20 user-reported physical r9 results: Host and Guest Unity Test Lab smoke PASS; bidirectional Cube Transform PASS; same-Scene create/rename/delete PASS; basic Lock contention PASS; Guest close/reopen after Host changed position/name restored exact new state PASS. See [#301](https://github.com/Eun-si123/teamforge-unity-collab/issues/301), [#302](https://github.com/Eun-si123/teamforge-unity-collab/issues/302), [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67). Newly created objects lack Mesh/Renderer/Collider components by current design ([#303](https://github.com/Eun-si123/teamforge-unity-collab/issues/303)). Seed port collision, process-loss recovery and full field matrix remain unverified on exact r9.

Previous r8 Release automation remains historical.

Changes on current `main` do not retroactively change the immutable published r9 ZIP; source and packaged evidence must again be treated separately. Later WP6 Component source changes on `main` are not in r9.

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
| Component / Inspector synchronization | ⏳ Planned | General Component add/remove and `SerializedProperty` sync are not supported yet |
| Prefab / general Asset collaboration | ⏳ Planned | Not a supported current workflow |
| Persistent server/session restart recovery | ⏳ Planned | Current authority/session state remains memory-resident |
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
- Exact r8 Windows Release validation run 38019297086 passed for its immutable ZIP and hash. This does not establish physical two-PC Host/Guest recovery, UAC/firewall, port fallback, Project identity process-loss recovery, or SceneView interaction behavior.
- Product version alone is not byte identity; exact packaged evidence requires the exact artifact filename and SHA-256.
- A closed bug does not automatically prove that every later implementation touching the same subsystem has package/field evidence.
- Historical phase/work-state/evidence notes remain valid for their recorded snapshots but do not override this page for current readiness.

## Remaining release-readiness gate

Before release promotion, use the immutable r9 ZIP/hash for the remaining targeted physical recovery/negative gates. Preserve older r5–r8 evidence rather than pretending earlier tests did not run.

1. Record r9 tag, source commit, ZIP filename, SHA-256, Unity version, and separate Host/Guest machine roles. Do not repack r8 or silently replace its published bytes.
2. Test **exact r9 on both physical Windows PCs**: fresh Host → signed Invite → Guest receive → verified Active Project → Unity launch → realtime connection, then Host Stop/Start and new Guest transfer.
3. Reproduce or safely simulate missing Host Direct Seed while Host is Ready; verify that stale Ready is revoked and the Guest receives truthful, recoverable diagnostics instead of misleading availability.
4. Reopen a previously verified Existing-Active project under long/deep paths; confirm identity-bound short execution alias and no old Unity PackageCache DirectoryNotFoundException. Selecting an individual Project UUID directory as the managed root must fail closed without creating nested UUID directories.
5. From a fresh non-elevated Windows Host, verify UAC/firewall onboarding and Private + LocalSubnet rules. Keep Public-profile refusal; do not broaden exposure merely to obtain a PASS.
6. Occupy the preferred Seed port, verify fallback and advertised reachability, stop/start, and a second successful transfer; test process-loss Project identity recovery without admitting ambiguous/conflicting identities.
7. Exercise realtime Presence/Transform/Hierarchy and foreign-owner Lock feedback on two Editors. PR #217's later warning-repaint refinement is not part of the r8 ZIP; issue #79 still tracks transient Gizmo motion clarity.
8. Watch intermittent Windows Node 22 Project identity issue #182 without weakening fail-closed assertions; preserve r5/r6/r7 historical field evidence and report only actual r8 observations.
9. Keep installation/update/uninstall guidance and external tester feedback as separate release-readiness gates. A Server restart is disconnect/fail-closed/new-session recovery, **not** durable session persistence.

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
