# UX Bootstrap WP0 changed files

Date: 2026-08-13 KST

Product behavior changes: none. The orchestration seam is not imported by the CLI, Server, or Unity package.

## Added

- `docs/ux-bootstrap-wp0-current-flow-audit.md`
  - Current Server/Publish/Seed/Invite/Sync/Active Open audit
  - dependency, managed-root, launch-settings, port/process, and platform findings
  - frozen Orchestrator API/state/failure contract
  - UX requirements, non-goals, tests, limitations, and official references
- `docs/changed-files-ux-bootstrap-wp0.md`
  - this change inventory
- `project-peer/src/orchestrator-contract.mjs`
  - inactive API v1 state/operation/failure classification seam
- `project-peer/test/orchestrator-contract.test.mjs`
  - verifies confirmation and owned-process safety boundaries plus field failure classification

## Updated

- `scripts/validate-repository.mjs`
  - includes the four WP0 files in the expected clean archive count and required file set

## Explicitly unchanged

- Server/Coordinator runtime
- Project Peer CLI and transfer engine
- Unity package/runtime UI
- Protocol, Transfer, Authority, trust, hash, staging, Active, and atomic pointer behavior
- package manifests, lockfiles, and version `0.5.0`

