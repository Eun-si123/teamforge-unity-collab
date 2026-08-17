# TeamForge UX Pass 1 Work State

Date: 2026-08-09 Asia/Seoul
Base: Phase 4 v0.5.0 Hotfix6
Status: implementation complete; Unity field compile/test pending
Phase 5: NOT STARTED

## Why this pass exists

Manual A/B/C project copying, token/session setup, diagnostics collection and repeated reconnect workflows became the main development bottleneck. User asked to pause repetitive field testing and make both end-user and developer workflows much easier.

## Added

- Quick Start home (`Window > TeamForge > Collaboration`)
- Advanced legacy window moved to `Window > TeamForge > Advanced`
- project one-click setup / descriptor ensure
- new-session generation
- secret-free TF1 join code
- TeamForge Doctor
- Test Lab B/C/D clean clone + launch + auto-connect bootstrap; saved-baseline guard; last clone offline by default for Late Join
- environment-only token handoff for child Editors
- expected tombstone stale-edit rejection logs as Warning
- full-workspace local Windows server launcher and PowerShell dev helper
- 12 UX-focused EditMode cases (expected package total: 86)

## Evidence

- repository validator PASS: 237 files / 41 C# / protocol v1
- server source unchanged from Hotfix6
- project-peer source unchanged from Hotfix6
- server syntax check PASS
- project-peer syntax check PASS (34 modules)
- Node full tests not rerun: this environment's npm mirror returns 404 for `ws@8.21.1`; server/peer source is unchanged from Hotfix6 and syntax checks pass
- Unity compile/EditMode NOT RUN here

## Next

Use exact UX Pass 1 package in Unity 6000.3.21f1. First check compilation/Test Runner (expected 86 cases), then use Test Lab for the pending Late Join field scenario; the last clone stays offline by default. Record any UX friction instead of reverting to manual robocopy unless Test Lab itself fails.
