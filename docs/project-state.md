# Current project state — 0.5.1 WP5.1 Path Resilience

Last reviewed against public source and current GitHub Actions evidence on 2026-08-21 (Asia/Seoul).

Product version: `0.5.1`  
Release identity: `0.5.1-wp5.1-path-resilience`  
Current packaged candidate tag: `v0.5.1-prealpha-wp5.1-r2`  
Candidate contract status: `FIELD_BLOCKED` (**FIELD BLOCKED**)

This file is a compact engineering-state summary. For public release-readiness claims use [STATUS.md](STATUS.md). For exact runtime/tool/protocol identity use [`../release-contract.json`](../release-contract.json). For packaged-build classification and byte identity use [`../builds/README.md`](../builds/README.md).

## Current implementation

TeamForge currently has working prototype paths for:

- connected-user Presence and Editor awareness;
- Transform synchronization for position, rotation, and scale;
- server-authoritative lock/ownership leases;
- same-Scene Hierarchy create/delete/rename/reparent/sibling-order synchronization;
- signed/validated Collaboration Invite and Host/Guest bootstrap metadata;
- direct HTTP Project Peer payload transfer with chunking, integrity checks, resume/retry, staging, activation, and seed/failover foundations;
- diagnostics/recovery UX;
- WP5.1 Windows path-resilience using a bounded managed short-workspace / execution-alias strategy.

General Component/`SerializedProperty`, Inspector, Prefab, general Asset, cross-Scene structural collaboration, persistent restart recovery, and automatic Internet NAT traversal remain outside the supported current capability set.

## Current realtime / transfer invariants

- Realtime Protocol v1.
- Project Transfer Protocol v1.
- Project Manifest Schema v1.
- TeamForge Server WebSocket is the sole realtime authority route.
- Project payload bytes use direct HTTP between Project Peers and do not traverse the Coordinator.
- Packaged Host/Guest paths use the bundled, hash-verified Runtime and do not require system Node/npm.
- Changed Project UUID or Owner and tampered invites fail before stored trust bindings change; changed Publisher requires explicit trust.
- Successful Baseline refresh preserves immutable Active revisions and moves `current.json` only after staging and verification; failure preserves the previous Active revision.
- WP5.1 path handling must not weaken containment, runtime integrity, trust, activation, or final Unity handoff checks.

## 2026-08-21 collaboration-race stabilization

PR #57 was merged after deterministic tests exposed Editor-side state-machine races around foreign locks, Hierarchy rollback, Transform tracking, and rapid Selection changes.

The final fix:

- replaced a fixed global Hierarchy reconciliation grace with **object-scoped reconciliation**;
- preserves the last confirmed authoritative Transform while the tracked object is being reconciled;
- prevents unrelated Hierarchy changes from globally pausing Transform tracking;
- restores unauthorized local Transform state before tracking is reset when Selection leaves a foreign-locked object;
- re-arms tracking deterministically after rejected/undone Hierarchy changes.

The final product-changing PR head was `a750545787ae614a5534afdf8859e137349230f8`, later merged into `main` without subsequent product-code changes before the r2 candidate was built.

## Automated evidence now present

### Unity Tests

Relevant pull requests and `main` pushes run `.github/workflows/unity-tests.yml` with Unity `6000.3.21f1`.

The final PR #57 product-changing head passed:

- Generic Unity EditMode validation;
- package EditMode validation;
- Unity Realtime Authority E2E against a real TeamForge server and second WebSocket peer;
- Unity Lock Contention E2E;
- Realtime Authority Chaos E2E;
- Project Transfer Resume E2E.

### Authority chaos / recovery

The latest PR #57 authority stress evidence completed **159 / 159 checks** across three deterministic seeds:

- 117 multi-peer authority-chaos checks;
- 42 recovery-chaos checks.

Covered cases include competing locks, lease expiry/takeover, stale/future revisions, operation replay/conflict, hierarchy lock protection, same-user session supersession, lock cleanup, and late-join convergence.

### WP5.1 r2 packaging

Publisher run `32449536756` completed successfully from `main` commit `8442b59bd9ff8cfc10f70c5693dda18b52d20e0c` and created `v0.5.1-prealpha-wp5.1-r2`.

The publisher rebuilds Runtime and the self-contained Windows Launcher, stages a fresh candidate tree, regenerates `release-manifest.json`, runs staged repository/runtime/launcher validation plus Launcher Core tests, creates a new immutable ZIP and SHA-256 sidecar, and publishes a new prerelease rather than modifying the previous candidate in place.

## Evidence boundary

Do not infer a current PASS from an older report merely because it exists under `docs/`.

- Current source/tests describe implemented behavior.
- `STATUS.md` is the current capability/release-readiness source of truth.
- `release-contract.json` identifies exact runtime/tool/protocol lineage.
- `builds/README.md` and the GitHub Release identify the current packaged candidate and byte-level artifact identity.
- GitHub Actions provides source, Unity, chaos, and packaging evidence for the exact runs described above.
- Historical Phase/work-state reports remain evidence only for the candidates they recorded.

## Remaining release boundary

The current candidate remains **FIELD BLOCKED**. Automated qualification is not a substitute for the remaining exact-candidate field work, especially:

1. physical two-PC Windows Host → Invite → Guest → Transfer → Activation → Realtime validation;
2. fresh-install/fresh-project testing from the exact r2 artifact;
3. real failure/recovery checks for disconnect, interrupted transfer, host/seed loss, and mismatch scenarios;
4. exact-candidate Unity evidence retained as release evidence;
5. realistic long/deep/unicode Windows path field validation;
6. install/update/uninstall documentation and external testing.

The next development direction can proceed in parallel with those field gates. The near-term Scene-collaboration target is a safe Component add/remove and Inspector/`SerializedProperty` synchronization foundation, starting with deliberately narrow supported shapes rather than arbitrary Unity serialization.
