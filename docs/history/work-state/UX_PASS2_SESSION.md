# TeamForge UX Pass 2 Work State

Date: 2026-08-09 Asia/Seoul
Base: Phase 4 v0.5.0 UX Pass 1 / Hotfix6 authority model
Status: implementation complete; static validation complete; Unity field compile/test pending
Phase 5: NOT STARTED

## User problem being solved

Manual setup/testing is too slow and error-prone: users should not need to understand Project UUID/Session ID/baseline internals, and developers should not repeatedly hand-copy A/B/C Projects or click Test Runner for every candidate.

## Pass 2 decisions

- Keep server authority/protocol stable; improve workflow above it.
- Normal UI is Start/Join; manual settings are escape hatch only.
- `TF1.` Invite remains credential-free but is now bound to the exact saved Scene baseline (GUID + SHA-256).
- Wrong baseline must fail before realtime connect; never fabricate/force a GlobalObjectId match.
- Session baseline cache lives only under local `UserSettings` and never silently adopts dirty edits.
- Standard Test Lab = A + B(auto) + C(offline Late Join).
- B/C are independent Editor Projects; Unity MPPM Virtual Players are not used for authoring verification.
- Windows copy fast path = robocopy, with managed fallback.
- Clone auto-connect retries through import/compile/update startup instead of firing once.
- Developer Unity EditMode gate gets a one-command CLI wrapper.

## Code added/changed

- `Editor/UX/TeamForgeBaselineFingerprint.cs`
- `Editor/UX/TeamForgeInviteCache.cs`
- `Editor/UX/TeamForgeJoinCode.cs`
- `Editor/UX/TeamForgeQuickStartUtility.cs`
- `Editor/UX/TeamForgeDoctor.cs`
- `Editor/UX/TeamForgeHomeWindow.cs`
- `Editor/Testing/TeamForgeTestLab.cs`
- `Editor/Testing/TeamForgeCloneBootstrap.cs`
- `Editor/Testing/TeamForgeTestLabWindow.cs`
- `Tests/Editor/TeamForgeUxTests.cs`
- `scripts/teamforge.ps1` and Windows launchers
- validator / README / changelog / UX docs

## Evidence so far

- repository validator PASS before final packaging: 244 files / 43 C# / protocol v1
- all `.mjs` syntax PASS: 46 files
- server: 17/17 files byte-identical to UX Pass 1
- project-peer: 38/38 files byte-identical to UX Pass 1
- npm dependency reinstall attempted and BLOCKED by this environment's package mirror returning 404 for the locked `ws@8.21.1` tarball; Node test suites therefore not rerun in Pass 2 yet
- Unity compile/EditMode NOT RUN in this environment

## Finalization result

- final repository validator: PASS (`246 files`, `43 C# sources`, protocol v1)
- final `.mjs` syntax: PASS (`46 files`)
- Unity-only package source: `110 files`
- packaged artifacts are verified again by fresh extraction and hash-manifest comparison before handoff
- SHA-256 sidecars and a separate final validation report accompany the artifacts

## First field check after handoff

Do not start by manually creating A/B/C. Replace the package, confirm Unity compiles, run the automated EditMode command/Test Runner once, then use `Quick A/B/C Lab`. B should connect automatically and C should open offline; use `Connect Current` on C only when ready to validate Late Join.
