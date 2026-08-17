# UX Bootstrap WP2 changed files

Date: 2026-08-13 KST

## Added

- `server/src/lifecycle-child.mjs` — authenticated Coordinator child control plane.
- `project-peer/src/process-lifecycle.mjs` — ownership-safe Coordinator and Direct Seed lifecycle manager.
- `project-peer/test/process-lifecycle.test.mjs` — compatible/unknown/incompatible reuse, ownership refusal, identity, and actual graceful-stop tests.
- `docs/ux-bootstrap-wp2-lifecycle-manager-report.md` — implementation, platform-source, safety, evidence, and limitation report.
- `docs/changed-files-ux-bootstrap-wp2.md` — this inventory.

## Modified

- `server/package.json` — includes the lifecycle child in the existing syntax check.
- `server/src/teamforge-server.mjs` — exposes bounded compatible health identity and optional owned lifecycle instance identity.
- `project-peer/README.md` — documents the WP2 programmatic lifecycle boundary.
- `project-peer/src/cli.mjs` — preserves normal signal behavior and adds authenticated lifecycle status/stop for an orchestrator-owned Seed child.
- `project-peer/src/orchestrator-contract.mjs` — maps WP2 port, identity, authentication, and start failures into the frozen WP0 failure model.
- `project-peer/test/orchestrator-contract.test.mjs` — freezes the new failure mappings.
- `scripts/validate-repository.mjs` — validates the WP2 file set and safety boundary.

## Deleted

- None.

## Product areas intentionally unchanged

- Unity C# runtime/editor/test files.
- Realtime Protocol, Project Transfer, manifest, chunk, Sync, trust, staging, activation, and Authority implementations.
- Existing CLI commands, output behavior outside lifecycle-child mode, and confirmation requirements.
- Server/Seed payload topology: Project payload remains direct-only and is never relayed through the Coordinator.

## Evidence boundary

- Focused working-tree lifecycle evidence is recorded in `docs/ux-bootstrap-wp2-lifecycle-manager-report.md`.
- Full regression and fresh archive verification are recorded separately after those commands execute.
- Unity, macOS, Linux, and multi-machine checks remain explicitly **NOT RUN** unless separately executed and recorded.
