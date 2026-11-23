# TeamForge — owner interview product contract (2026-11-23)

> **Proposed direction, not an implemented feature or shipped release.** This captures interview Q1–Q13 and keeps decisions revisable. Actual implementation/evidence stays in [STATUS](STATUS.md); future milestones remain in [ROADMAP](ROADMAP.md).

## Product goal

Enable novice and experienced collaborators to work in their **normal Unity Editors**, with a safe and simple Host → invite → Guest → co-edit experience, meaningful control for advanced users, and optional approved AI/Unity CLI/MCP involvement. Make preservation of every user's work the top product quality concern; never disguise unsupported operations as successful collaboration.

### Decision register (preferences, not permanent architecture)

| Interview | Desired outcome | Guardrail |
| --- | --- | --- |
| Q1–2: concurrent edits | Hybrid locking; merge truly independent edits; preview and manual decision for contested values | Server revisions, exact object/component/property identities, Undo and dependency checks. No silent destructive last-writer wins. |
| Q3: offline | Preserve unconfirmed local work; automatic safe merge and manual merge or isolated copy as options | Local Unity edits are not automatically authoritative shared edits; offline merge is not a currently proven capability. |
| Q4: imported assets | Show signed change preview, approvals and optional low-risk automation | Hashes, GUID/meta, executable scripts, Asset licenses, previous verified Active preservation. |
| Q5–7: Host disruption | Manual or preselected backup Host; optional safe automatic failover; configurable role permissions | Hosting authority does not transfer Project ownership; prevent two simultaneously authoritative Hosts. In a partition preserve local branches, never double-commit. |
| Q8–9: Unity scope | Extend normal Unity workflows to multiple Scenes, Inspector, Prefabs, Animation, Timeline, code and eventual cooperative Play Mode | Feature-specific verified adapters; do not promise arbitrary third-party plugin, physics or Play Mode replication. |
| Q10–12: recovery | No silent work loss; timeline, selective restore, preview and recoverable separate copies by default | Distinguish committed realtime operations, saved files, pending client work and independent backup. No absolute zero-loss claim. |
| Q13: onboarding | Default first-run experience automatic and novice-friendly, expert configuration accessible | Test with real first-time users; risky project/permission/trust changes still require meaningful consent. |

**Owner note:** preferences may change. Do not overfit to “support everything”: the product can offer several safe workflows without presenting them all at once.

## Six user journeys to make actually work

### J1. First collaboration in five minutes
A Windows user with a supported Unity project starts TeamForge inside Unity, reviews first publication and shares one understandable invitation. A new Guest can verify Publisher/project identity, receive the hashed project, use the expected Unity version and join the correct Scene, without installing developer Node/npm. A blocked firewall, missing runtime, long path, wrong invite or cancelled download produces an actionable recovery state; no false success or leaked credentials.

### J2. Ordinary Unity editing, not a proprietary creation menu
Two Editors create/rename/move/delete an admitted GameObject through ordinary Hierarchy and Inspector actions. The other side gets a complete, correct representation **only where supported** (Mesh, Renderer, Collider, IDs, Material and verified dependencies). Unsupported prefab/custom components stay local with clear status rather than a misleading Transform-only proxy. Verify save/reopen, duplicate/lost ACK, Undo, lock conflicts and late joins. Expand adapters as supported Unity evidence accrues.

### J3. Project publish while peers are editing
Host imports a third-party Prefab or saves an Asset/Scene; TeamForge previews changed signed Project inputs and potential executable/licensing risks. M4 accepted edits must be fenced and transactionally checkpointed before changing M5 baseline epochs. Stage and verify source chunks, publish under authorized Owner/Publisher identity, refresh Guest verified Active, and recover a coherent before/after state across crashes, cancellation, disk full and lost acknowledgments. A read-only preview or SQLite-only batch is a prerequisite, **not** completed end-to-end promotion.

### J4. Reconnect after conflicting offline edits
Keep local work while disconnected, explicitly mark it unconfirmed, and compare base, current and local states upon rejoin. Auto-merge independently provable changes; otherwise offer diff/preview, choose local/remote/selected modifications, and an isolated copy to test outcomes. Do not globally Undo unrelated work or silently overwrite verified Active.

### J5. Host failure or split brain
Preserve acknowledged state and each user's pending work; resume only under a validated single authority/epoch. Permit a manually nominated successor later, subject to explicit authority fencing. A partitioned group may edit a separate local branch but cannot independently declare a competing canonical project head.

### J6. AI and joint test experiences (research)
Use official Unity tooling only when compatibility is verified. Treat AI as an explicitly authorized actor, not as an unaccountable local superuser: read-only exploration can precede writes; shell/package execution and destructive edits require separate isolation and consent. Separate independent Play Mode tests, shared observation and true shared runtime state.

## Delivery order (does not replace M1–M8)

1. **P0: one correct common path.** Review and test integrated [PR #620](https://github.com/Eun-si123/teamforge-unity-collab/pull/620), reconciling overlaps with drafts [#607](https://github.com/Eun-si123/teamforge-unity-collab/pull/607), [#614](https://github.com/Eun-si123/teamforge-unity-collab/pull/614), [#616](https://github.com/Eun-si123/teamforge-unity-collab/pull/616). Keep [#598](https://github.com/Eun-si123/teamforge-unity-collab/issues/598) native creation and [#590](https://github.com/Eun-si123/teamforge-unity-collab/issues/590) onboarding attached to end-user evidence. Do not duplicate overlapping implementations.
2. **P1: finish M4→M5 safe project transition.** Add a real write barrier, authenticated owner approval, signed candidate recheck, durable Session checkpoint, filesystem activation and verified Guest refresh. Preserve the existing durable-checkpoint-required refusal until the crash-recoverable cross-store transaction exists.
3. **P2: ordinary M6–M8 Unity workflows.** Multiple Scenes, allowlisted Inspector, imported Prefab instance/reference, Asset lifecycle, then Animation/Timeline and custom components. Each adapter needs exact ID, serialization/Undo and recovery tests.
4. **P3: inspectable history and offline reconciliation.** Implement recovery timeline, optional selective restore and separate preview copies, leveraging external Git/Unity VCS rather than rebuilding all source control.
5. **P4: roles, reachability, optional relay and Host migration.** Scoped roles, manual planned migration before automatic failover, single-writer fencing, measured 2–8 Editor performance.
6. **P5: AI and collaborative Play Mode.** Start with narrow read-only official CLI/MCP experiments independently; support writes only with enforceable identity, policy, audit and isolation. Distinguish shared game runtime from shared editing.

Each improvement must show its user-visible value, preserve data integrity, include negative and recovery tests, identify ownership and rollback, and avoid increasing maintenance cost without evidence.

## User-ready alpha acceptance matrix

| Journey | Positive proof | Negative/recovery proof |
| --- | --- | --- |
| Join | Fresh packaged Windows Host/Guest → verified invite and correct Unity project/Scene | Wrong/expired invite, inaccessible Seed, port/firewall, cancellation/retry, wrong Unity version |
| Native edit | Two *physical* Editors observe matching admitted Cube/Collider/Inspector state; save/reopen | Conflicting edits, unsupported Prefab, duplicate/lost receipt, foreign lock, reconnect, Undo |
| M4/M5 | Signed revised Project and Guest Active transition with same approved Session state | Disk full, tampered chunk/GUID, crash before/after commit, mismatched revision, retained prior Active |
| Recovery | Confirmed operations persist through restart; unconfirmed work visibly retained for review | Stale epoch, lost peer, Host outage, corrupt database, ambiguous offline merge |
| UX/performance | A novice can join without developer help; benchmark realistic workload for 2–8 people | Slow Windows PC, low disk, interrupted network; compare p95/p99 edit lag, CPU/RAM/GC and bytes with baseline |

**Proof levels must be separate:** (1) source implementation; (2) exact-head automated Node/Unity/.NET checks; (3) immutable packaged artifact checks; (4) two distinct physical Windows Editors and real failure paths; (5) independent user trial. Report NOT RUN when not run. Check [STATUS](STATUS.md) for the current release readiness; do not imply these proposed outcomes are already supported.

Measure time-to-first-join, first-try success, conflict rate, confirmed recovery, unexplained work loss, added Editor CPU/RAM/GC and network usage, and user comprehension. Set numeric thresholds after measuring a no-TeamForge comparison, not by guesswork.

## Engineering boundaries

Preserve the **existing** [architecture](architecture.md): Unity observes/applies authority, Node Coordinator owns realtime Session order/leases, separate Project Peer handles signed manifest/chunk transfer and verified Active, Guest Launcher validates trust and handoff. Prefer extending these boundaries rather than a second collaboration engine. Never weaken signed project identity, path restrictions, operation idempotency, version and epoch checks, secret redaction, consent or rollback safety to improve convenience.

New hosted infrastructure, perpetual storage, cryptographic role transfer, arbitrary script execution and unattended deployment require specific trade-off and threat-model review. An MCP connection is not a per-command authorization sandbox. Current direct P2P is not automatic NAT traversal.

## Related trackers and review triggers

- [#620](https://github.com/Eun-si123/teamforge-unity-collab/pull/620) integrated M1–M5 Draft, partial M4→M5 groundwork; do not merge duplicate feature branches.
- [#600](https://github.com/Eun-si123/teamforge-unity-collab/issues/600) imported Prefab/Assets; [#549](https://github.com/Eun-si123/teamforge-unity-collab/issues/549) lock granularity; [#590](https://github.com/Eun-si123/teamforge-unity-collab/issues/590) onboarding/architecture; [#622](https://github.com/Eun-si123/teamforge-unity-collab/issues/622) performance.
- Validate through [Test Lab](TEST_LAB.md), [Code Map](../CODEMAP.md) and independent exact-artifact field evidence. Never turn local Node tests into Unity/Windows PASS.
- Reconsider decisions after real novice testing, reproduced data loss, physical multi-Editor evidence, a serious security finding or meaningful Unity/CLI/MCP version changes.
