# TeamForge Phase 4.5 WP6 Changed Files

Date: 2026-08-11 (Asia/Seoul)

## Added

- `project-peer/src/transfer-source.mjs` — structural descriptor/manifest/inventory/chunk contract, structural assertion, normalized source-error boundary, and shared retry-hint bound.
- `project-peer/test/transfer-source-contract.test.mjs` — the same contract, verified Resume, and expected-size/SHA-256 conformance matrix for a fake source and Direct HTTP source; stable-backend registration assertion.
- `docs/phase-4.5-wp6-transfer-source-report.md` — WP6 scope, research, responsibility/error boundaries, evidence, risks and candidate handoff.
- `docs/changed-files-phase-4.5-wp6.md` — this list.

## Modified

- `project-peer/src/direct-transfer-client.mjs` — make the existing Direct HTTP client the explicit contract adapter and attach normalized source-error metadata while preserving legacy error codes/details and retry classification.
- `project-peer/src/swarm-downloader.mjs` — consume the source contract and normalized error view instead of inspecting HTTP-derived error details; retain Swarm/Resume/Hash/retry behavior.
- `project-peer/src/project-peer.mjs` — register `ProjectPeerEngine` as the stable backend with exactly one real source adapter and expose the additive contract surface.
- `project-peer/README.md` — document the WP6 boundary and unchanged CLI/backend topology.
- `scripts/validate-repository.mjs` — freeze the new source boundary, stable adapter registration, common conformance tests, normalized Core dependency, and forbidden-route scope.
- `docs/architecture.md` — record the WP6 Transfer Source/Core/adapter responsibility split.
- `docs/project-state.md` — mark WP6 complete, preserve WP5 field evidence provenance, and state the WP7-not-started boundary.

No Unity C# product source, Server source, Protocol v1/Project Transfer v1 schema or fixture, Manifest/Invite/Descriptor schema, CLI/launch-settings source, transfer route, activation implementation, package version or dependency was changed.
