# TeamForge current status

**English** | [한국어](STATUS.ko.md) | [简体中文](STATUS.zh-Hans.md)

_Last documentation review: 2026-09-10 (UTC). Reconciled current source through the post-r5 Windows networking, diagnostics and Project identity hardening already present on `main`, the published r5 artifact, and the exact r5 physical field results recorded on 2026-08-31. Published-package evidence and newer-source evidence remain separate._

> [!WARNING]
> **Early Public Preview — do not use TeamForge as the only copy or recovery mechanism for an important Unity project.**
>
> The original WP5.1 Windows blocker set received substantial exact-r5 physical validation, but current `main` is newer than r5 and contains additional Windows networking/identity behavior that has not yet been validated as one exact replacement package on physical PCs. Keep backups and prefer disposable projects while testing.

This file is the **canonical human-readable source for current capability and release-readiness claims**. Other documents should link here instead of maintaining their own competing copy of current blocker or validation state.

For exact product/runtime/protocol selections, use [`../release-contract.json`](../release-contract.json). For packaged byte identity and superseded-build rules, use [`../builds/README.md`](../builds/README.md). For detailed bug discussion and historical reproduction notes, use the linked GitHub issues.

## Current state at a glance

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- Latest published packaged candidate: **`v0.5.1-prealpha-wp5.1-r5`**
- r5 source/tag commit: **`a97b6ba5649e2888b909bf3c99c64acfd7042ba6`**
- r5 Windows ZIP: **`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`**
- r5 artifact SHA-256: **`5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`**
- Packaged target: **Windows x64**
- Release-readiness state: **FIELD BLOCKED**
- Unity line: **`6000.3`**; recorded candidate test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source versus packaged candidate

The original WP5.1 stabilization fixes for #67, #68/#74, #69, #70 and #71 were merged through PR #81. The later `v0.5.1-prealpha-wp5.1-r5` candidate was published from commit `a97b6ba5649e2888b909bf3c99c64acfd7042ba6` and includes the post-r4 Launcher **Save support bundle** integration as well as the original blocker fixes.

On 2026-08-31, exact r5 was exercised on two physical Windows PCs. The recorded runs closed the saved-Guest reconnect (#67), fresh late-join Transform snapshot regression (#68), repeated receive/shutdown-resume race (#69), long/deep-path execution-alias handoff (#71), and stale lock-contention protected-conflict recovery (#74). The r5 LAN run also physically verified packaged Host Stop/Start rebinding on Seed TCP `5091` and a real Guest Project transfer after the required firewall access was present.

That evidence means those original scenarios are **not still waiting for their first r5 physical rerun**. It does not make later source changes part of r5, and it does not by itself make the product a generally installable alpha.

Current `main` has moved beyond r5. Therefore:

- use **r5** when making claims about the latest published packaged candidate and its exact 2026-08-31 field evidence;
- do **not** describe r5 as byte- or behavior-equivalent to current `main`;
- do not repeat the already-closed r5 blocker scenarios merely because older status text still listed them as pending;
- if current `main` becomes a replacement candidate, publish a new immutable artifact and validate the behavior actually added after r5 on that exact artifact.

### Later source hardening not present in r5

Current source adds bounded behavior after the r5 publication snapshot, including:

- Windows LAN firewall onboarding that can create narrow Coordinator/Seed inbound rules after explicit user and UAC approval, scoped to the Private profile and LocalSubnet, with TeamForge-owned rule reconciliation/cleanup behavior. The original r5 physical LAN run still required manual firewall allowance, so this later onboarding path needs exact-package physical evidence before it can support a stronger readiness claim.
- Seed startup recovery for a preferred/default port that is occupied or unavailable, including Windows bind-context `EACCES`: Host orchestration retries once with an OS-assigned port and advertises the selected endpoint. Automated Windows Project Peer coverage exists, but this behavior is newer than r5.
- Project identity creation serialization and Windows crash recovery using an OS-owned named-pipe live lock plus a permanent compatibility fence for older writers. Windows Node 22/24 crash/concurrency suites passed, but no published package containing this change has received exact-package physical field evidence.
- Coordinator rejection cleanup, HTTP cancellation/deadline hardening, improved Host diagnostic context, WebSocket client-role logs, and clearer distinction between Launcher invites and `TF1` connection codes.

These are source/automation facts, not r5 packaged behavior. Linux/macOS Project identity stale-lock recovery also remains outside the Windows-specific recovery change.

## Capability status

| Area | Current source state | Current evidence boundary |
| --- | --- | --- |
| Connected-user presence | ✅ Implemented / exercised | Physical two-PC baseline worked; broader external testing remains useful |
| Selection / Editor awareness | ✅ Implemented / exercised | Broader external testing remains useful |
| Transform synchronization | 🟡 Implemented / stabilizing | Exact r5 two-PC late-join and contention recovery passed; broader field coverage and UX follow-up remain |
| Basic locking / ownership | 🟡 Implemented / stabilizing | Exact r5 contention/recovery passed; clearer foreign-lock edit UX remains a follow-up (#79) |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 Implemented / stabilizing | Supported subset was exercised physically; broader field coverage remains useful |
| Project bootstrap / Collaboration Invite | 🟡 Implemented / stabilizing | Exact r5 saved-Guest reconnect passed; post-r5 Project identity crash recovery still lacks package/field evidence |
| Direct P2P project transfer | 🟡 Implemented / stabilizing | Exact r5 `5091` Stop/Start + real transfer passed; post-r5 firewall onboarding and unavailable-port fallback still lack replacement-package field evidence |
| Diagnostics / recovery UX | 🟡 Implemented / stabilizing | r5 includes the privacy-safe Launcher support bundle; later diagnostics refinements are source-only relative to r5 |
| Windows path resilience / execution alias | 🟡 Implemented / stabilizing | Exact r5 real long/deep-path positive handoff passed; malicious/unrelated alias refusal remains automated fail-closed coverage |
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

Later source hardening has also been exercised by focused Project Peer/Launcher/Unity tests and the normal repository quality gates. In particular, the Windows Project identity crash/concurrency suite passed on supported Node 22 and Node 24 lines, and the unavailable-Seed-port regression path passed the full Project Peer suite on the reproduced Windows environment. Those results strengthen current-source confidence but do not create packaged evidence for bytes published before the fixes.

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
- Exact r5 physical evidence proves the r5 bytes and scenarios that were exercised; it does not prove later `main` behavior.
- Product version alone is not byte identity; exact packaged evidence requires the exact artifact filename and SHA-256.
- A closed bug does not automatically prove that every later implementation touching the same subsystem has package/field evidence.
- Historical phase/work-state/evidence notes remain valid for their recorded snapshots but do not override this page for current readiness.

## Remaining release-readiness gate

Before TeamForge should be promoted as a generally installable alpha:

1. Preserve the exact r5 physical results as completed evidence; do **not** list #67/#68/#69/#71/#74 as though their exact r5 closure never happened.
2. If current `main` is selected for distribution, publish a new immutable candidate because its post-r5 runtime behavior is not present in r5.
3. On that exact replacement artifact, validate the post-r5 Windows networking lifecycle that matters for users: fresh firewall onboarding, narrow rule scope/lifecycle, preferred-port unavailable/collision fallback, actual advertised Seed reachability, Host stop/start, and a fresh Guest transfer.
4. Validate the post-r5 Windows Project identity crash-recovery behavior on the exact replacement artifact, including safe restart after process loss and continued fail-closed handling for ambiguous/conflicting identities.
5. Run a fresh-extraction Host → fresh Guest → realtime collaboration smoke test on the exact replacement artifact so newer packaging/integration changes do not inherit r5 evidence by assumption.
6. Retain exact candidate filename/SHA/source identity and record only the scenarios actually exercised.
7. Continue install/update/uninstall guidance work and obtain testing/review from people other than the project creator before broad reliability claims.

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
