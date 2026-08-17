# TeamForge v0.5.0 Changed Files

Compared against frozen Phase 3 closure `stageA-final-fresh`.

## Summary

- Added: 19
- Modified: 46
- Deleted: 0
- Current source inventory: 204 files (generated/cache directories excluded).

## Added

- `docs/changed-files-v0.5.0.md`
- `docs/known-issues-v0.5.0.md`
- `docs/phase-4-v0.5.0-implementation-report.md`
- `docs/phase-4-v0.5.0-manual-test-checklist.md`
- `docs/phase-4-v0.5.0-test-report.md`
- `docs/phases/phase-4.md`
- `docs/rollback-v0.5.0.md`
- `docs/work-state/PHASE4_SESSION.md`
- `server/src/hierarchy-model.mjs`
- `server/test/hierarchy-model.test.mjs`
- `unity-package/com.eunsung.teamforge/Editor/HierarchySync.meta`
- `unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchyIdentityRegistry.cs`
- `unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchyIdentityRegistry.cs.meta`
- `unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchyModel.cs`
- `unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchyModel.cs.meta`
- `unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchySyncService.cs`
- `unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchySyncService.cs.meta`
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeHierarchyModelTests.cs`
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeHierarchyModelTests.cs.meta`

## Modified

- `README.md`
- `docs/architecture-decisions.md`
- `docs/compatibility.md`
- `docs/deployment.md`
- `docs/known-issues.md`
- `docs/project-state.md`
- `docs/protocol-v1.md`
- `docs/roadmap.md`
- `docs/work-state/CURRENT_STATE.md`
- `docs/work-state/DECISIONS.md`
- `docs/work-state/NEXT_SESSION.md`
- `docs/work-state/PROJECT_CONTEXT.md`
- `docs/work-state/TEST_EVIDENCE.md`
- `package-lock.json`
- `package.json`
- `project-peer/README.md`
- `project-peer/package-lock.json`
- `project-peer/package.json`
- `project-peer/src/cli.mjs`
- `project-peer/src/constants.mjs`
- `project-peer/test/project-engine.test.mjs`
- `project-peer/test/project-transfer-integration.test.mjs`
- `scripts/validate-repository.mjs`
- `server/README.md`
- `server/compose.yaml`
- `server/package-lock.json`
- `server/package.json`
- `server/src/config.mjs`
- `server/src/project-coordinator.mjs`
- `server/src/protocol.mjs`
- `server/src/teamforge-server.mjs`
- `server/test/project-coordinator.test.mjs`
- `server/test/server.test.mjs`
- `unity-package/com.eunsung.teamforge/CHANGELOG.md`
- `unity-package/com.eunsung.teamforge/Documentation~/index.md`
- `unity-package/com.eunsung.teamforge/Editor/Connection/TeamForgeConnectionService.cs`
- `unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgeObjectIdentity.cs`
- `unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgePresenceService.cs`
- `unity-package/com.eunsung.teamforge/Editor/ProjectTransfer/TeamForgeProjectModel.cs`
- `unity-package/com.eunsung.teamforge/Editor/Protocol/TeamForgeProtocol.cs`
- `unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformModel.cs`
- `unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs`
- `unity-package/com.eunsung.teamforge/Editor/UI/TeamForgeWindow.cs`
- `unity-package/com.eunsung.teamforge/README.md`
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeEditorSurfaceTests.cs`
- `unity-package/com.eunsung.teamforge/package.json`

## Deleted

- None

## Rollback boundary

Treat Server hierarchy model/host/config/tests, Unity protocol/hierarchy/transform/presence/UI/tests, validator, product version files and Phase 4 docs as one candidate set. Do not partially mix them with the Phase 3 closure.
