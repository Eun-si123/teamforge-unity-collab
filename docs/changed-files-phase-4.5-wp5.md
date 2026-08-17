# Phase 4.5 WP5 changed files

## Added

- `unity-package/com.eunsung.teamforge/Editor/Connection/ConnectionStrategy.cs` — immutable realtime attempt, minimal `IConnectionStrategy`, and the one-attempt `LegacyServerStrategy`.
- `unity-package/com.eunsung.teamforge/Editor/Connection/ConnectionStrategy.cs.meta` — Unity asset identity for the strategy source.
- `unity-package/com.eunsung.teamforge/Editor/Transport/RealtimeTransportFactory.cs` — minimal `IRealtimeTransportFactory` and the existing ClientWebSocket adapter composition.
- `unity-package/com.eunsung.teamforge/Editor/Transport/RealtimeTransportFactory.cs.meta` — Unity asset identity for the factory source.
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeConnectionCompositionTests.cs` — characterization of the single route, configured factory and attempt-configured text transport contract.
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeConnectionCompositionTests.cs.meta` — Unity asset identity for the WP5 EditMode tests.
- `docs/phase-4.5-wp5-transport-strategy-report.md` — WP5 research, responsibility, parity, verification and risk report.
- `docs/changed-files-phase-4.5-wp5.md` — this inventory.

## Modified

- `unity-package/com.eunsung.teamforge/Editor/Connection/TeamForgeConnectionService.cs` — compose attempts through the Legacy Strategy and Factory while retaining the existing lifecycle/state/Protocol responsibilities.
- `unity-package/com.eunsung.teamforge/Editor/Transport/IRealtimeTransport.cs` — make `ConnectAsync` attempt-configured and cancellation-only; retain the reliable ordered text-channel events and send/disconnect contract.
- `unity-package/com.eunsung.teamforge/Editor/Transport/ClientWebSocketTransport.cs` — execute a factory-configured endpoint/socket while retaining send serialization, receive framing/limits, close and disposal behavior.
- `scripts/validate-repository.mjs` — freeze the single-route strategy/factory boundary and forbid direct adapter construction and WP5-prohibited route concepts.
- `docs/architecture.md` — record the WP5 composition boundary.
- `docs/project-state.md` — mark WP5 complete and WP6 not started; record WP4 field evidence provenance.

No Protocol v1/Project Transfer v1 schema or fixture, Server, `project-peer`, UI, settings, asmdef, Collaboration/Authority service or Project Transfer product source was changed.
