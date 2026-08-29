# TeamForge current status

**English** | [한국어](STATUS.ko.md)

_Last documentation review: 2026-08-30 (Asia/Seoul). Current-source integration facts include the WP5.1 core field-blocker merge recorded on 2026-08-27._

> [!WARNING]
> **Early Public Preview — do not use TeamForge as the only copy or recovery mechanism for an important Unity project.**
>
> The current source contains substantial stabilization work, but physical Windows field closure is still incomplete. Keep backups and prefer disposable projects while testing.

This file is the **canonical human-readable source for current capability and release-readiness claims**. Other documents should link here instead of maintaining their own competing copy of current blocker or validation state.

For exact product/runtime/protocol selections, use [`../release-contract.json`](../release-contract.json). For packaged byte identity and superseded-build rules, use [`../builds/README.md`](../builds/README.md). For detailed bug discussion, use the linked GitHub issues.

## Current state at a glance

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- Current packaged candidate recorded by the release contract: **`v0.5.1-prealpha-wp5.1-r2`**
- Packaged target: **Windows x64**
- Release-readiness state: **FIELD BLOCKED**
- Unity line: **`6000.3`**; recorded candidate test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source versus packaged candidate

PR #81 (`fix: close core Windows field blockers`) was merged into `main` on 2026-08-27 at merge commit `8a9bef7a785b2fd4b1842cf0ee70f6e5163481a7`. It includes the #68/#74 Transform/Lock recovery work that had previously lived on PR #76.

The previously published `v0.5.1-prealpha-wp5.1-r2` artifact was built before that merge. **Do not treat r2 as an exact packaged post-fix field-closure candidate.** A future packaged candidate used for closure must be rebuilt from the intended post-fix source, published as a new immutable artifact, and identified by its exact filename and SHA-256.

## Capability status

| Area | Current source state | Remaining boundary |
| --- | --- | --- |
| Connected-user presence | ✅ Implemented / exercised | Broader external testing still useful |
| Selection / Editor awareness | ✅ Implemented / exercised | Broader external testing still useful |
| Transform synchronization | 🟡 Implemented / stabilizing | #68/#74 source fixes are merged; exact physical two-PC contention rerun remains |
| Basic locking / ownership | 🟡 Implemented / stabilizing | Exact physical two-PC contention and handoff rerun remains |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 Implemented / stabilizing | Supported subset only; broader field coverage remains useful |
| Project bootstrap / Collaboration Invite | 🟡 Implemented / stabilizing | #67 saved-Guest reconnect source fix is merged; physical rerun remains |
| Direct P2P project transfer | 🟡 Implemented / stabilizing | #70 stable Seed `5091` source fix is merged; LAN/firewall field rerun remains |
| Diagnostics / recovery UX | 🟡 Implemented / stabilizing | #69 receive/shutdown handling source fix is merged; Windows interruption/resume rerun remains |
| Windows path resilience / execution alias | 🟡 Implemented / stabilizing | #71 exact canonical alias handoff source fix is merged; real long/deep-path rerun remains |
| Component / Inspector synchronization | ⏳ Planned | General Component add/remove and `SerializedProperty` sync are not supported yet |
| Prefab / general Asset collaboration | ⏳ Planned | Not a supported current workflow |
| Persistent server/session restart recovery | ⏳ Planned | Current authority/session state remains memory-resident |
| Automatic Internet NAT traversal / relay | 🔬 Research / future | No WebRTC, ICE, STUN, TURN, relay, discovery, or automatic NAT traversal |

## WP5.1 core field-blocker source status

The following fixes are **present in current source** but remain open as field-validation debt:

| Issue | Current source state | What still needs physical validation |
| --- | --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) — saved Guest reconnect | Fix merged in PR #81 | Reopen a legitimately saved collaborative Guest for the same verified Project/session/Baseline/path; fresh/unverified joins must remain strict |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) / [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) — rapid Transform / lock protected conflict | Recovery and first-snapshot dirtiness fixes merged via PR #81 | Physical two-PC A/B contention: losing peer must not snap during active drag, then converge after release and remain usable |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) — receive shutdown | Handled `runtime_shutdown` path merged in PR #81 | Receive → close/terminate → restart/resume without an unhandled CLR/application error |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) — Seed/firewall onboarding | Production Seed pinned to TCP `5091` in PR #81 | Real LAN/firewall onboarding, Seed restart, and rebind behavior |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) — execution-alias handoff | Exact canonical resolution for approved TeamForge-owned alias merged in PR #81 | Real long/deep-path Guest handoff; unrelated or retargeted aliases must still fail closed |

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

These results are evidence for the exact scenarios they executed. They do **not** replace physical two-PC Windows validation.

## Recorded physical two-PC evidence — 2026-08-22

The following worked in the recorded two-PC Windows field flow before the blocker scenarios were isolated:

- Host → signed Collaboration Invite → fresh Guest → authentication → direct Project transfer → Publisher trust → verified Active Project → Unity realtime connection
- Presence and bidirectional Transform synchronization
- normal lock/ownership contention
- supported same-Scene Hierarchy create/rename/reparent/sibling-order/delete
- unsaved Guest exit/reopen with authoritative Hierarchy/Transform/Lock recovery from the still-running session
- Coordinator TCP interruption → retry → automatic reconnect without restarting Unity

That baseline proves the common path is not wholly untested, but it does not close the five targeted Windows field scenarios above.

## Evidence boundaries

A result proves only what it exercised.

- Source CI does not prove a packaged ZIP is correct.
- Unity automation does not reproduce every SceneView input ordering, Windows process condition, LAN/firewall state, or second-machine timing path.
- Same-machine multi-project testing strengthens confidence but still shares one OS, network stack, timing environment, and hardware.
- A successful older packaged candidate does not prove a newer source revision or replacement ZIP.
- Product version alone is not byte identity; exact packaged evidence requires the exact artifact filename and SHA-256.
- Historical phase/work-state/evidence notes remain valid for their recorded snapshots but do not override this page for current readiness.

## Remaining release-readiness gate

Before TeamForge should be promoted as a generally installable alpha:

1. Build and publish an **exact post-fix packaged candidate** from the intended source lineage.
2. Rerun the #67, #68/#74, #69, #70, and #71 physical Windows scenarios against that intended candidate.
3. Rerun the normal Host → fresh Guest → realtime collaboration path from a fresh extraction / fresh project state.
4. Retain exact candidate identity and evidence for the field run.
5. Validate remaining important host/server/seed/process-loss and safe-refusal scenarios.
6. Improve install/update/uninstall guidance and obtain testing/review from people other than the project creator before broad reliability claims.

A server process restart is currently a **disconnect/fail-closed/new-session recovery** scenario, not a persistence test: durable authority/session restart recovery is not implemented.

## Information ownership

To avoid documentation drift, use these sources for these questions:

| Question | Canonical source |
| --- | --- |
| What works now? What is blocked? | **This `STATUS.md`** |
| What exact versions/runtimes/protocols are selected? | [`release-contract.json`](../release-contract.json) |
| What exact packaged bytes are current/superseded? | [`builds/README.md`](../builds/README.md) + GitHub Release SHA-256 |
| What is planned? | [`ROADMAP.md`](ROADMAP.md) |
| How is the current system structured? | [`architecture.md`](architecture.md) |
| Why was an architecture decision made? | [`architecture-decisions.md`](architecture-decisions.md) |
| What is the detailed state of a bug? | GitHub Issues |
| What happened in an older test or stabilization pass? | Dated phase/work-state/evidence notes |
