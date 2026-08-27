# TeamForge current status

**English** | [한국어](STATUS.ko.md)

_Last reviewed against public source, GitHub Actions evidence, recorded local Unity validation, and recorded physical two-PC field evidence: 2026-08-25 (Asia/Seoul)_

Current product version: `0.5.1`  
Current release ID: `0.5.1-wp5.1-path-resilience`  
Current packaged candidate tag: `v0.5.1-prealpha-wp5.1-r2`  
Current candidate state: **FIELD BLOCKED**

Product version, release ID, and packaged artifact identity are separate concepts. The exact artifact is identified by the Release tag, filename, and SHA-256 rather than by `0.5.1` alone.

> [!WARNING]
> **Early Public Preview — source and a packaged candidate are available, but general installation is not recommended yet.**
>
> TeamForge is still being stabilized. Keep backups and prefer disposable Unity projects for testing. The existence of a packaged candidate and green automation does not make the project production-ready.

This page is the short source of truth for **what exists now, what is automatically checked, what local/physical field testing has actually demonstrated, what remains unverified, and what must still happen before a generally installable alpha is promoted**.

For exact runtime/tool/protocol identity, use [`../release-contract.json`](../release-contract.json). For current/superseded packaged-build identity and SHA-256 rules, use [`../builds/README.md`](../builds/README.md).

## Capability status

| Area | Current state | Notes |
| --- | --- | --- |
| Connected-user presence | ✅ Prototype exists | Project/session-scoped presence and peer awareness exist and were exercised in physical two-PC field testing. |
| Selection / Editor awareness | ✅ Prototype exists | Selection, active Scene, Scene View awareness, and teammate navigation exist. |
| Transform synchronization | 🟡 Stabilizing | Position, rotation, and scale synchronization work in normal two-PC use. The #68 field failure has a recovery/snapshot-hardening patch in draft PR #76 (#74 tracks the narrowed lock-contention path). Same-machine A/B contention recovery and A/B/C late-join convergence both passed; physical two-PC contention revalidation is still required. |
| Basic locking / ownership | 🟡 Stabilizing | Server-authoritative lease/ownership exists and normal contention works. PR #76 repairs the observed foreign-owner/`lock_required` ordering that could leave a stale protected conflict. Same-machine two-project contention passed recovery, later B→A sync, and lock handoff back to A, but field closure still depends on an exact physical two-PC rerun. |
| Same-Scene Hierarchy synchronization | 🟡 Stabilizing | Create, delete, rename, reparent, and sibling-order synchronization worked in the recorded two-PC field flow for the supported same-Scene path. A/B/C Test Lab late join also converged the late peer to the current Hierarchy state. |
| Transform/Hierarchy reconciliation | 🟡 Stabilizing | PR #57 replaced fixed global hierarchy grace with object-scoped reconciliation. PR #76 additionally preserves true pre-snapshot local Scene dirtiness while excluding TeamForge-authored remote dirtiness from the first Transform snapshot conflict decision; the targeted A/B/C late-join test passed with zero protected conflicts. |
| Project bootstrap / Collaboration Invite | 🟡 Stabilizing | Signed/validated bootstrap metadata and the Host/Guest flow exist; a physical fresh-Guest end-to-end flow succeeded. Draft PR #81 now contains patches for saved-Guest reconnect, receive shutdown, stable Seed port, and verified execution-alias handoff, but those paths still need targeted Windows field reruns. |
| Direct P2P project transfer | 🟡 Stabilizing | Direct HTTP Project Peer transfer, chunking, integrity checks, resume/retry, staging, activation, and seed/failover logic exist. PR #81 changes production Host Seed orchestration from a dynamic port to stable TCP `5091`; LAN/firewall field validation is still pending. |
| Diagnostics / recovery UX | 🟡 Stabilizing | Stable error explanations and recovery actions exist. #68/#74 recovery has deterministic automated coverage plus positive same-machine validation. PR #81 also handles Launcher receive/dispose races as a bounded runtime-shutdown error, pending direct Windows interruption testing. |
| Windows path resilience | 🟡 Stabilizing | WP5.1 uses a bounded managed short-workspace / execution-alias strategy. PR #81 adds exact canonical resolution for an approved Windows reparse-point execution alias while keeping unrelated/retargeted aliases fail-closed; real long-path field validation remains pending. |
| Component / Inspector synchronization | ⏳ Planned | General Component add/remove and `SerializedProperty` collaboration are not implemented as supported workflows. |
| Prefab / Asset collaboration | ⏳ Planned | General Prefab and Asset synchronization are not supported capabilities. |
| Persistent restart recovery | ⏳ Planned | Persistent server/session recovery remains outside the current release scope. Current authority/session state is memory-resident. |
| Internet NAT traversal / relay | 🔬 Research / future | TeamForge currently does not provide WebRTC, ICE, STUN, TURN, relay, or automatic NAT traversal. |

## Current candidate identity

The current source-controlled release contract identifies:

- product version `0.5.1`;
- release ID `0.5.1-wp5.1-path-resilience`;
- packaged candidate tag `v0.5.1-prealpha-wp5.1-r2`;
- Windows x64 target;
- bundled Node `24.19.0`;
- developer/source Node range `>=22.23.2 <23 || >=24.18.1 <25`;
- npm release tooling `11.19.0`;
- `ws@8.21.3`;
- Unity package line `6000.3`, with recorded test Editor `6000.3.21f1`;
- Realtime Protocol v1, Project Transfer Protocol v1, Project Manifest Schema v1;
- candidate state `FIELD_BLOCKED`.

The r2 candidate is a rebuild from current `main`, not an in-place modification of the previous ZIP. It retains the WP5.1 Long Path/path-resilience source and includes the later Transform/Hierarchy contention fixes merged through PR #57. Exact byte identity is the release tag + filename + SHA-256 published with the Release asset/sidecar.

## What GitHub Actions checks now

The repository has multiple evidence classes instead of only source-level CI.

### Source / runtime CI

Pull requests and relevant `main` updates run checks for:

- **Public source contract (Node 24)** — source/document/package/release-contract consistency on a fresh checkout. `npm run validate` executes this public-source validator and intentionally does not require generated release binaries;
- **Server (Node 24)** — locked dependency install, syntax/source checks, and server tests;
- **Project Peer (Node 24)** — integration dependency install, policy/source checks, and Project Peer tests;
- **Launcher runtime loader (Node 24)** — runtime-loader syntax and tests;
- **Launcher (.NET 10 / Windows)** — Launcher Core tests, restore, and Windows build.

### Unity and real-server automation

`.github/workflows/unity-tests.yml` runs on relevant pull requests and `main` pushes and includes Unity 6000.3.21f1 automation.

The #68/#74 PR #76 lineage adds focused EditMode coverage for:

- latest deferred authoritative Transform revision wins during recoverable contention;
- a quiescent `lock_required` conflict restores the last confirmed Transform;
- recovery waits while `GUIUtility.hotControl` is active;
- an authoritative foreign lock owner during an active local edit becomes recoverable and still waits for hot-control release;
- generic protected conflicts remain fail-closed;
- first-Transform-snapshot dirty tracking ignores Scene dirtiness raised inside `TeamForgeRemoteApplyScope`, preserves genuine local dirtiness, and consumes/resets that pre-snapshot set once used.

Draft PR #81 (`fix/core-field-blockers`) is stacked on PR #76 and adds focused coverage for the remaining core field blockers:

- verified Guest reconnect markers require exact Project/session/Baseline/canonical Active Project identity;
- a previously verified same-session Guest may reopen after a legitimate saved Scene hash change while a normal first join remains strict;
- Windows execution aliases must resolve to the exact canonical Active Project and fail after retargeting;
- production Host Seed orchestration is pinned to TCP `5091` rather than dynamic `--port 0`;
- Launcher pending requests are settled through a handled runtime-shutdown path during dispose/close races.

At PR #81 head `8f285ac0ad62202c1d09546948b175804dac69f3`, normal CI run #188 and Unity Tests run #67 both completed successfully on 2026-08-25. This is automated evidence, not physical Windows field closure.

### Same-machine two-project validation — 2026-08-25

The PR #76 lineage was exercised with two separate Unity projects on one physical machine in the targeted A/B contention flow. B acquired/held the authoritative lock first, while A repeatedly and aggressively attempted SceneView Transform edits against the same object. Any transient losing-side local movement converged back to the authoritative value after interaction release and TeamForge emitted:

```text
[TeamForge] Recovered a lock-contention Transform conflict by restoring the latest authoritative value.
```

No persistent `Protected unresolved local Transform conflict from live overwrite` loop remained. Subsequent B→A Transform synchronization continued normally, and after ownership release/handoff A could acquire the lock and A→B synchronization also remained healthy.

This is strong local multi-project evidence for the intended #68/#74 recovery path and the post-recovery usability check. It still does **not** replace the physical two-PC field rerun, because both Unity Editors shared one OS/machine/network stack.

### A/B/C late-join and local full EditMode validation — 2026-08-25

The standard Test Lab A/B/C flow was also run locally with C kept offline until after A/B had changed both Hierarchy and Transform state. On C's late join, the current Hierarchy and Transform snapshot converged with `0 protected conflict(s)`, no false `Protected local unsaved Transform` / `Protected unresolved local Transform conflict` warning was observed, and post-join edits continued to synchronize between C and the already-connected peers. This is direct positive evidence for the first-Transform-snapshot Scene-dirtiness hardening in PR #76.

After the PR #81 test-isolation fixes, the local Unity Test Runner discovered 145 tests. All 143 tests runnable in a normal local Editor passed. The two remaining tests were intentionally ignored because they are real-server E2E lanes that only enable under their GitHub Actions command-line switches (`-teamforgeCiLockContentionE2E` and `-teamforgeCiE2E`). The corresponding GitHub Unity workflow completed successfully on the same `8f285ac...` head.

The latest merged PR #57 product-changing head (`a750545787ae614a5534afdf8859e137349230f8`) also completed Generic Unity EditMode validation, package EditMode validation, Unity Realtime Authority E2E against a real TeamForge server and second WebSocket peer, Unity Lock Contention E2E, Realtime Authority Chaos E2E, and Project Transfer Resume E2E.

### Authority chaos / recovery stress

The latest PR #57 authority stress evidence completed **159 / 159 checks** across three deterministic seeds:

- 117 checks from the multi-peer authority chaos suite;
- 42 checks from the recovery chaos suite.

The scenarios include lock contention, lease expiry/takeover, stale/future revisions, operation replay/conflict, destructive hierarchy checks, same-user session supersession, lock cleanup, and late-join convergence.

A separate draft PR #72 adds a real Unity + real TeamForge Server chaos lane for field issue #68. Its first synthetic rapid-Transform/selection churn scenario passed without reproducing the physical failure. That narrowed the missing trigger but did not itself fix #68; the current targeted fix is carried by PR #76 and still requires physical two-PC contention validation.

### Packaged candidate publication

The r2 publisher workflow run `32449536756` completed successfully from `main` commit `8442b59bd9ff8cfc10f70c5693dda18b52d20e0c` and created `v0.5.1-prealpha-wp5.1-r2`. Before publication, the workflow rebuilds the packaged Runtime and self-contained Windows Launcher, stages a fresh release tree, regenerates the release manifest, runs staged repository/runtime/launcher validation and Launcher Core tests, then creates a new ZIP and SHA-256 sidecar.

This is meaningful automated evidence, but it is **not equivalent to physical two-PC field closure**.

## Physical two-PC field evidence recorded on 2026-08-22

The current field record is more specific than the previous blanket statement that the whole two-PC workflow remained untested.

What was demonstrated on two physical Windows PCs:

- Host → signed Collaboration Invite → fresh Guest import → Coordinator/authentication → direct Project transfer → publisher trust → verified Active Project → Unity realtime connection completed successfully in the recorded run.
- Presence, bidirectional Transform sync, normal lock/ownership contention, and supported same-Scene Hierarchy create/rename/reparent/sibling-order/delete all worked before the later failure cases were exercised.
- A Guest that exits **without saving** collaborative Scene changes can reopen through the Launcher and recover current authoritative Hierarchy/Transform/Lock state from the still-running session.
- A Guest whose TCP/5080 path to the Coordinator was temporarily blocked detected disconnect, kept retrying, and automatically reconnected after the block was removed without restarting Unity; realtime collaboration resumed.

Field blockers discovered by the same testing now have draft fixes on the active branch lineage:

- **#67 — saved Guest reconnect:** the original field failure rejected a saved collaboratively modified Scene with `guest_handoff_mismatch`. PR #81 now stores a verified reconnect identity only after strict production handoff checks and permits saved-hash drift only for the exact same verified Project/session/Baseline/path. Fresh/unverified joins remain strict. Local/automated tests pass; physical saved-Guest reopen is still required.
- **#68 / #74 — rapid Transform / lock protected conflict:** PR #76 patches the explicit foreign-owner/`lock_required` ordering and the original first-snapshot dirty-Scene ambiguity. Automation, same-machine A/B contention, and A/B/C late-join validation pass. The remaining closure evidence is the exact physical two-PC contention rerun.
- **#69 — interrupted receive shutdown:** PR #81 converts bridge disposal/pending-request shutdown races into a handled `runtime_shutdown` path rather than intentionally surfacing raw `ObjectDisposedException`. A real Windows Receive → close → restart/resume field test is still required.
- **#70 — Windows firewall / Seed:** PR #81 pins production Seed to stable TCP `5091`, allowing a narrow fixed-port firewall rule and avoiding the previous dynamic-port onboarding problem. Real LAN Seed/Receive and restart/rebind validation are still required.
- **#71 — execution alias handoff:** PR #81 validates an approved Windows reparse-point alias by resolving the opened directory back to the exact canonical Active Project; retargeted/unrelated aliases remain fail-closed. A real long/deep-path Launcher handoff rerun is still required.

These findings are why the candidate remains **FIELD BLOCKED** even though the core blockers now have code patches and green local/automated coverage.

## Evidence boundaries

A green workflow or successful field scenario proves only what it actually exercised.

- Source CI does not prove a packaged ZIP is correct.
- Unity automation does not prove every callback ordering, network condition, SceneView input path, or physical two-PC setup.
- Server chaos does not replace Unity Editor/UI state-machine testing.
- A same-machine two-project pass exercises separate Unity project state and the same authority protocol, but it still shares the same OS, timing environment, network stack, and hardware; it therefore strengthens confidence without replacing physical two-PC evidence.
- Local Test Runner coverage proves the code paths and test isolation exercised there, not Windows Launcher/process/firewall behavior outside the Editor.
- One successful fresh-Guest field run does not close saved reconnect, rapid-input races, firewall onboarding, path-alias handoff, or interruption behavior.
- Historical reports apply to the exact candidate/run they record unless newer evidence explicitly supersedes them.

For current questions, prefer this order:

1. current source and tests for implemented behavior;
2. this `STATUS.md` for capability/release-readiness claims;
3. current GitHub issues/comments for newer field evidence not yet incorporated elsewhere;
4. `release-contract.json` for exact runtime/protocol/release identity;
5. current module READMEs and `docs/architecture.md` for topology and trust boundaries;
6. `builds/README.md`, GitHub Release assets, and exact hashes for packaged byte identity;
7. dated phase/work-state reports only for their recorded historical evidence.

## Current release / installation state

A packaged WP5.1 r2 candidate exists, but there is still **no TeamForge release recommended for use as a dependable production collaboration layer on an important project**.

The public source intentionally does not commit generated Runtime payloads or packaged executables as canonical source. The packaged Host/Guest path is therefore a separate release artifact with its own manifests, hashes, and validation evidence.

## Remaining field / release-readiness blockers

Before TeamForge should be presented as a generally installable alpha, the project should still close at least these gates on the intended candidate lineage:

1. **Field-validate the draft fixes for #67, #69, #70, and #71**, keeping their fail-closed identity/path/security boundaries intact. The code and regression coverage are now present in PR #81, but the affected Windows workflows have not all been repeated physically yet.
2. **Rerun exact-candidate two-PC Windows field closure**, including the combined #68/#74 Transform/lock contention scenario. Same-machine A/B contention and A/B/C late join are already positive; physical two-PC contention remains the closure gate.
3. **Fresh-install / fresh-project testing from the exact intended release artifact**, including normal user-facing setup rather than a development workspace.
4. **Complete the remaining failure/recovery matrix** for interrupted transfer, host/seed/process loss, mismatched state, and safe refusal. The recorded Coordinator network interruption/reconnect is already a positive partial result.
5. **Exact-candidate Unity validation retained as release evidence**, in addition to source/PR Unity automation.
6. **Path-resilience field checks** on realistic long/deep/unicode Windows project locations without weakening containment or final handoff checks.
7. **Clear install / update / uninstall documentation** for normal users.
8. **At least some external testing/review** so release confidence is not based only on the project creator and automation.

These are readiness gates, not promised dates.

## Important current limitations

- Keep backups; prefer disposable projects for experimental testing.
- TeamForge complements Git/Unity Version Control; it is not a replacement for version history or backup.
- Same-Scene Hierarchy collaboration is narrower than general Component/Inspector/Prefab/Asset collaboration.
- Cross-Scene structure, general Component sync, Inspector sync, Prefab structure sync, and general Asset sync remain unsupported.
- Persistent server/session restart recovery is not implemented. Because current authority/session state is memory-resident, restarting the server is expected to lose the old Session/Lock/Hierarchy/Transform authority state; a restart field check is therefore about clean disconnect/fail-closed/recovery UX, not persistence of the old session.
- Direct P2P requires directly reachable Project Peer endpoints; automatic internet NAT traversal is not implemented.
- Windows x64 is the current packaged target; macOS/Linux equivalent release artifacts are not published.
- The Windows Launcher is not Authenticode-signed.
- Arbitrarily deep Windows paths are not promised; WP5.1 uses bounded managed path handling.
- TeamForge has not completed an independent professional security audit.

## Near-term development direction

The immediate priority is now **targeted physical Windows validation of PR #81 and the final physical two-PC #68/#74 contention rerun**, rather than adding another core blocker patch. Once those field gates are green, the next major Scene-collaboration expansion remains a safe **Component add/remove + Inspector / `SerializedProperty` synchronization foundation**, starting with narrow supported property/component shapes rather than blindly synchronizing every Unity serialization case.

See [ROADMAP.md](ROADMAP.md) for direction and [known-issues.md](known-issues.md) for current limitations.

## Related documents

- [README.md](../README.md) — project overview
- [release-contract.json](../release-contract.json) — exact current runtime/protocol/release identity
- [builds/README.md](../builds/README.md) — current/superseded packaged artifact classification
- [architecture.md](architecture.md) — as-built runtime topology and authority/trust boundaries
- [project-state.md](project-state.md) — compact current engineering-state summary
- [known-issues.md](known-issues.md) — current limitations and missing validation
- [deployment.md](deployment.md) — packaged Windows deployment/rollback contract
- [ROADMAP.md](ROADMAP.md) — development direction and future work
- [SOURCE.md](SOURCE.md) — source-tree and validation guide
- [SECURITY.md](../.github/SECURITY.md) — security expectations and reporting
