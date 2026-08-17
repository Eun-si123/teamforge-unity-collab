# Phase 4.5 WP8 Identity / Authority Audit Changed Files

Date: 2026-08-11 (Asia/Seoul)

Exact parity ledger: 25 changed/added paths, 0 deleted paths; candidate file count 319 versus input count 312.

## Unity product source

- `unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchyIdentityRegistry.cs`
- `unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgeObjectIdentity.cs`
- `unity-package/com.eunsung.teamforge/Editor/Presence/TeamForgePresenceService.cs`
- `unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformModel.cs`
- `unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs`
- `unity-package/com.eunsung.teamforge/Editor/HierarchySync/TeamForgeHierarchySyncService.cs`

These changes only enforce the shared saved/current-authority identity contract, connection identity epoch, cache invalidation and selected-Scene coherence. They do not add a feature, message or route.

## Unity tests

- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeIdentityAuthorityAuditTests.cs`
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeIdentityAuthorityAuditTests.cs.meta`
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeTransformModelTests.cs`
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeProjectProtocolTests.cs`

## Node characterization tests

- `server/test/project-coordinator-core.test.mjs`
- `server/test/session-authority.test.mjs`

No Server product/runtime source and no Project Peer source/test file changed.

## Validation and documents

- `scripts/validate-repository.mjs`
- `docs/architecture.md`
- `docs/roadmap.md`
- `docs/project-state.md`
- `docs/phase-4.5-closure-report.md`
- `docs/phase-4.5-field-closure-checklist.md`
- `docs/phase-4.5-rollback-reference.md`
- `docs/known-issues-v0.5.0.md`
- `docs/phase-4.5-wp8-identity-authority-audit-report.md`
- `docs/phase-4.5-wp8-identity-contract-matrix.md`
- `docs/phase-4.5-wp8-identity-authority-audit-test-evidence.md`
- `docs/phase-4.5-wp8-identity-authority-audit-field-checklist.md`
- `docs/changed-files-phase-4.5-wp8-identity-authority-audit.md`

## Explicitly unchanged

- all `server/src/` product/runtime files;
- all `project-peer/` files;
- `docs/protocol-v1.md` and `docs/protocol-project-transfer-v1.md`;
- Protocol/Project Transfer/Manifest versions and wire schemas;
- serialized settings, legacy defaults, CLI options and active routes;
- Project UUID, signature/hash/path/Staging/activation safety rules;
- authoritative Revision/Lock/Hierarchy/Tombstone semantics.
