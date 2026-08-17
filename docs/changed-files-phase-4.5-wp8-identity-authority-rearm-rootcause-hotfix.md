# Phase 4.5 WP8 Identity / Authority Re-arm Root Cause Hotfix — Changed Files

Date: 2026-08-11 (Asia/Seoul)

Exact input: `Unity-TeamForge-Phase4.5-WP8-identity-authority-test-reconciliation-hotfix-candidate.zip`  
Input SHA-256: `B2DAC04C72F7D0F048158A09208A1699F3C40E148DE85F9D43E70DBC271E55B5`  
Input files: 321  
Output files: 325  
Changed or added: 14  
Deleted: 0

## Unity Editor source

- `unity-package/com.eunsung.teamforge/Editor/AssemblyInfo.cs` — added one friend-assembly declaration for internal Editor test access.
- `unity-package/com.eunsung.teamforge/Editor/AssemblyInfo.cs.meta` — Unity metadata for the new source.
- `unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformModel.cs` — added internal `TeamForgeTransformSelectionResolution` and `TeamForgeTransformSelectionRejection` types.
- `unity-package/com.eunsung.teamforge/Editor/TransformSync/TeamForgeTransformSyncService.cs` — centralized the existing selection guards in the typed resolver and exposed the exact authoritative-selection match as an internal test seam. Public behavior and status text are preserved.

## Unity tests

- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeIdentityAuthorityAuditTests.cs` — replaced the contaminated reconnect mega-test with seven independent production-sequence invariants.
- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeTransformModelTests.cs` — replaced UI-string assertions with typed rejection/canonical identity assertions while preserving automatic re-arm and pending-delta coverage.

## Validator

- `scripts/validate-repository.mjs` — freezes the internal seam, focused tests, expected `123` count, current field candidate and root-cause Closure evidence.

## Documentation

- `docs/project-state.md` — records the exact input, user `116/117` evidence, current candidate and blocked gate.
- `docs/phase-4.5-closure-report.md` — records the corrected root cause, `123` expected count and unchanged Closure block.
- `docs/phase-4.5-field-closure-checklist.md` — points field closure to the new candidate and `123/123` gate.
- `docs/phase-4.5-wp8-identity-authority-audit-field-checklist.md` — lists the focused independent/repeated tests and `123/123` gate.
- `docs/phase-4.5-wp8-identity-authority-test-reconciliation-hotfix-report.md` — adds a correction note superseding the earlier under-specified-fixture classification while preserving historical evidence.
- `docs/phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix-report.md` — new root-cause, research, validation and handoff report.
- `docs/changed-files-phase-4.5-wp8-identity-authority-rearm-rootcause-hotfix.md` — this ledger.

## Explicitly unchanged

- Server and Project Peer product/runtime/test source.
- Protocol v1, Project Transfer v1, Manifest schema 1 and every wire schema/route.
- Public/static Unity APIs and user-visible status text.
- Hierarchy snapshot gate, clean Scene baseline, parent validation, current-session logical authority, dirty Scene protection, Lock/Revision/Tombstone behavior and protected-conflict retention.
- Realtime and transfer routes: Server WebSocket and project-peer Direct HTTP remain the only active paths.
- No WebRTC, ICE/STUN/TURN, Relay, Component Sync, Phase 5 or new Profile work.
