# TeamForge code map

This map is a navigation aid for people and AI tools that need to move from a TeamForge question to the smallest relevant part of the repository.

> [!IMPORTANT]
> Use **[STATUS.md](docs/STATUS.md)** for current capability/release-readiness claims, [`release-contract.json`](release-contract.json) for exact current candidate/runtime identity, and [`builds/README.md`](builds/README.md) plus the exact Release SHA-256 for byte-level packaged artifact identity. This file explains where code lives; it does not make every historical or experimental path current.

Current source contract: product `0.5.1`, release ID `0.5.1-wp5.1-path-resilience`, state **FIELD BLOCKED**.

## Start here by question

| Question | Read first | Then inspect |
| --- | --- | --- |
| What is TeamForge and what is actually ready? | [README.md](README.md), [STATUS.md](docs/STATUS.md) | [release-contract.json](release-contract.json), [CHANGELOG.md](CHANGELOG.md), [ROADMAP.md](docs/ROADMAP.md) |
| What exact current candidate/runtime is this? | [release-contract.json](release-contract.json) | [builds/README.md](builds/README.md), [STATUS.md](docs/STATUS.md) |
| What exact packaged ZIP/build do I have? | [builds/README.md](builds/README.md) | exact GitHub Release asset filename + SHA-256; product version alone is insufficient |
| How do the main processes fit together? | [docs/architecture.md](docs/architecture.md) | [docs/architecture-decisions.md](docs/architecture-decisions.md) |
| How does Unity connect to the realtime server? | [Unity package README](unity-package/com.eunsung.teamforge/README.md) | [TeamForgeConnectionService.cs](unity-package/com.eunsung.teamforge/Editor/Connection/TeamForgeConnectionService.cs), [server/src/index.mjs](server/src/index.mjs), [server/src/teamforge-server.mjs](server/src/teamforge-server.mjs) |
| Where is Presence implemented? | [TeamForgePresenceService.cs](unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgePresenceService.cs) | [server/src/session-authority.mjs](server/src/session-authority.mjs) |
| Where is Transform/Lock synchronization implemented? | [TeamForgeTransformSyncService.cs](unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs) | [TeamForgeAuthorityView.cs](unity-package/com.eunsung.teamforge/Editor/Authority/TeamForgeAuthorityView.cs), [server/src/session-authority.mjs](server/src/session-authority.mjs) |
| Where is same-Scene Hierarchy synchronization implemented? | [TeamForgeHierarchySyncService.cs](unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchySyncService.cs) | [server/src/hierarchy-model.mjs](server/src/hierarchy-model.mjs), [server/src/session-authority.mjs](server/src/session-authority.mjs) |
| How does project bootstrap / direct P2P transfer work? | [project-peer/README.md](project-peer/README.md) | [host-orchestrator-cli.mjs](project-peer/src/host-orchestrator-cli.mjs), [guest-orchestrator-cli.mjs](project-peer/src/guest-orchestrator-cli.mjs), [direct-transfer-client.mjs](project-peer/src/direct-transfer-client.mjs), [direct-transfer-server.mjs](project-peer/src/direct-transfer-server.mjs) |
| Where is signed project coordination handled? | [server/README.md](server/README.md) | [project-coordinator-core.mjs](server/src/project-coordinator-core.mjs), [project-coordinator.mjs](server/src/project-coordinator.mjs), [project-peer coordinator client](project-peer/src/coordinator-client.mjs) |
| How does the Windows Guest Launcher work? | [launcher/README.md](launcher/README.md) | [MainWindow.xaml.cs](launcher/src/TeamForge.Launcher/MainWindow.xaml.cs), [BridgeClient.cs](launcher/src/TeamForge.Launcher.Core/BridgeClient.cs), [RuntimeLayout.cs](launcher/src/TeamForge.Launcher.Core/RuntimeLayout.cs), [UnityLaunchPolicy.cs](launcher/src/TeamForge.Launcher.Core/UnityLaunchPolicy.cs) |
| Where is WP5 diagnostics/recovery implemented? | [launcher/README.md](launcher/README.md) | [DiagnosticsRecovery.cs](launcher/src/TeamForge.Launcher.Core/DiagnosticsRecovery.cs), [TeamForgeRecoveryUx.cs](unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRecoveryUx.cs), [guest-orchestrator.mjs](project-peer/src/guest-orchestrator.mjs), [wp5-diagnostics-recovery.test.mjs](project-peer/test/wp5-diagnostics-recovery.test.mjs) |
| Where is WP5.1 Windows path resilience implemented? | [launcher/README.md](launcher/README.md) | [PathResilience.cs](launcher/src/TeamForge.Launcher.Core/PathResilience.cs), [ExecutionAliasManager.cs](launcher/src/TeamForge.Launcher.Core/ExecutionAliasManager.cs), [path-resilience-contract.json](project-peer/src/path-resilience-contract.json), [wp51-path-resilience-static.test.mjs](project-peer/test/wp51-path-resilience-static.test.mjs) |
| How do I validate a fresh public source clone? | [docs/SOURCE.md](docs/SOURCE.md) | [validate-public-source.mjs](scripts/validate-public-source.mjs), `npm run validate`, current CI |
| How do I validate a fully staged release candidate? | [docs/SOURCE.md](docs/SOURCE.md), [builds/README.md](builds/README.md) | [validate-repository.mjs](scripts/validate-repository.mjs), `npm run validate:release`; generated Runtime/Launcher/release evidence is expected |
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

The normal packaged Host/Guest path uses a manifest-pinned bundled Runtime; system Node/npm and the Project Peer CLI are source-development/advanced-diagnostics paths rather than the normal fresh-Guest UX. `P2P` means direct Project Peer payload transfer and does not imply automatic discovery, NAT traversal, or relay.

For the current as-built dependency map and authority boundaries, use **[docs/architecture.md](docs/architecture.md)**.

## Module map

### `unity-package/com.eunsung.teamforge/`

Unity 6.3 LTS Editor package. It owns the Editor-facing collaboration experience and client-side realtime behavior.

Key entry points and responsibilities:

- [Editor/UI/TeamForgeWindow.cs](unity-package/com.eunsung.teamforge/Editor/UI/TeamForgeWindow.cs) — primary TeamForge Editor window and collaboration UI surface.
- [Editor/UX/TeamForgeHomeWindow.cs](unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHomeWindow.cs) — guided home/UX entry surface.
- [Editor/Connection/TeamForgeConnectionService.cs](unity-package/com.eunsung.teamforge/Editor/Connection/TeamForgeConnectionService.cs) — connection lifecycle, handshake/routing, reconnect/backoff, and main-thread message dispatch.
- [Editor/Authority/TeamForgeAuthorityView.cs](unity-package/com.eunsung.teamforge/Editor/Authority/TeamForgeAuthorityView.cs) — client-side observed authority state shared by collaboration services.
- [Editor/Presence/TeamForgePresenceService.cs](unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgePresenceService.cs) — connected-user/selection presence sampling and application.
- [Editor/TransformSync/TeamForgeTransformSyncService.cs](unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs) — Transform synchronization and compatibility lock/revision view.
- [Editor/HierarchySync/TeamForgeHierarchySyncService.cs](unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchySyncService.cs) — supported same-Scene hierarchy observation/application and identity checks.
- [Editor/UX/TeamForgeRecoveryUx.cs](unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeRecoveryUx.cs) — Unity-side stable recovery/diagnostics presentation.
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
- [src/guest-orchestrator.mjs](project-peer/src/guest-orchestrator.mjs) — Guest orchestration state, diagnostics and receive/activation behavior.
- [src/cli.mjs](project-peer/src/cli.mjs) — advanced/developer CLI for publish/seed/sync and diagnostics; not the normal fresh-Guest UI path.
- [src/bootstrap-invite.mjs](project-peer/src/bootstrap-invite.mjs) — Collaboration Invite / bootstrap envelope validation and related trust rules.
- [src/coordinator-client.mjs](project-peer/src/coordinator-client.mjs) — client for signed metadata coordination with the TeamForge Server.
- [src/direct-transfer-server.mjs](project-peer/src/direct-transfer-server.mjs) — direct HTTP seed/source implementation.
- [src/direct-transfer-client.mjs](project-peer/src/direct-transfer-client.mjs) — direct HTTP transfer-source adapter and transport error normalization.
- [src/content-store.mjs](project-peer/src/content-store.mjs) — local content-addressed project data storage primitives.
- [src/filesystem-safety.mjs](project-peer/src/filesystem-safety.mjs) — path/filesystem safety checks used by transfer/activation flows.
- [src/path-resilience-contract.json](project-peer/src/path-resilience-contract.json) — shared WP5.1 Windows/Unity path-risk and package-cache headroom contract.
- `test/` — Project Peer tests and protocol/transfer/recovery/path regression coverage.

See [project-peer/README.md](project-peer/README.md) for the supported Host/Guest contracts.

### `launcher/`

Windows x64 standalone Guest Launcher source. The WPF UI drives a verified bundled runtime in a packaged candidate, then launches only a revalidated Unity project handoff. The generated `launcher/win-x64/` release directory is intentionally absent from a normal public source checkout.

Key files:

- [src/TeamForge.Launcher/MainWindow.xaml](launcher/src/TeamForge.Launcher/MainWindow.xaml) and [MainWindow.xaml.cs](launcher/src/TeamForge.Launcher/MainWindow.xaml.cs) — primary Guest UI and orchestration glue.
- [src/TeamForge.Launcher/TrustDialog.xaml](launcher/src/TeamForge.Launcher/TrustDialog.xaml) — explicit Publisher/Project trust UI.
- [src/TeamForge.Launcher.Core/BridgeClient.cs](launcher/src/TeamForge.Launcher.Core/BridgeClient.cs) — bounded bridge process/NDJSON client logic.
- [src/TeamForge.Launcher.Core/RuntimeLayout.cs](launcher/src/TeamForge.Launcher.Core/RuntimeLayout.cs) — bundled runtime layout and integrity verification.
- [src/TeamForge.Launcher.Core/EnvironmentPolicy.cs](launcher/src/TeamForge.Launcher.Core/EnvironmentPolicy.cs) — environment scrubbing/policy for child runtime execution.
- [src/TeamForge.Launcher.Core/PathSafety.cs](launcher/src/TeamForge.Launcher.Core/PathSafety.cs) — launcher-side path safety rules.
- [src/TeamForge.Launcher.Core/DiagnosticsRecovery.cs](launcher/src/TeamForge.Launcher.Core/DiagnosticsRecovery.cs) — WP5 stable recovery actions and bounded secret-redacted current-run diagnostics.
- [src/TeamForge.Launcher.Core/PathResilience.cs](launcher/src/TeamForge.Launcher.Core/PathResilience.cs) — WP5.1 path capability/budget/strategy routing.
- [src/TeamForge.Launcher.Core/ExecutionAliasManager.cs](launcher/src/TeamForge.Launcher.Core/ExecutionAliasManager.cs) — TeamForge-owned Windows execution junction creation and immediate pre-launch identity/target revalidation.
- [src/TeamForge.Launcher.Core/UnityLaunchPolicy.cs](launcher/src/TeamForge.Launcher.Core/UnityLaunchPolicy.cs) — final Unity executable/project validation and safe launch policy.
- [runtime-loader.mjs](launcher/runtime-loader.mjs) — verifies and launches the manifest-pinned Node backend runtime.
- `test/` and `tests/` — runtime-loader and .NET launcher tests.

See [launcher/README.md](launcher/README.md) for the source-vs-packaged layout, path-resilience and release constraints.

### `docs/`

Current architecture/status/contracts plus historical validation/phase/engineering records.

- [STATUS.md](docs/STATUS.md) — current capability/readiness source of truth.
- [architecture.md](docs/architecture.md) — current as-built topology, layer boundaries and dependency invariants.
- [architecture-decisions.md](docs/architecture-decisions.md) — current and historical technical decisions with explicit supersession notes.
- [project-state.md](docs/project-state.md), [known-issues.md](docs/known-issues.md), [compatibility.md](docs/compatibility.md), [deployment.md](docs/deployment.md) — current candidate engineering/compatibility/deployment context.
- [SOURCE.md](docs/SOURCE.md) — source-tree overview, fresh-clone validation and review entry point.
- `phases/` — milestone/phase history.
- `work-state/` — raw historical engineering notes; these can be superseded and should not override current source/status/contracts.

### `scripts/`

Source validation, staged-release validation, packaging/runtime-bundle, test and release-support scripts.

- [validate-public-source.mjs](scripts/validate-public-source.mjs) — normal public source/document/release-contract consistency; generated release binaries/evidence are not required.
- [validate-repository.mjs](scripts/validate-repository.mjs) — strict fully staged release-candidate validation; expects generated Runtime/Launcher/release evidence.
- `build-*`, `stage-*`, `verify-*` release tooling — treat release generation and verification as part of the packaged-artifact trust boundary.

## Reading order for an AI coding/review task

1. Read [STATUS.md](docs/STATUS.md) to establish what is current and what is still blocked.
2. Read [release-contract.json](release-contract.json) when exact current candidate/runtime/protocol identity matters.
3. Read this `CODEMAP.md` to find the smallest relevant module/files.
4. Read the module README before changing behavior.
5. Read [docs/architecture.md](docs/architecture.md) and relevant **non-superseded** architecture decisions before changing authority, identity, transport, trust or persistence boundaries.
6. Inspect tests beside the target module before proposing a change.
7. Use `docs/work-state/` only as historical context when current documentation is insufficient.

## Canonicality rules

- **Current implementation:** current source and the nearest relevant tests.
- **Current capability/readiness:** `docs/STATUS.md`.
- **Exact current candidate/runtime/protocol identity:** `release-contract.json`.
- **Exact packaged artifact identity:** `builds/README.md` + exact Release filename/SHA-256.
- **Current module contract:** module README.
- **Current architecture:** `docs/architecture.md`; use only non-superseded parts of `docs/architecture-decisions.md` as current constraints.
- **Public source validation:** `scripts/validate-public-source.mjs` / `npm run validate`.
- **Staged release validation:** `scripts/validate-repository.mjs` / `npm run validate:release`.
- **Version history:** `CHANGELOG.md` plus the package changelog.
- **Plans:** `docs/ROADMAP.md`; roadmap items are not implemented facts.
- **Historical debugging/evidence:** `docs/work-state/`, Phase/work-package reports; never treat these as current without cross-checking.
