# TeamForge current status

**English** | [한국어](STATUS.ko.md) | [简体中文](STATUS.zh-Hans.md)

_Last documentation review: 2026-10-03 (UTC). Reconciled the published r6 artifact and its exact Windows Release validation with the earlier exact-r5 two-PC physical evidence. Exact-package automation and physical-field evidence remain separate._

> [!WARNING]
> **Early Public Preview — do not use TeamForge as the only copy or recovery mechanism for an important Unity project.**
>
> The original WP5.1 Windows blocker set received substantial exact-r5 physical validation, and the post-r5 stabilization is now packaged and exact-release-validated as r6. The r6 networking/identity changes still need the remaining physical two-PC field checks. Keep backups and prefer disposable projects while testing.

This file is the **canonical human-readable source for current capability and release-readiness claims**. Other documents should link here instead of maintaining their own competing copy of current blocker or validation state.

For exact product/runtime/protocol selections, use [`../release-contract.json`](../release-contract.json). For packaged byte identity and superseded-build rules, use [`../builds/README.md`](../builds/README.md). For detailed bug discussion and historical reproduction notes, use the linked GitHub issues.

## Current state at a glance

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- Latest published packaged candidate: **`v0.5.1-prealpha-wp5.1-r6`**
- r6 source/tag commit: **`b479244a40ebf3f1e56787edd044d06b2d050e2b`**
- r6 Windows ZIP: **`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r6-win-x64.zip`**
- r6 artifact SHA-256: **`4a411e8769fd39a2cfa46feaf0bb6e711e8fbd1b5c0d98b5e74a93d7ebf3a64a`**
- Packaged target: **Windows x64**
- Release-readiness state: **FIELD BLOCKED**
- Unity line: **`6000.3`**; recorded candidate test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source versus packaged candidate

`v0.5.1-prealpha-wp5.1-r6` was published on 2026-10-03 from commit `b479244a40ebf3f1e56787edd044d06b2d050e2b`. It packages the post-r5 Windows networking, Project identity, diagnostics, packaging and foreign-lock visual-feedback stabilization selected for the next field pass.

The published r6 ZIP then passed Exact Release Validation run `37110765817` on Windows. That run downloaded the Release asset, verified the recorded SHA-256 and every release-manifest file hash, extracted from a foreign working directory under a Korean/space-containing path, revalidated the staged public/source contract, verified the bundled Runtime/Node and Launcher fail-closed behavior, and exercised the exact-candidate Windows path-resilience/real-junction checks.

That gives r6 **exact-package automated evidence**. It does **not** replace physical two-PC evidence for Windows firewall/UAC behavior, actual LAN reachability, process-loss Project identity recovery, or the full Host → Guest → realtime user flow.

The exact r5 package remains the physical evidence artifact for the 2026-08-31 scenarios. Those results stay valid and must not be rewritten as if they never happened. Publishing r6 adds a new artifact/evidence boundary; it does not retroactively change r5 bytes.

This status update may be newer than the r6 source commit because publication metadata is recorded after the immutable artifact exists. Later runtime changes on `main`, if any, must again be treated separately from r6.

### Post-r5 stabilization now packaged in r6

r6 includes bounded behavior that was newer than r5, including:

- Windows LAN firewall onboarding that can create narrow Coordinator/Seed inbound rules after explicit user and UAC approval, scoped to the Private profile and `LocalSubnet`, with TeamForge-owned reconciliation/cleanup behavior;
- Seed startup recovery when the preferred/default port is occupied or unavailable, including Windows bind-context `EACCES`, with one fallback to an OS-assigned port and advertisement of the actual selected endpoint;
- Project identity creation serialization and Windows crash recovery using an OS-owned named-pipe live lock plus a permanent compatibility fence for older writers. Recent Node 22/24 Windows identity-recovery jobs passed; issue #182 remains open as an intermittent-CI watch rather than a demonstrated persistent incompatibility;
- Coordinator rejection cleanup, HTTP cancellation/deadline hardening, improved Host diagnostic context, WebSocket client-role logs, clearer Launcher Invite versus `TF1` code wording, and the current `TeamForge · Locked by <owner>` SceneView feedback. Issue #79 remains open because visual feedback does not necessarily eliminate all transient local Gizmo motion.

Linux/macOS Project identity stale-lock recovery remains outside the Windows-specific recovery implementation.

## Capability status

| Area | Current source state | Current evidence boundary |
| --- | --- | --- |
| Connected-user presence | ✅ Implemented / exercised | Physical two-PC baseline worked; broader external testing remains useful |
| Selection / Editor awareness | ✅ Implemented / exercised | Broader external testing remains useful |
| Transform synchronization | 🟡 Implemented / stabilizing | Exact r5 two-PC late-join/contention recovery passed; r6 exact-package automation passed; broader physical coverage and #79 UX follow-up remain |
| Basic locking / ownership | 🟡 Implemented / stabilizing | Exact r5 contention/recovery passed; r6 includes foreign-lock SceneView feedback; #79 remains open for transient-edit prevention/clarity |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 Implemented / stabilizing | Supported subset was exercised physically; broader field coverage remains useful |
| Project bootstrap / Collaboration Invite | 🟡 Implemented / stabilizing | Exact r5 saved-Guest reconnect passed; r6 packages Windows Project identity crash recovery and passed exact-package automation; physical process-loss/conflict recovery remains pending |
| Direct P2P project transfer | 🟡 Implemented / stabilizing | Exact r5 `5091` Stop/Start + real transfer passed; r6 packages firewall onboarding and unavailable-port fallback; actual two-PC LAN lifecycle evidence remains pending |
| Diagnostics / recovery UX | 🟡 Implemented / stabilizing | r6 packages the later diagnostics/recovery refinements and privacy-safe support-bundle path; broader field usability remains useful |
| Windows path resilience / execution alias | 🟡 Implemented / stabilizing | Exact r5 real long/deep-path handoff passed; exact r6 Windows path/junction automation passed; malicious/unrelated alias refusal remains fail-closed coverage |
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

The published r6 artifact additionally passed Exact Release Validation run `37110765817`: Release download/hash identity, release-manifest file hashes, Korean/space-path fresh extraction from a foreign CWD, staged public/source validation, bundled Runtime/Node verification, Launcher fail-closed Runtime behavior, and exact-candidate Windows path-resilience/real-junction checks all passed. This is package evidence for those automated checks; it is not a substitute for the remaining two-PC LAN/UAC/process-loss field scenarios.

## Recorded physical two-PC evidence

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
- Exact r5 physical evidence proves the r5 bytes and scenarios that were exercised; it does not prove r6-specific networking/identity behavior.
- Exact r6 automated Release validation proves the r6 artifact/hash/manifest/extraction/Runtime/Launcher/path checks that ran; it does not prove second-machine LAN reachability, UAC/firewall lifecycle, real process-loss recovery, or SceneView UX timing.
- Product version alone is not byte identity; exact packaged evidence requires the exact artifact filename and SHA-256.
- A closed bug does not automatically prove that every later implementation touching the same subsystem has package/field evidence.
- Historical phase/work-state/evidence notes remain valid for their recorded snapshots but do not override this page for current readiness.

## Remaining release-readiness gate

Before TeamForge should be promoted as a generally installable alpha:

1. Use the exact r6 identity above for the remaining post-r5 field pass; do not rebuild or silently replace its bytes.
2. On exact r6, validate the Windows networking lifecycle that matters for users: fresh firewall onboarding/UAC flow, narrow rule scope/lifecycle, preferred-port unavailable/collision fallback, actual advertised Seed reachability, Host stop/start, and a fresh Guest transfer.
3. On exact r6, validate Windows Project identity recovery after abnormal process loss and confirm ambiguous/conflicting identities still fail closed.
4. Run a fresh-extraction Host → fresh Guest → realtime collaboration smoke test on exact r6. While doing the two-Editor pass, also check that foreign-lock feedback is understandable and clears correctly after release/takeover; #79 remains the dedicated UX follow-up.
5. Keep #182 as an intermittent-CI watch: if it recurs, use the classified diagnostics and preserve fail-closed locking rather than masking it with retries/skips.
6. Record only scenarios actually exercised, preserving the completed r5 physical evidence separately from new r6 evidence.
7. Continue install/update/uninstall guidance and obtain testing/review from people other than the project creator before broad reliability claims.

A server process restart is currently a **disconnect/fail-closed/new-session recovery** scenario, not a persistence test: durable authority/session restart recovery is not implemented.

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
