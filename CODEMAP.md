# TeamForge code map

This map is a navigation aid for people and AI tools that need to move from a TeamForge question to the smallest relevant part of the repository.

> [!IMPORTANT]
> Use **[STATUS.md](docs/STATUS.md)** for current capability and release-readiness claims. This file explains where code lives; it does not make every historical or experimental path current.

## Start here by question

| Question | Read first | Then inspect |
| --- | --- | --- |
| What is TeamForge and what is actually ready? | [README.md](README.md), [STATUS.md](docs/STATUS.md) | [CHANGELOG.md](CHANGELOG.md), [ROADMAP.md](docs/ROADMAP.md) |
| How do the main processes fit together? | [docs/architecture.md](docs/architecture.md) | [docs/architecture-decisions.md](docs/architecture-decisions.md) |
| How does Unity connect to the realtime server? | [Unity package README](unity-package/com.eunsung.teamforge/README.md) | [TeamForgeConnectionService.cs](unity-package/com.eunsung.teamforge/Editor/Connection/TeamForgeConnectionService.cs), [server/src/index.mjs](server/src/index.mjs), [server/src/teamforge-server.mjs](server/src/teamforge-server.mjs) |
| Where is Presence implemented? | [TeamForgePresenceService.cs](unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgePresenceService.cs) | [server/src/session-authority.mjs](server/src/session-authority.mjs) |
| Where is Transform/Lock synchronization implemented? | [TeamForgeTransformSyncService.cs](unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs) | [TeamForgeAuthorityView.cs](unity-package/com.eunsung.teamforge/Editor/Authority/TeamForgeAuthorityView.cs), [server/src/session-authority.mjs](server/src/session-authority.mjs) |
| Where is same-Scene Hierarchy synchronization implemented? | [TeamForgeHierarchySyncService.cs](unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchySyncService.cs) | [server/src/hierarchy-model.mjs](server/src/hierarchy-model.mjs), [server/src/session-authority.mjs](server/src/session-authority.mjs) |
| How does project bootstrap / P2P transfer work? | [project-peer/README.md](project-peer/README.md) | [host-orchestrator-cli.mjs](project-peer/src/host-orchestrator-cli.mjs), [guest-orchestrator-cli.mjs](project-peer/src/guest-orchestrator-cli.mjs), [direct-transfer-client.mjs](project-peer/src/direct-transfer-client.mjs), [direct-transfer-server.mjs](project-peer/src/direct-transfer-server.mjs) |
| Where is signed project coordination handled? | [server/README.md](server/README.md) | [project-coordinator-core.mjs](server/src/project-coordinator-core.mjs), [project-coordinator.mjs](server/src/project-coordinator.mjs), [project-peer coordinator client](project-peer/src/coordinator-client.mjs) |
| How does the Windows Guest Launcher work? | [launcher/README.md](launcher/README.md) | [MainWindow.xaml.cs](launcher/src/TeamForge.Launcher/MainWindow.xaml.cs), [BridgeClient.cs](launcher/src/TeamForge.Launcher.Core/BridgeClient.cs), [RuntimeLayout.cs](launcher/src/TeamForge.Launcher.Core/RuntimeLayout.cs), [UnityLaunchPolicy.cs](launcher/src/TeamForge.Launcher.Core/UnityLaunchPolicy.cs) |
| Where should I start a security review? | [SECURITY.md](.github/SECURITY.md) | [filesystem-safety.mjs](project-peer/src/filesystem-safety.mjs), [bootstrap-invite.mjs](project-peer/src/bootstrap-invite.mjs), [RuntimeLayout.cs](launcher/src/TeamForge.Launcher.Core/RuntimeLayout.cs), [EnvironmentPolicy.cs](launcher/src/TeamForge.Launcher.Core/EnvironmentPolicy.cs) |
| Where are tests? | [CONTRIBUTING.md](.github/CONTRIBUTING.md) | `unity-package/com.eunsung.teamforge/Tests/`, `server/test/`, `project-peer/test/`, `launcher/test/`, `launcher/tests/` |

## Runtime topology

The current implemented route is intentionally split:

```text
Unity Editor package
  ├─ Realtime Protocol v1 over WebSocket ──> TeamForge Server
  │                                           ├─ Session Authority
  │                                           └─ Project Coordinator metadata
  │
  └─ Host bridge ──> Project Peer seed

Windows Guest Launcher
  └─ Guest bridge ──> Project Peer client ── direct HTTP project payload ──> Host seed

Project payload bytes do not pass through the TeamForge Server.
```

For the as-built dependency map and authority boundaries, use **[docs/architecture.md](docs/architecture.md)**.

## Module map

### `unity-package/com.eunsung.teamforge/`

Unity 6.3 LTS Editor package. It owns the Editor-facing collaboration experience and client-side realtime behavior.

Key entry points and responsibilities:

- [Editor/UI/TeamForgeWindow.cs](unity-package/com.eunsung.teamforge/Editor/UI/TeamForgeWindow.cs) — primary TeamForge Editor window and collaboration UI surface.
- [Editor/UX/TeamForgeHomeWindow.cs](unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHomeWindow.cs) — newer home/UX entry surface used by the guided workflow.
- [Editor/Connection/TeamForgeConnectionService.cs](unity-package/com.eunsung.teamforge/Editor/Connection/TeamForgeConnectionService.cs) — connection lifecycle, handshake/routing, reconnect/backoff, and main-thread message dispatch.
- [Editor/Authority/TeamForgeAuthorityView.cs](unity-package/com.eunsung.teamforge/Editor/Authority/TeamForgeAuthorityView.cs) — client-side observed authority state shared by collaboration services.
- [Editor/Presence/TeamForgePresenceService.cs](unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgePresenceService.cs) — connected-user/selection presence sampling and application.
- [Editor/TransformSync/TeamForgeTransformSyncService.cs](unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs) — Transform synchronization and compatibility lock/revision view.
- [Editor/HierarchySync/TeamForgeHierarchySyncService.cs](unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchySyncService.cs) — supported same-Scene hierarchy observation/application and identity checks.
- `Editor/UX/` — Host/Guest workflow, runtime discovery, diagnostics, preflight, bootstrap and usability helpers.
- `Tests/` — Unity Editor tests for package behavior.

Read [the package README](unity-package/com.eunsung.teamforge/README.md) before assuming a source path is part of the recommended user workflow.

### `server/`

Node.js authoritative realtime coordinator. It handles health/authentication/WebSocket hosting plus in-memory session and project-coordination authority. It does **not** store or relay project payload bytes.

Key files:

- [src/index.mjs](server/src/index.mjs) — process entry point; loads environment configuration, starts/stops the server.
- [src/teamforge-server.mjs](server/src/teamforge-server.mjs) — HTTP/WebSocket host composition, protocol I/O, timers and effect execution.
- [src/session-authority.mjs](server/src/session-authority.mjs) — pure/in-memory authority for presence, revisions, locks, Transform, Hierarchy, tombstones and ordered effects.
- [src/hierarchy-model.mjs](server/src/hierarchy-model.mjs) — hierarchy state/model validation and transitions used by authority logic.
- [src/project-coordinator-core.mjs](server/src/project-coordinator-core.mjs) — project UUID/Owner/publisher/baseline/peer coordination state and effects.
- [src/project-coordinator.mjs](server/src/project-coordinator.mjs) — host-facing coordinator wrapper around the core.
- [src/protocol.mjs](server/src/protocol.mjs) — shared server-side protocol constants/helpers.
- [src/config.mjs](server/src/config.mjs) — environment/config parsing and bounds.
- `test/` — server tests.

See [server/README.md](server/README.md) for runtime scope and authentication assumptions.

### `project-peer/`

Direct Project Transfer v1 implementation and Host/Guest orchestration backend. It builds/verifies manifests and chunks, signs/validates bootstrap data, serves project bytes directly, and activates verified project revisions.

Key files:

- [src/host-orchestrator-cli.mjs](project-peer/src/host-orchestrator-cli.mjs) — bounded-NDJSON Host bridge used by Unity to inspect, plan, commit and stop Host operations.
- [src/guest-orchestrator-cli.mjs](project-peer/src/guest-orchestrator-cli.mjs) — Guest bridge used by the standalone Launcher for validation, receive, activation and handoff.
- [src/cli.mjs](project-peer/src/cli.mjs) — advanced/developer CLI for publish/seed/sync and diagnostics.
- [src/bootstrap-invite.mjs](project-peer/src/bootstrap-invite.mjs) — Collaboration Invite / bootstrap envelope validation and related trust rules.
- [src/coordinator-client.mjs](project-peer/src/coordinator-client.mjs) — client for signed metadata coordination with the TeamForge Server.
- [src/direct-transfer-server.mjs](project-peer/src/direct-transfer-server.mjs) — direct HTTP seed/source implementation.
- [src/direct-transfer-client.mjs](project-peer/src/direct-transfer-client.mjs) — direct HTTP transfer-source adapter and transport error normalization.
- [src/content-store.mjs](project-peer/src/content-store.mjs) — local content-addressed project data storage primitives.
- [src/filesystem-safety.mjs](project-peer/src/filesystem-safety.mjs) — path/filesystem safety checks used by transfer/activation flows.
- `test/` — Project Peer tests and protocol/transfer regression coverage.

See [project-peer/README.md](project-peer/README.md) for the supported Host/Guest contracts.

### `launcher/`

Windows x64 standalone Guest Launcher. The WPF UI drives a verified bundled runtime and Project Peer Guest bridge, then launches only a revalidated Unity project handoff.

Key files:

- [src/TeamForge.Launcher/MainWindow.xaml](launcher/src/TeamForge.Launcher/MainWindow.xaml) and [MainWindow.xaml.cs](launcher/src/TeamForge.Launcher/MainWindow.xaml.cs) — primary Guest UI and orchestration glue.
- [src/TeamForge.Launcher/TrustDialog.xaml](launcher/src/TeamForge.Launcher/TrustDialog.xaml) — explicit Publisher/Project trust UI.
- [src/TeamForge.Launcher.Core/BridgeClient.cs](launcher/src/TeamForge.Launcher.Core/BridgeClient.cs) — bounded bridge process/NDJSON client logic.
- [src/TeamForge.Launcher.Core/RuntimeLayout.cs](launcher/src/TeamForge.Launcher.Core/RuntimeLayout.cs) — bundled runtime layout and integrity verification.
- [src/TeamForge.Launcher.Core/EnvironmentPolicy.cs](launcher/src/TeamForge.Launcher.Core/EnvironmentPolicy.cs) — environment scrubbing/policy for child runtime execution.
- [src/TeamForge.Launcher.Core/PathSafety.cs](launcher/src/TeamForge.Launcher.Core/PathSafety.cs) — launcher-side path safety rules.
- [src/TeamForge.Launcher.Core/UnityLaunchPolicy.cs](launcher/src/TeamForge.Launcher.Core/UnityLaunchPolicy.cs) — final Unity executable/project validation and safe launch policy.
- [runtime-loader.mjs](launcher/runtime-loader.mjs) — verifies and launches the manifest-pinned Node backend runtime.
- `test/` and `tests/` — runtime-loader and .NET launcher tests.

See [launcher/README.md](launcher/README.md) for the trusted deployment layout and release constraints.

### `docs/`

Current architecture, decisions, validation reports, phase history and raw engineering records.

- [architecture.md](docs/architecture.md) — as-built topology, layer boundaries and dependency invariants.
- [architecture-decisions.md](docs/architecture-decisions.md) — important technical decisions/tradeoffs.
- [SOURCE.md](docs/SOURCE.md) — source-tree overview and review entry point.
- `phases/` — milestone/phase history.
- `work-state/` — raw historical engineering notes; these can be superseded and should not override current status/changelog.

### `scripts/`

Repository validation, packaging/runtime-bundle, test and release-support scripts. Treat release-generation scripts as part of the trust boundary when reviewing generated runtimes or packages.

## Reading order for an AI coding/review task

1. Read [STATUS.md](docs/STATUS.md) to establish what is current and what is still blocked.
2. Read this `CODEMAP.md` to find the smallest relevant module/files.
3. Read the module README before changing behavior.
4. Read [docs/architecture.md](docs/architecture.md) and relevant architecture decisions before changing authority, identity, transport, trust or persistence boundaries.
5. Inspect tests beside the target module before proposing a change.
6. Use `docs/work-state/` only as historical context when current documentation is insufficient.

## Canonicality rules

- **Current behavior/readiness:** `docs/STATUS.md`, module README, current source/tests.
- **Version history:** `CHANGELOG.md` plus the package changelog.
- **Architecture:** `docs/architecture.md` and `docs/architecture-decisions.md`.
- **Plans:** `docs/ROADMAP.md`; roadmap items are not implemented facts.
- **Historical debugging notes:** `docs/work-state/`; never treat these as current without cross-checking.
