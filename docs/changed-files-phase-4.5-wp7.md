# TeamForge Phase 4.5 WP7 Changed Files

Date: 2026-08-11 (Asia/Seoul)

## Added

- `server/src/policy-profile.mjs` — immutable Server `ConnectionPolicy` and named `TeamForgeProfile` legacy defaults.
- `server/test/policy-profile.test.mjs` — default snapshot, immutability, environment override and credential-boundary parity.
- `project-peer/src/policy-profile.mjs` — immutable `ConnectionPolicy`, `TransferPolicy`, `TrustRequirements` and `TeamForgeProfile` values.
- `project-peer/test/policy-profile.test.mjs` — default/override snapshot and no-trust-disable-flag parity.
- `unity-package/com.eunsung.teamforge/Editor/Settings/TeamForgeProfile.cs` and `.meta` — transient get-only Unity value snapshots resolved from the unchanged settings singleton.
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgePolicyProfileTests.cs` and `.meta` — Unity legacy value/schema/trust surface tests.
- `docs/phase-4.5-wp7-policy-profile-report.md` — scope, research, values, invariants, parity, evidence and risks.
- `docs/changed-files-phase-4.5-wp7.md` — this list.

## Modified

- `server/src/config.mjs` — resolve validated environment behavior into the legacy profile, then preserve the exact historical config surface; keep auth credential outside policy.
- `server/package.json` — include config and policy modules in syntax checks.
- `project-peer/src/cli.mjs` — source existing endpoint/path/bind/concurrency/retry defaults from the legacy profile without changing parser or precedence.
- `project-peer/src/coordinator-client.mjs` — source existing realtime path and timeout defaults from the legacy profile.
- `project-peer/src/direct-transfer-client.mjs` — source existing timeout/JSON/Chunk defaults from `TransferPolicy`.
- `project-peer/src/direct-transfer-server.mjs` — source existing bind/path/request/rate/upload defaults from `TransferPolicy`.
- `project-peer/src/swarm-downloader.mjs` — source existing concurrency/timeout/retry/jitter/pacing defaults from `TransferPolicy`.
- `project-peer/src/project-peer.mjs` — source existing Seed reconnect, bind, Swarm and upload defaults from the legacy profile.
- `unity-package/com.eunsung.teamforge/Editor/Connection/TeamForgeConnectionService.cs` — consume transient resolved connection values while preserving public/static and lifecycle behavior.
- `unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgePresenceService.cs` — consume resolved Presence cadence values.
- `unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs` — consume resolved Transform and Lock-renewal values.
- `scripts/validate-repository.mjs` — require and statically freeze the WP7 value objects, tests, report and no-safety-disable boundary.
- `docs/architecture.md` — record the WP7 resolution boundary.
- `docs/project-state.md` — mark WP7 complete without starting WP8.

No serialized Unity settings field, user-facing Settings UI, CLI command/option, environment variable, package dependency/version, Protocol v1/Project Transfer v1 schema, fixture, hard safety rule, transport, route or tuning value was added or changed.
