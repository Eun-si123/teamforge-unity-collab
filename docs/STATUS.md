# TeamForge current status

**English** | [한국어](STATUS.ko.md)

_Last reviewed against public source, GitHub Actions evidence, and recorded physical two-PC field evidence: 2026-08-25 (Asia/Seoul)_

Current product version: `0.5.1`  
Current release ID: `0.5.1-wp5.1-path-resilience`  
Current packaged candidate tag: `v0.5.1-prealpha-wp5.1-r2`  
Current candidate state: **FIELD BLOCKED**

Product version, release ID, and packaged artifact identity are separate concepts. The exact artifact is identified by the Release tag, filename, and SHA-256 rather than by `0.5.1` alone.

> [!WARNING]
> **Early Public Preview — source and a packaged candidate are available, but general installation is not recommended yet.**
>
> TeamForge is still being stabilized. Keep backups and prefer disposable Unity projects for testing. The existence of a packaged candidate and green automation does not make the project production-ready.

This page is the short source of truth for **what exists now, what is automatically checked, what physical field testing has actually demonstrated, what remains unverified, and what must still happen before a generally installable alpha is promoted**.

For exact runtime/tool/protocol identity, use [`../release-contract.json`](../release-contract.json). For current/superseded packaged-build identity and SHA-256 rules, use [`../builds/README.md`](../builds/README.md).

## Capability status

| Area | Current state | Notes |
| --- | --- | --- |
| Connected-user presence | ✅ Prototype exists | Project/session-scoped presence and peer awareness exist and were exercised in physical two-PC field testing. |
| Selection / Editor awareness | ✅ Prototype exists | Selection, active Scene, Scene View awareness, and teammate navigation exist. |
| Transform synchronization | 🟡 Stabilizing | Position, rotation, and scale synchronization work in normal two-PC use, but field issue #68 can enter a protected-conflict state after rapid repeated manipulation attempts. |
| Basic locking / ownership | 🟡 Stabilizing | Server-authoritative lease/ownership exists and normal contention works, but #68 indicates a remaining lock/client-state race or state-divergence path under rapid repeated manipulation. |
| Same-Scene Hierarchy synchronization | 🟡 Stabilizing | Create, delete, rename, reparent, and sibling-order synchronization worked in the recorded two-PC field flow for the supported same-Scene path. |
| Transform/Hierarchy reconciliation | 🟡 Stabilizing | PR #57 replaced fixed global hierarchy grace with object-scoped reconciliation, but physical field evidence still exposes a Transform/lock protected-conflict path not reproduced by the first synthetic #68 chaos lane. |
| Project bootstrap / Collaboration Invite | 🟡 Stabilizing | Signed/validated bootstrap metadata and the Host/Guest flow exist; a physical fresh-Guest end-to-end flow succeeded, but release closure remains blocked by reconnect/path/firewall/launcher defects. |
| Direct P2P project transfer | 🟡 Stabilizing | Direct HTTP Project Peer transfer, chunking, integrity checks, resume/retry, staging, activation, and seed/failover logic exist. Field testing also exposed the Windows firewall/runtime-path problem tracked in #70. |
| Diagnostics / recovery UX | 🟡 Stabilizing | Stable error explanations and recovery actions exist, but #68 showed UI state can disagree with the internal protected-conflict path, and #67 still blocks saved-Scene reconnect. |
| Windows path resilience | 🟡 Stabilizing | WP5.1 uses a bounded managed short-workspace / execution-alias strategy, but #71 shows production Guest handoff currently rejects an otherwise approved execution alias. |
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

`.github/workflows/unity-tests.yml` runs on relevant pull requests and `main` pushes and includes Unity 6000.3.21f1 automation. The latest PR #57 product-changing head (`a750545787ae614a5534afdf8859e137349230f8`) completed the `Unity Tests` workflow successfully with:

- Generic Unity EditMode validation;
- package EditMode validation;
- Unity Realtime Authority E2E against a real TeamForge server and second WebSocket peer;
- Unity Lock Contention E2E;
- Realtime Authority Chaos E2E;
- Project Transfer Resume E2E.

That PR head was merged into `main` without changing the tested product code.

### Authority chaos / recovery stress

The latest PR #57 authority stress evidence completed **159 / 159 checks** across three deterministic seeds:

- 117 checks from the multi-peer authority chaos suite;
- 42 checks from the recovery chaos suite.

The scenarios include lock contention, lease expiry/takeover, stale/future revisions, operation replay/conflict, destructive hierarchy checks, same-user session supersession, lock cleanup, and late-join convergence.

A separate draft PR #72 adds a real Unity + real TeamForge Server chaos lane for field issue #68. Its first synthetic rapid-Transform/selection churn scenario passed without reproducing the physical failure. That narrows the missing trigger but is **not a fix and not evidence that #68 is resolved**; actual SceneView/Handles ordering, lock timing, and client-state transitions remain under investigation.

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

Field blockers discovered by the same testing:

- **#67 — saved Guest reconnect:** saving the collaboratively modified Scene changes the on-disk baseline hash, so reopening the same verified Active Project is rejected with `guest_handoff_mismatch`.
- **#68 — rapid Transform / lock protected conflict:** repeated rapid manipulation attempts can leave the Guest refusing later remote Transform updates. Field UI has also reported `Lock owned` / `0 protected conflict(s)` while the internal `ProtectedConflictKeys` branch is refusing updates.
- **#69 — interrupted receive shutdown:** force-ending the Windows Launcher during `Receiving` can surface an unhandled CLR application-error dialog; resume behavior still needs clean shutdown/interruption validation.
- **#70 — Windows firewall / Seed:** Windows Defender Firewall cannot resolve the bundled Node path for a program-specific rule, while Seed currently uses a dynamic port, making repeatable LAN onboarding fragile.
- **#71 — execution alias handoff:** the path-resilience execution alias can be accepted by the Launcher but rejected by Editor-side exact Active-path validation.

These findings are why the candidate remains **FIELD BLOCKED** even though substantial parts of the physical two-PC path now have positive evidence.

## Evidence boundaries

A green workflow or successful field scenario proves only what it actually exercised.

- Source CI does not prove a packaged ZIP is correct.
- Unity automation does not prove every callback ordering, network condition, SceneView input path, or physical two-PC setup.
- Server chaos does not replace Unity Editor/UI state-machine testing.
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

1. **Fix or safely redesign the current field blockers**, especially #67 saved-Scene reconnect, #68 Transform/lock state divergence, #70 firewall/Seed onboarding, and #71 execution-alias handoff; close #69's receive-shutdown exception path as part of recovery hardening.
2. **Rerun exact-candidate two-PC Windows field closure after the fixes**, preserving the already-demonstrated fresh-Guest baseline while proving the corrected reconnect/contention/path/firewall flows.
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

The immediate priority is to close the field-reported reliability blockers above and rerun the affected physical scenarios. The next major Scene-collaboration expansion after that remains a safe **Component add/remove + Inspector / `SerializedProperty` synchronization foundation**, starting with narrow supported property/component shapes rather than blindly synchronizing every Unity serialization case.

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
