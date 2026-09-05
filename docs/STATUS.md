# TeamForge current status

**English** | [한국어](STATUS.ko.md)

_Last documentation review: 2026-08-30 (Asia/Seoul). Current-source integration facts include the WP5.1 core field-blocker merge, the post-fix r4 candidate published on 2026-08-27, and the post-r4 repository/Launcher operability work merged on 2026-08-30._

> [!WARNING]
> **Early Public Preview — do not use TeamForge as the only copy or recovery mechanism for an important Unity project.**
>
> The current source contains substantial stabilization work and a post-fix packaged candidate exists, but physical Windows field closure is still incomplete. Keep backups and prefer disposable projects while testing.

This file is the **canonical human-readable source for current capability and release-readiness claims**. Other documents should link here instead of maintaining their own competing copy of current blocker or validation state.

For exact product/runtime/protocol selections, use [`../release-contract.json`](../release-contract.json). For packaged byte identity and superseded-build rules, use [`../builds/README.md`](../builds/README.md). For detailed bug discussion, use the linked GitHub issues.

## Current state at a glance

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- Latest published packaged candidate: **`v0.5.1-prealpha-wp5.1-r4`**
- r4 artifact SHA-256: **`390ecbe4dad9488acdd992cc7198b25bf6407debf050d78385b01e076275c030`**
- Packaged target: **Windows x64**
- Release-readiness state: **FIELD BLOCKED**
- Unity line: **`6000.3`**; recorded candidate test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source versus packaged candidate

PR #81 (`fix: close core Windows field blockers`) was merged into `main` on 2026-08-27 at merge commit `8a9bef7a785b2fd4b1842cf0ee70f6e5163481a7`. It includes the #68/#74 Transform/Lock recovery work that had previously lived on PR #76.

The post-fix `v0.5.1-prealpha-wp5.1-r4` candidate was subsequently published from `main` commit `5fdebda8c91e3c858e894356eb4bb735bbc34885`. Its Windows ZIP is `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-candidate-win-x64.zip` with SHA-256 `390ecbe4dad9488acdd992cc7198b25bf6407debf050d78385b01e076275c030`.

**r4 remains the exact published candidate for the original #67/#68/#69/#70/#71/#74 physical field-closure scenarios, and it is still FIELD BLOCKED.** Publication and cryptographic identity do not close those scenarios.

Current `main` has moved beyond the r4 source snapshot. In particular, the 2026-08-30 repository/operability merge added the Windows Launcher **Save support bundle** behavior and its privacy-contract tests, in addition to documentation, Test Lab, engineering-quality-gate, and release-tooling changes. Those post-r4 source changes do **not** retroactively modify the already-published r4 ZIP.

Therefore:

- use **r4** when recording evidence specifically about the existing r4 field-blocker candidate;
- do **not** describe r4 as byte- or behavior-equivalent to current `main`;
- if current `main` is to become the next packaged candidate, publish a new immutable artifact and validate that exact artifact rather than extending r4 claims to later source.

## Capability status

| Area | Current source state | Remaining boundary |
| --- | --- | --- |
| Connected-user presence | ✅ Implemented / exercised | Broader external testing still useful |
| Selection / Editor awareness | ✅ Implemented / exercised | Broader external testing still useful |
| Transform synchronization | 🟡 Implemented / stabilizing | #68/#74 source fixes are merged; exact physical two-PC contention rerun remains |
| Basic locking / ownership | 🟡 Implemented / stabilizing | Exact physical two-PC contention and handoff rerun remains |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 Implemented / stabilizing | Supported subset only; broader field coverage remains useful |
| Project bootstrap / Collaboration Invite | 🟡 Implemented / stabilizing | #67 saved-Guest reconnect source fix is merged; physical rerun remains |
| Direct P2P project transfer | 🟡 Implemented / stabilizing | Current source prefers a remembered exact Seed port (default `5091`), falls back to one OS-assigned port on collision, and reconciles narrow Windows rules; packaged LAN/firewall field rerun remains |
| Diagnostics / recovery UX | 🟡 Implemented / stabilizing | Current source adds a manual privacy-safe Launcher support bundle after r4; #69 interruption/resume field rerun still remains |
| Windows path resilience / execution alias | 🟡 Implemented / stabilizing | #71 exact canonical alias handoff source fix is merged; real long/deep-path rerun remains |
| Component / Inspector synchronization | ⏳ Planned | General Component add/remove and `SerializedProperty` sync are not supported yet |
| Prefab / general Asset collaboration | ⏳ Planned | Not a supported current workflow |
| Persistent server/session restart recovery | ⏳ Planned | Current authority/session state remains memory-resident |
| Automatic Internet NAT traversal / relay | 🔬 Research / future | No WebRTC, ICE, STUN, TURN, relay, discovery, or automatic NAT traversal |

## WP5.1 core field-blocker source status

The r4 candidate contains the original WP5.1 blocker fixes listed below. Current source retains those fixes and may add later hardening described per row; all of these scenarios remain open as field-validation debt:

| Issue | Current source/package state | What still needs physical validation |
| --- | --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) — saved Guest reconnect | Fix merged in PR #81 and included in r4 | Reopen a legitimately saved collaborative Guest for the same verified Project/session/Baseline/path; fresh/unverified joins must remain strict |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) / [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) — rapid Transform / lock protected conflict | Recovery and first-snapshot dirtiness fixes merged via PR #81 and included in r4 | Physical two-PC A/B contention: losing peer must not snap during active drag, then converge after release and remain usable |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) — receive shutdown | Handled `runtime_shutdown` path merged in PR #81 and included in r4 | Receive → close/terminate → restart/resume without an unhandled CLR/application error |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) — Seed/firewall onboarding | r4 pins the Seed to TCP `5091`; current source keeps `5091` as the default remembered port, falls back to one OS-assigned port on collision, and reconciles exact Private/LocalSubnet firewall rules | Real packaged LAN/firewall onboarding, preferred-port collision fallback, Seed restart/rebind, rule replacement/removal, and fresh Guest transfer |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) — execution-alias handoff | Exact canonical resolution for approved TeamForge-owned alias merged in PR #81 and included in r4 | Real long/deep-path Guest handoff; unrelated or retargeted aliases must still fail closed |

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

## Recorded physical two-PC evidence — 2026-08-22

The following worked in the recorded two-PC Windows field flow before the blocker scenarios were isolated:

- Host → signed Collaboration Invite → fresh Guest → authentication → direct Project transfer → Publisher trust → verified Active Project → Unity realtime connection
- Presence and bidirectional Transform synchronization
- normal lock/ownership contention
- supported same-Scene Hierarchy create/rename/reparent/sibling-order/delete
- unsaved Guest exit/reopen with authoritative Hierarchy/Transform/Lock recovery from the still-running session
- Coordinator TCP interruption → retry → automatic reconnect without restarting Unity

That baseline proves the common path is not wholly untested, but it does not close the five targeted r4 Windows field scenarios above.

## Evidence boundaries

A result proves only what it exercised.

- Source CI does not prove a packaged ZIP is correct.
- Unity automation does not reproduce every SceneView input ordering, Windows process condition, LAN/firewall state, or second-machine timing path.
- Same-machine multi-project testing strengthens confidence but still shares one OS, network stack, timing environment, and hardware.
- A successful older packaged candidate does not prove a newer source revision or replacement ZIP.
- Product version alone is not byte identity; exact packaged evidence requires the exact artifact filename and SHA-256.
- Publishing and hashing r4 proves artifact identity, not physical field closure.
- Later source tests do not extend r4's packaged behavior; the source commit and exact artifact must both match the claim being made.
- Historical phase/work-state/evidence notes remain valid for their recorded snapshots but do not override this page for current readiness.

## Remaining release-readiness gate

Before TeamForge should be promoted as a generally installable alpha:

1. For the existing WP5.1 field-blocker debt, either finish the targeted physical scenarios against exact r4 **or** deliberately supersede r4 with a new candidate and repeat the applicable field evidence on that exact replacement.
2. Rerun the #67, #68/#74, #69, #70, and #71 physical Windows scenarios against the artifact chosen for field closure.
3. Rerun the normal Host → fresh Guest → realtime collaboration path from a fresh extraction / fresh project state.
4. Retain exact candidate identity and evidence for the field run.
5. If packaging current `main`, validate post-r4 packaged behavior such as the Launcher support-bundle path as part of the new artifact's own evidence rather than inheriting it from source CI.
6. Validate remaining important host/server/seed/process-loss and safe-refusal scenarios.
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
