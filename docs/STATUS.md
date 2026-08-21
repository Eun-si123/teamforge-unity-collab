# TeamForge current status

**English** | [한국어](STATUS.ko.md)

_Last reviewed against public source and current GitHub Actions evidence: 2026-08-21 (Asia/Seoul)_

Current product version: `0.5.1`  
Current release ID: `0.5.1-wp5.1-path-resilience`  
Current packaged candidate tag: `v0.5.1-prealpha-wp5.1-r2`  
Current candidate state: **FIELD BLOCKED**

Product version, release ID, and packaged artifact identity are separate concepts. The exact artifact is identified by the Release tag, filename, and SHA-256 rather than by `0.5.1` alone.

> [!WARNING]
> **Early Public Preview — source and a packaged candidate are available, but general installation is not recommended yet.**
>
> TeamForge is still being stabilized. Keep backups and prefer disposable Unity projects for testing. The existence of a packaged candidate and green automation does not make the project production-ready.

This page is the short source of truth for **what exists now, what is automatically checked, what remains unverified, and what must still happen before a generally installable alpha is promoted**.

For exact runtime/tool/protocol identity, use [`../release-contract.json`](../release-contract.json). For current/superseded packaged-build identity and SHA-256 rules, use [`../builds/README.md`](../builds/README.md).

## Capability status

| Area | Current state | Notes |
| --- | --- | --- |
| Connected-user presence | ✅ Prototype exists | Project/session-scoped presence and peer awareness exist. |
| Selection / Editor awareness | ✅ Prototype exists | Selection, active Scene, Scene View awareness, and teammate navigation exist. |
| Transform synchronization | ✅ Prototype exists | Position, rotation, and scale synchronization exist under Realtime Protocol v1. |
| Basic locking / ownership | 🟡 Stabilizing | Server-authoritative lease/ownership exists; contention and recovery now have deterministic automation, while real-world UX/field behavior still needs more validation. |
| Same-Scene Hierarchy synchronization | 🟡 Stabilizing | Create, delete, rename, reparent, and sibling-order synchronization exist for the supported same-Scene path. |
| Transform/Hierarchy reconciliation | 🟡 Stabilizing | PR #57 replaced fixed global hierarchy grace with object-scoped reconciliation and added recovery for rejected/undone hierarchy edits and rapid selection changes under foreign locks. |
| Project bootstrap / Collaboration Invite | 🟡 Stabilizing | Signed/validated bootstrap metadata and Host/Guest flow exist, but the full two-PC field workflow is not closed. |
| Direct P2P project transfer | 🟡 Stabilizing | Direct HTTP Project Peer transfer, chunking, integrity checks, resume/retry, staging, activation, and seed/failover logic exist. |
| Diagnostics / recovery UX | 🟡 Stabilizing | Stable error explanations, bounded/redacted diagnostics, and state-driven recovery actions exist. |
| Windows path resilience | 🟡 Stabilizing | WP5.1 uses a bounded managed short-workspace / execution-alias strategy and keeps containment, trust, activation, and final handoff checks separate from path convenience. |
| Component / Inspector synchronization | ⏳ Planned | General Component add/remove and `SerializedProperty` collaboration are not implemented as supported workflows. |
| Prefab / Asset collaboration | ⏳ Planned | General Prefab and Asset synchronization are not supported capabilities. |
| Persistent restart recovery | ⏳ Planned | Persistent server/session recovery remains outside the current release scope. |
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

The repository now has multiple evidence classes instead of only source-level CI.

### Source / runtime CI

Pull requests and relevant `main` updates run checks for:

- **Public source contract (Node 24)** — source/document/package/release-contract consistency on a fresh checkout. `npm run validate` executes this public-source validator and intentionally does not require generated release binaries;
- **Server (Node 24)** — locked dependency install, syntax/source checks, and server tests;
- **Project Peer (Node 24)** — integration dependency install, policy/source checks, and Project Peer tests;
- **Launcher runtime loader (Node 24)** — runtime-loader syntax and tests;
- **Launcher (.NET 10 / Windows)** — Launcher Core tests, restore, and Windows build.

### Unity and real-server automation

`.github/workflows/unity-tests.yml` now runs on relevant pull requests and `main` pushes and includes Unity 6000.3.21f1 automation. The latest PR #57 product-changing head (`a750545787ae614a5534afdf8859e137349230f8`) completed the `Unity Tests` workflow successfully with:

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

### Packaged candidate publication

The r2 publisher workflow run `32449536756` completed successfully from `main` commit `8442b59bd9ff8cfc10f70c5693dda18b52d20e0c` and created `v0.5.1-prealpha-wp5.1-r2`. Before publication, the workflow rebuilds the packaged Runtime and self-contained Windows Launcher, stages a fresh release tree, regenerates the release manifest, runs staged repository/runtime/launcher validation and Launcher Core tests, then creates a new ZIP and SHA-256 sidecar.

This is meaningful automated evidence, but it is **not equivalent to physical two-PC field closure** and should not be described that way.

## Evidence boundaries

A green workflow proves only the scenario and artifact identity it actually exercised.

- Source CI does not prove a packaged ZIP is correct.
- Unity automation does not prove every callback ordering, network condition, or physical two-PC setup.
- Server chaos does not replace Unity Editor/UI state-machine testing.
- A packaged candidate build does not prove the Host → Guest workflow on two independent machines.
- Historical reports apply to the exact candidate/run they record unless newer evidence explicitly supersedes them.

For current questions, prefer this order:

1. current source and tests for implemented behavior;
2. this `STATUS.md` for capability/release-readiness claims;
3. `release-contract.json` for exact runtime/protocol/release identity;
4. current module READMEs and `docs/architecture.md` for topology and trust boundaries;
5. `builds/README.md`, GitHub Release assets, and exact hashes for packaged byte identity;
6. dated phase/work-state reports only for their recorded historical evidence.

## Current release / installation state

A packaged WP5.1 r2 candidate exists, but there is still **no TeamForge release recommended for use as a dependable production collaboration layer on an important project**.

The public source intentionally does not commit generated Runtime payloads or packaged executables as canonical source. The packaged Host/Guest path is therefore a separate release artifact with its own manifests, hashes, and validation evidence.

## Remaining field / release-readiness blockers

Before TeamForge should be presented as a generally installable alpha, the project should still close at least these gates on the exact intended candidate:

1. **Two-PC Windows end-to-end field validation** of Host → invite → Guest → project transfer → activation → realtime collaboration.
2. **Fresh-install / fresh-project testing from the exact r2 release artifact**, including normal user-facing setup rather than a development workspace.
3. **Field verification of failure/recovery behavior** under interrupted transfer, reconnect, host/seed loss, mismatched state, and safe refusal paths.
4. **Exact-candidate Unity validation retained as release evidence**, in addition to source/PR Unity automation.
5. **Path-resilience field checks** on realistic long/deep/unicode Windows project locations without weakening containment or final handoff checks.
6. **Clear install / update / uninstall documentation** for normal users.
7. **At least some external testing/review** so release confidence is not based only on the project creator and automation.

These are readiness gates, not promised dates.

## Important current limitations

- Keep backups; prefer disposable projects for experimental testing.
- TeamForge complements Git/Unity Version Control; it is not a replacement for version history or backup.
- Same-Scene Hierarchy collaboration is narrower than general Component/Inspector/Prefab/Asset collaboration.
- Cross-Scene structure, general Component sync, Inspector sync, Prefab structure sync, and general Asset sync remain unsupported.
- Persistent server/session restart recovery is not implemented.
- Direct P2P requires directly reachable Project Peer endpoints; automatic internet NAT traversal is not implemented.
- Windows x64 is the current packaged target; macOS/Linux equivalent release artifacts are not published.
- The Windows Launcher is not Authenticode-signed.
- Arbitrarily deep Windows paths are not promised; WP5.1 uses bounded managed path handling.
- TeamForge has not completed an independent professional security audit.

## Near-term development direction

The current foundation is stable enough to continue development while WP5.1 remains field-blocked. The next Scene-collaboration direction is to design a safe **Component add/remove + Inspector / `SerializedProperty` synchronization foundation**, starting with narrow supported property/component shapes rather than blindly synchronizing every Unity serialization case.

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
