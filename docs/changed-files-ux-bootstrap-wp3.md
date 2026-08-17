# UX Bootstrap WP3 changed files

Date: 2026-08-13 KST

## Added

- `project-peer/src/publication-plan.mjs` — deterministic public review projection and exact review fingerprint.
- `project-peer/src/host-orchestrator.mjs` — WP0 Host operations composed from WP1 preflight, existing publication/invite cores, and WP2 lifecycle manager.
- `project-peer/src/host-orchestrator-cli.mjs` — dependency-free-starting local newline-JSON Unity bridge with lazy Host import.
- `project-peer/test/host-orchestrator.test.mjs` — actual first Host commit and source-change re-review enforcement.
- `unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostFlow.cs` plus `.meta` — Unity save/review/commit/ready/copy/save/stop adapter.
- `docs/ux-bootstrap-wp3-one-click-host-report.md` — implementation, official-source decisions, evidence, and limits.
- `docs/changed-files-ux-bootstrap-wp3.md` — this inventory.

## Modified

- `project-peer/src/cli.mjs` — retains normal confirmation and adds authenticated exact-fingerprint Publish confirmation/readiness when it is a WP2-owned child.
- `project-peer/src/process-lifecycle.mjs` — adds `ensurePublishingSeed`, using the same WP2 ownership records, child IPC, identity proof, and stop path.
- `project-peer/README.md` — documents WP3 Host behavior and boundaries.
- `unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHomeWindow.cs` — routes Start Collaboration to WP3 and exposes Host status plus Copy/Save/Stop actions.
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeUxTests.cs` — adds Host state and pre-ready invite refusal tests.
- `scripts/validate-repository.mjs` — validates the WP3 file set, test count, bridge/bootstrap separation, lifecycle reuse, confirmation, UI, and non-goal boundary.

## Deleted

- None.

## Intentionally unchanged

- Server implementation and tests.
- Unity realtime Connection, Protocol, Authority, Hierarchy, Transform, Presence, Project registry, and transfer-validation implementations.
- Project Peer Descriptor, Manifest, Chunk, Transfer, Sync, trust, staging, activation, and Coordinator protocol implementations.
- Existing CLI command names and Advanced/debug availability.

## Evidence boundary

- Executed working-tree evidence and the Unity license blocker are recorded in the WP3 report.
- Fresh archive verification is recorded separately after execution.
- No unexecuted Unity, field, macOS, or Linux check is labelled PASS.

## WP3 registry re-arm hotfix

Modified within the existing WP3 file set:

- `project-peer/src/host-orchestrator.mjs` — inspects the verified Coordinator snapshot, re-arms an empty registry only through WP2 `ensureSeed` with the exact locally approved signed Baseline, and branches changed versus no-change Host commits.
- `project-peer/src/publication-plan.mjs` — binds the publish-versus-existing-Baseline Host mode into the review fingerprint and exposes the bounded `reuseExistingBaseline` review flag.
- `project-peer/test/host-orchestrator.test.mjs` — reproduces a stopped revision-2 Coordinator, verifies safe re-arm before revision 2 Publish, verifies no-op revision-2 resume without revision 3, and verifies source-change re-review for the resume branch.
- `unity-package/com.eunsung.teamforge/Editor/UX/TeamForgeHostFlow.cs` — presents `Start Existing Baseline` instead of claiming a new Publish when the saved source is unchanged.
- `project-peer/README.md`, `docs/ux-bootstrap-wp3-one-click-host-report.md`, and `scripts/validate-repository.mjs` — document and freeze the recovery boundary.

No Server, Project Peer core/Seed protocol, WP2 lifecycle ownership rule, CLI command, Protocol/Transfer/Authority implementation, or non-WP3 feature was reimplemented or weakened.
