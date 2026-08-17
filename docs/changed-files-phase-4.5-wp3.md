# Phase 4.5 WP3 changed files

## Added

- `server/src/project-coordinator-core.mjs` — Project and Project-session registry commands, transitions and ordered effects.
- `server/test/project-coordinator-core.test.mjs` — five direct Core characterization tests.
- `docs/phase-4.5-wp3-project-coordinator-core-report.md` — WP3 research, boundary and verification report.
- `docs/changed-files-phase-4.5-wp3.md` — this inventory.

## Modified

- `server/src/teamforge-server.mjs` — compose Coordinator commands/effects with the existing WebSocket host; preserve aggregate health counts and lifecycle ordering.
- `server/src/session-authority.mjs` — remove the temporary Project member container and replace the Project-specific cleanup bridge with neutral `connection_superseded` lifecycle composition.
- `server/test/session-authority.test.mjs` — freeze the renamed neutral supersede effect in the existing ordered trace.
- `server/package.json` — include the Coordinator Core in syntax checks.
- `scripts/validate-repository.mjs` — require the Core/tests and enforce no host I/O, Project payload storage/relay, or direct host registry mutation.
- `docs/architecture.md` — record the WP3 Core/host boundary and bridge cleanup.
- `docs/project-state.md` — mark WP3 complete and WP4 not started.

No Unity source, Protocol v1 fixture, Project Transfer implementation, or `project-peer` product source was changed.
