# Phase 4.5 WP8 Saved Transform Identity Hotfix — Changed Files

Date: 2026-08-11 (Asia/Seoul)  
Input: `Unity-TeamForge-Phase4.5-closure.zip` (`859D0806238A588187D76A14E4575CE04E2E1348CFA7DB4F6CF68CEA2571987D`)

## Unity behavior and regression coverage

- `unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformModel.cs`
  - Adds baseline-aware saved/logical object and parent canonicalization.
- `unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs`
  - Uses the same canonical IDs for selection, tracked-target and remote parent validation while retaining strict baseline checks.
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeTransformModelTests.cs`
  - Adds the failing-first saved child/parent alias, Lock and Transform regression while retaining runtime-created logical-object coverage.

## Validator

- `scripts/validate-repository.mjs`
  - Freezes canonicalization order, strict child/parent baseline validation, regression presence, blocked field status and hotfix evidence files.

## Architecture and Closure documents

- `docs/architecture.md`
- `docs/project-state.md`
- `docs/roadmap.md`
- `docs/phase-4.5-closure-report.md`
- `docs/phase-4.5-field-closure-checklist.md`
- `docs/phase-4.5-rollback-reference.md`
- `docs/phase-4.5-wp8-field-hotfix-saved-transform-identity-report.md` (new)
- `docs/phase-4.5-wp8-field-hotfix-checklist.md` (new)
- `docs/changed-files-phase-4.5-wp8-field-hotfix.md` (new)

## Explicitly unchanged

- all `server/` files;
- all `project-peer/` files;
- Realtime Protocol v1 and Project Transfer v1 documents and wire schemas;
- Unity settings/profile/transport/project-transfer code;
- package manifests, dependency lockfiles and product version;
- existing WP8 Closure ZIP and sidecar.

No Phase 5, Component Sync, WebRTC/ICE/STUN/TURN/Relay, route/fallback, tuning or Profile work is included.
