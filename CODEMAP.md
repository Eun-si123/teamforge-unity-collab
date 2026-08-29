# TeamForge code map

This document maps a TeamForge question to the **smallest relevant current source area and tests**.

It is a navigation reference, not a release-status document.

- Current capability/readiness: **[docs/STATUS.md](docs/STATUS.md)**
- Exact runtime/protocol/release selections: **[`release-contract.json`](release-contract.json)**
- Current architecture and trust boundaries: **[docs/architecture.md](docs/architecture.md)**
- Source setup and validation workflow: **[docs/SOURCE.md](docs/SOURCE.md)**
- Planned direction: **[docs/ROADMAP.md](docs/ROADMAP.md)**

## Start here by question

| Question | Read first | Then inspect |
| --- | --- | --- |
| What is TeamForge and what is ready? | [README.md](README.md), [docs/STATUS.md](docs/STATUS.md) | `release-contract.json`, relevant GitHub Issues |
| How do the major processes fit together? | [docs/architecture.md](docs/architecture.md) | [docs/architecture-decisions.md](docs/architecture-decisions.md) |
| How does Unity connect to realtime authority? | [Unity package README](unity-package/com.eunsung.teamforge/README.md) | `TeamForgeConnectionService.cs`, `server/src/teamforge-server.mjs`, `server/src/session-authority.mjs` |
| Where is Presence implemented? | `Editor/Presence/TeamForgePresenceService.cs` | `server/src/session-authority.mjs` |
| Where is Transform / Lock synchronization implemented? | `Editor/TransformSync/TeamForgeTransformSyncService.cs` | `Editor/Authority/TeamForgeAuthorityView.cs`, `server/src/session-authority.mjs` |
| Where is same-Scene Hierarchy synchronization implemented? | `Editor/HierarchySync/TeamForgeHierarchySyncService.cs` | `server/src/hierarchy-model.mjs`, `server/src/session-authority.mjs` |
| How does Project bootstrap / direct transfer work? | [project-peer/README.md](project-peer/README.md) | Host/Guest orchestrators, direct transfer client/server, content store |
| Where is signed Project coordination handled? | [server/README.md](server/README.md) | `server/src/project-coordinator-core.mjs`, `project-peer/src/coordinator-client.mjs` |
| How does the Windows Guest Launcher work? | [launcher/README.md](launcher/README.md) | `MainWindow.xaml.cs`, Launcher Core policy classes, Guest orchestrator |
| Where are diagnostics / recovery implemented? | [launcher/README.md](launcher/README.md) | `DiagnosticsRecovery.cs`, `TeamForgeRecoveryUx.cs`, `guest-orchestrator.mjs` |
| Where is Windows path resilience implemented? | [launcher/README.md](launcher/README.md) | `PathResilience.cs`, `ExecutionAliasManager.cs`, `path-resilience-contract.json` |
| How do I validate a fresh source clone? | [docs/SOURCE.md](docs/SOURCE.md) | `scripts/validate-public-source.mjs`, `npm run validate`, current CI |
| How do I validate a staged release tree? | [docs/SOURCE.md](docs/SOURCE.md), [builds/README.md](builds/README.md) | `scripts/validate-repository.mjs`, `npm run validate:release` |
| Where should a security review start? | [.github/SECURITY.md](.github/SECURITY.md), [docs/architecture.md](docs/architecture.md) | filesystem/invite/runtime/environment/path trust-boundary code |
| Where are tests? | [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) | Unity `Tests/`, `server/test/`, `project-peer/test/`, `launcher/test/`, `launcher/tests/` |

## Runtime topology

```text
Unity Editor package
  ├─ Realtime Protocol v1 over WebSocket ──> TeamForge Server
  │                                           ├─ Session Authority
  │                                           └─ Project Coordinator metadata
  │
  └─ Host bridge ──> Project Peer Seed

Windows Guest Launcher
  └─ Guest bridge ──> Project Peer client ── direct HTTP Project payload ──> Host Seed
```

Project payload bytes do not pass through the TeamForge Server. See **[docs/architecture.md](docs/architecture.md)** for the authoritative topology and trust-boundary description.

## Unity Editor package

Root: `unity-package/com.eunsung.teamforge/`

Primary responsibilities: Editor-facing collaboration UI, connection lifecycle, observed authority state, Presence, Transform/Lock behavior, supported same-Scene Hierarchy collaboration, and Host-side UX/orchestration.

Key entry points:

- `Editor/UI/TeamForgeWindow.cs` — primary Collaboration window
- `Editor/UX/TeamForgeHomeWindow.cs` — guided UX entry surface
- `Editor/Connection/TeamForgeConnectionService.cs` — connection lifecycle, handshake/routing, reconnect/backoff, main-thread dispatch
- `Editor/Authority/TeamForgeAuthorityView.cs` — client-side observed authority state
- `Editor/Presence/TeamForgePresenceService.cs` — connected-user / selection / Scene awareness
- `Editor/TransformSync/TeamForgeTransformSyncService.cs` — Transform observation/application and lock/revision interaction
- `Editor/HierarchySync/TeamForgeHierarchySyncService.cs` — supported same-Scene structural synchronization and identity checks
- `Editor/UX/TeamForgeRecoveryUx.cs` — Unity-side diagnostics/recovery presentation
- `Tests/` — Unity Editor regression/contract tests

Before changing identity, revision, lock or reconnect semantics, read the corresponding Server authority code and [docs/architecture.md](docs/architecture.md).

## Realtime / coordination server

Root: `server/`

Primary responsibilities: authenticated HTTP/WebSocket hosting, in-memory Session Authority, and signed Project metadata coordination. The server is **not** the Project payload store or relay.

Key files:

- `src/index.mjs` — process startup/shutdown and composition
- `src/teamforge-server.mjs` — HTTP/WebSocket shell, timers and authority/coordinator effect execution
- `src/session-authority.mjs` — Presence, revision, locks, Transform, Hierarchy and tombstone authority
- `src/hierarchy-model.mjs` — Hierarchy state validation and operation preparation
- `src/project-coordinator-core.mjs` — Project/Owner/Publisher/Baseline/Peer coordination state
- `src/project-coordinator.mjs` — wrapper around the coordinator core
- `src/protocol.mjs` — server-side protocol constants/helpers
- `src/config.mjs` — environment/config parsing and bounds
- `test/` — server/authority/protocol tests

## Project Peer / direct Project transfer

Root: `project-peer/`

Primary responsibilities: bootstrap contracts, Host/Guest orchestration, direct HTTP Project transfer, manifest/chunk integrity, staging, activation, trust and Project filesystem safety.

Key files:

- `src/host-orchestrator-cli.mjs` — Unity-facing Host bridge dispatch
- `src/host-orchestrator.mjs` — Host orchestration behavior
- `src/guest-orchestrator-cli.mjs` — Launcher-facing Guest bridge dispatch
- `src/guest-orchestrator.mjs` — Guest receive/activation/recovery behavior
- `src/bootstrap-invite.mjs` — signed Collaboration Invite validation
- `src/coordinator-client.mjs` — signed metadata interaction with the TeamForge Server
- `src/direct-transfer-client.mjs` — Direct HTTP transfer-source adapter and error normalization
- `src/direct-transfer-server.mjs` — Direct HTTP descriptor/manifest/inventory/chunk source
- `src/content-store.mjs` — content-addressed local Project storage primitives
- `src/filesystem-safety.mjs` — canonical path / redirected-segment safety primitives
- `src/path-resilience-contract.json` — shared Windows/Unity path-risk contract
- `test/` — bootstrap/transfer/trust/recovery/path tests

Changes to invite validation, path handling, staging, activation, hashing or runtime execution are security-sensitive and should be reviewed as trust-boundary changes.

## Windows Guest Launcher

Root: `launcher/`

Primary responsibilities: user-facing Guest flow, verified bundled Runtime execution, managed destination/path handling, trust presentation and final Unity handoff.

Key files:

- `src/TeamForge.Launcher/MainWindow.xaml(.cs)` — WPF Guest UI and orchestration glue
- `src/TeamForge.Launcher/TrustDialog.xaml` — explicit Publisher/Project trust UI
- `src/TeamForge.Launcher.Core/BridgeClient.cs` — child bridge process / bounded NDJSON client
- `src/TeamForge.Launcher.Core/RuntimeLayout.cs` — Runtime manifest/layout/hash verification
- `src/TeamForge.Launcher.Core/EnvironmentPolicy.cs` — child-process environment policy
- `src/TeamForge.Launcher.Core/PathSafety.cs` — containment/reparse/path safety
- `src/TeamForge.Launcher.Core/PathResilience.cs` — path budget/capability/strategy routing
- `src/TeamForge.Launcher.Core/ExecutionAliasManager.cs` — TeamForge-owned execution alias creation/revalidation
- `src/TeamForge.Launcher.Core/DiagnosticsRecovery.cs` — stable recovery actions and bounded diagnostics
- `src/TeamForge.Launcher.Core/UnityLaunchPolicy.cs` — final Unity executable/project validation and process launch
- `runtime-loader.mjs` — bundled Runtime verification and Guest bridge import
- `test/`, `tests/` — Node and .NET Launcher tests

## Repository / release tooling

- `scripts/validate-public-source.mjs` — normal fresh-clone source/document/contract validation
- `scripts/validate-repository.mjs` — fully staged release-candidate validation
- `scripts/build-*`, `scripts/stage-*`, `scripts/verify-*` — packaging and release-support tooling
- `.github/workflows/` — source CI, Unity automation, dependency/security checks and release publication

Do not infer a physical field PASS from source/release-tooling automation. Current release effect belongs in [docs/STATUS.md](docs/STATUS.md).

## Reading rules

For an implementation task:

1. find the smallest relevant module here;
2. read its module README and nearest tests;
3. read [docs/architecture.md](docs/architecture.md) if the change crosses authority, identity, transport, persistence, path or trust boundaries;
4. read historical phase/work-state notes only when the history itself matters.

For source setup and validation commands, use **[docs/SOURCE.md](docs/SOURCE.md)** rather than this file.
