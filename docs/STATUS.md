# TeamForge current status

**English** | [한국어](STATUS.ko.md)

_Last documentation review: 2026-08-30 (Asia/Seoul). Current-source integration facts include the WP5.1 core field-blocker merge, the post-fix r4 candidate published on 2026-08-27, the post-r4 repository/Launcher operability work merged on 2026-08-30, and the mixed-provenance physical two-PC field run recorded on 2026-08-30._

> [!WARNING]
> **Early Public Preview — do not use TeamForge as the only copy or recovery mechanism for an important Unity project.**
>
> The current source contains substantial stabilization work and the 2026-08-30 physical two-PC run materially strengthened the post-fix field evidence, but exact packaged-candidate closure is still incomplete. Keep backups and prefer disposable projects while testing.

This file is the **canonical human-readable source for current capability and release-readiness claims**. Other documents should link here instead of maintaining their own competing copy of current blocker or validation state.

For exact product/runtime/protocol selections, use [`../release-contract.json`](../release-contract.json). For packaged byte identity and superseded-build rules, use [`../builds/README.md`](../builds/README.md). For detailed bug discussion, use the linked GitHub issues.

## Current state at a glance

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- Latest published packaged candidate: **`v0.5.1-prealpha-wp5.1-r4`**
- r4 artifact SHA-256: **`390ecbe4dad9488acdd992cc7198b25bf6407debf050d78385b01e076275c030`**
- Packaged target: **Windows x64**
- Release-readiness state: **FIELD BLOCKED**
- Unity line: **`6000.3`**; recorded candidate/field-test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source versus packaged candidate

PR #81 (`fix: close core Windows field blockers`) was merged into `main` on 2026-08-27 at merge commit `8a9bef7a785b2fd4b1842cf0ee70f6e5163481a7`. It includes the #68/#74 Transform/Lock recovery work that had previously lived on PR #76.

The post-fix `v0.5.1-prealpha-wp5.1-r4` candidate was subsequently published from `main` commit `5fdebda8c91e3c858e894356eb4bb735bbc34885`. Its Windows ZIP is `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-candidate-win-x64.zip` with SHA-256 `390ecbe4dad9488acdd992cc7198b25bf6407debf050d78385b01e076275c030`.

**r4 remains the exact published candidate for the original #67/#68/#69/#70/#71/#74 physical field-closure scenarios, and it is still FIELD BLOCKED.** Publication and cryptographic identity do not close those scenarios.

Current `main` has moved beyond the r4 source snapshot. In particular, the 2026-08-30 repository/operability merge added the Windows Launcher **Save support bundle** behavior and its privacy-contract tests, in addition to documentation, Test Lab, engineering-quality-gate, and release-tooling changes. Those post-r4 source changes do **not** retroactively modify the already-published r4 ZIP.

A physical two-PC Windows run on 2026-08-30 used current-source Host `main@ac53e931488a60daa82b2c50e8e6817654981f5a` on PC A and the exact r4 packaged Guest Launcher on PC B. The field-relevant Host Unity files checked after the run were byte-identical Git blobs to the r4 publication source for saved reconnect, Guest handoff, and Transform/Lock recovery. However, the Host package had no generated `Runtime~` and therefore used the source/development execution path rather than the exact packaged Host runtime. The run is recorded in [`PHYSICAL_FIELD_EVIDENCE_2026-08-30.md`](PHYSICAL_FIELD_EVIDENCE_2026-08-30.md).

Therefore:

- use **r4** when recording evidence specifically about the existing r4 packaged candidate;
- treat the 2026-08-30 mixed Host/Guest run as strong physical post-fix interoperability evidence, not as exact r4 packaged-Host closure;
- do **not** describe r4 as byte- or behavior-equivalent to current `main`;
- if current `main` is to become the next packaged candidate, publish a new immutable artifact and validate that exact artifact rather than extending r4 claims to later source.

## Capability status

| Area | Current source state | Remaining boundary |
| --- | --- | --- |
| Connected-user presence | ✅ Implemented / exercised | Broader external testing still useful |
| Selection / Editor awareness | ✅ Implemented / exercised | Broader external testing still useful |
| Transform synchronization | 🟡 Implemented / stabilizing | Physical two-PC contention recovery was observed PASS on 2026-08-30 mixed provenance; exact replacement-candidate rerun and #68 fresh-late-join boundary remain |
| Basic locking / ownership | 🟡 Implemented / stabilizing | Physical two-PC contention/handoff was observed healthy in the 2026-08-30 run; exact replacement-candidate confirmation remains |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 Implemented / stabilizing | Supported subset exercised again on two PCs; broader field coverage remains useful |
| Project bootstrap / Collaboration Invite | 🟡 Implemented / stabilizing | #67 saved-Guest reconnect positive path was observed PASS on 2026-08-30; strict negative identity/path case and exact replacement-candidate confirmation remain |
| Direct P2P project transfer | 🟡 Implemented / stabilizing | Real LAN transfer with Seed listening on TCP `5091` was observed on 2026-08-30; exact packaged-Host restart/rebind confirmation remains |
| Diagnostics / recovery UX | 🟡 Implemented / stabilizing | Exact r4 Guest interruption/resume was observed without the old CLR dialog in the 2026-08-30 run, but #69 is race-sensitive and needs repeated exact-candidate coverage; current source also adds the post-r4 support-bundle path |
| Windows path resilience / execution alias | 🟡 Implemented / stabilizing | Exact r4 Guest positive path reached `path_budget_risk_detected` and successful Unity/realtime handoff on 2026-08-30; retargeted/unrelated alias rejection and exact replacement-candidate confirmation remain |
| Component / Inspector synchronization | ⏳ Planned | General Component add/remove and `SerializedProperty` sync are not supported yet |
| Prefab / general Asset collaboration | ⏳ Planned | Not a supported current workflow |
| Persistent server/session restart recovery | ⏳ Planned | Current authority/session state remains memory-resident |
| Automatic Internet NAT traversal / relay | 🔬 Research / future | No WebRTC, ICE, STUN, TURN, relay, discovery, or automatic NAT traversal |

## WP5.1 core field-blocker source status

The following fixes are **present in current source and in the r4 packaged candidate**. The 2026-08-30 physical run materially reduced the field-validation uncertainty, but it did not use an exact packaged Host and therefore does not by itself close the release gate.

| Issue | Current source/package state | Physical evidence and remaining boundary |
| --- | --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) — saved Guest reconnect | Fix merged in PR #81 and included in r4 | Saved collaborative Guest -> save -> exit -> same live-session reconnect was observed PASS on two PCs; fresh/unverified/wrong-identity fail-closed check and exact replacement-candidate confirmation remain |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) / [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) — rapid Transform / lock protected conflict | Recovery and first-snapshot dirtiness fixes merged via PR #81 and included in r4 | Rapid physical A/B contention no longer remained stuck in the observed 2026-08-30 run; the distinct fresh-baseline late-join snapshot scenario still needs deliberate physical coverage, then exact replacement-candidate confirmation |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) — receive shutdown | Handled `runtime_shutdown` path merged in PR #81 and included in r4 | Exact r4 Guest Receive -> close/terminate -> restart/resume worked without the old CLR dialog in the observed run; because the original bug was intermittent, repeat abrupt-termination coverage on the exact replacement candidate remains |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) — Seed/firewall onboarding | Production Seed pinned to TCP `5091` in PR #81 and included in r4 | Real two-PC LAN transfer and `0.0.0.0:5091` listening were observed; exact packaged-Host stop/start/rebind and transfer confirmation remain |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) — execution-alias handoff | Exact canonical resolution for approved TeamForge-owned alias merged in PR #81 and included in r4 | Exact r4 Guest positive long/deep-path handoff was observed through `path_budget_risk_detected` -> verified Active -> Unity/realtime; retargeted/unrelated alias fail-closed check and exact replacement-candidate confirmation remain |

Detailed discussion belongs in the GitHub issues. This page owns the release effect and current summary.

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

The post-r4 integration work was also exercised on its final pre-merge head by normal CI, Engineering Quality Gate, Dependency Review, Pages, Authority Chaos Stress, Windows Launcher build/diagnostics safety tests, and the four Unity E2E lanes. That is evidence for current source integration; it does **not** turn the older r4 ZIP into a package of those later source changes.

The r4 Release was published from the patched `main` commit identified above with an immutable-by-policy ZIP/SHA pair. This establishes exact artifact identity; it does **not** replace physical two-PC Windows validation.

## Recorded physical two-PC evidence — 2026-08-30

A post-fix physical Windows run was performed with:

- PC A Host: `main@ac53e931488a60daa82b2c50e8e6817654981f5a`, embedded current-source Unity package, source/development runtime path;
- PC B Guest: exact `v0.5.1-prealpha-wp5.1-r4` packaged Launcher;
- Unity: `6000.3.21f1`;
- two separate physical PCs on a LAN.

The run reported successful fresh bootstrap/transfer/realtime, Presence, bidirectional Transform, supported Hierarchy operations, saved Guest reconnect, physical Transform/Lock contention recovery, receive interruption/resume, stable LAN Seed TCP `5091`, and the positive long/deep-path execution-alias handoff. Captured signals included `0.0.0.0:5091 LISTENING` on the Host and the Guest sequence `path_budget_risk_detected` -> `guest_state: Complete` -> `guest_active_verified` -> `unity_open_started`.

This closes a large part of the uncertainty that remained after same-machine/CI testing, but the Host was not the exact packaged r4 Host runtime and several negative/edge scenarios were not deliberately isolated. Full provenance, observed results, and limitations are recorded in [`PHYSICAL_FIELD_EVIDENCE_2026-08-30.md`](PHYSICAL_FIELD_EVIDENCE_2026-08-30.md).

## Recorded physical two-PC evidence — 2026-08-22

The following worked in the recorded two-PC Windows field flow before the blocker scenarios were isolated:

- Host → signed Collaboration Invite → fresh Guest → authentication → direct Project transfer → Publisher trust → verified Active Project → Unity realtime connection
- Presence and bidirectional Transform synchronization
- normal lock/ownership contention
- supported same-Scene Hierarchy create/rename/reparent/sibling-order/delete
- unsaved Guest exit/reopen with authoritative Hierarchy/Transform/Lock recovery from the still-running session
- Coordinator TCP interruption → retry → automatic reconnect without restarting Unity

That baseline proves the common path is not wholly untested, but it predates the post-fix field run and does not replace exact-candidate closure.

## Evidence boundaries

A result proves only what it exercised.

- Source CI does not prove a packaged ZIP is correct.
- Unity automation does not reproduce every SceneView input ordering, Windows process condition, LAN/firewall state, or second-machine timing path.
- Same-machine multi-project testing strengthens confidence but still shares one OS, network stack, timing environment, and hardware.
- Mixed source-Host / packaged-Guest physical evidence is stronger than same-machine testing for the exercised behavior, but still does not prove the exact packaged Host artifact.
- A successful older packaged candidate does not prove a newer source revision or replacement ZIP.
- Product version alone is not byte identity; exact packaged evidence requires the exact artifact filename and SHA-256.
- Publishing and hashing r4 proves artifact identity, not physical field closure.
- Later source tests do not extend r4's packaged behavior; the source commit and exact artifact must both match the claim being made.
- Historical phase/work-state/evidence notes remain valid for their recorded snapshots but do not override this page for current readiness.

## Remaining release-readiness gate

Before TeamForge should be promoted as a generally installable alpha:

1. Deliberately supersede r4 with a new immutable candidate built from current `main`; retain its exact source commit, filename, SHA-256, packaged Runtime/Launcher identity, and exact-release validation evidence.
2. Use that **same exact candidate artifact on both physical PCs** for the final field-closure run.
3. Confirm the normal packaged Host -> fresh packaged Guest -> Project transfer -> realtime collaboration smoke path from a fresh extraction/project state.
4. Recheck only the remaining/high-value blocker boundaries rather than repeating all exploratory work: #67 saved reconnect plus wrong/unverified rejection; #68/#74 rapid contention plus the distinct fresh late-join snapshot case; repeated #69 abrupt receive interruption/resume; #70 packaged Host stop/start with Seed TCP `5091` rebind and transfer; #71 positive long/deep-path handoff plus retargeted/unrelated alias rejection.
5. If the new candidate includes post-r4 packaged behavior such as Launcher **Save support bundle**, validate that behavior as evidence for the new artifact rather than inheriting it from source CI.
6. Validate remaining important host/server/seed/process-loss and safe-refusal scenarios appropriate to the candidate.
7. Improve install/update/uninstall guidance and obtain testing/review from people other than the project creator before broad reliability claims.

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
