# UX Bootstrap WP1 changed files

Date: 2026-08-13 KST

## Added

- `project-peer/src/url-policy.mjs` — dependency-free Coordinator URL validation shared by launch settings and the existing client.
- `project-peer/src/unified-preflight.mjs` — read-only unified inspection and explicit, locked, selective dependency repair.
- `project-peer/src/preflight-cli.mjs` — JSON CLI for `inspect` and `repair-dependencies`.
- `project-peer/test/unified-preflight.test.mjs` — runtime/dependency/path/managed-root/port/repair tests.
- `docs/ux-bootstrap-wp1-unified-preflight-report.md` — implementation, safety, source, evidence, and limitation report.
- `docs/changed-files-ux-bootstrap-wp1.md` — this inventory.

## Modified

- `package.json` — adds `preflight` and explicit `repair:dependencies` scripts; existing scripts remain.
- `package-lock.json` — records the added Project Peer preflight binary.
- `project-peer/package.json` — adds `teamforge-preflight` and a package-local preflight script; existing CLI binary remains.
- `project-peer/package-lock.json` — records the added binary.
- `project-peer/src/coordinator-client.mjs` — consumes/re-exports the extracted URL policy; WebSocket behavior is unchanged.
- `project-peer/src/launch-settings.mjs` — consumes the same extracted URL policy without importing `ws`.
- `project-peer/src/orchestrator-contract.mjs` — maps WP1 diagnostic codes into the frozen WP0 failure kinds/actions.
- `project-peer/test/orchestrator-contract.test.mjs` — freezes the added WP1 mappings.
- `project-peer/README.md` — documents WP1 commands and boundaries.
- `scripts/validate-repository.mjs` — validates the WP1 file set, CLI separation, and invariant boundary.

## Deleted

- None.

## Product areas intentionally unchanged

- All `server/src` and `server/test` files.
- All Unity C# runtime/editor/test files.
- Project Transfer, manifest, chunk, Sync, trust, activation, Direct Seed, and Authority implementations/tests.
- Existing `project-peer/src/cli.mjs` behavior and command surface.

## Final executed evidence

- Working tree: Server `72/72`, Project Peer `82/82`, focused WP1 `9/9`, validator `335` files, syntax checks, Server smoke, and Direct Transfer smoke all PASS.
- WP0 comparison: `6` added, `10` changed, `0` deleted; the list above is exact.
- Fresh archive evidence and SHA-256 values are written after immutable packaging to the separate output verification report.
- Unity and field checks remain NOT RUN as listed in the WP1 report.
