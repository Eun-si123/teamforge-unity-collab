# TeamForge Phase 4 v0.5.0 — UX Pass 1 Report

Date: 2026-08-09 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Product version: `0.5.0`
Realtime protocol: `1` (unchanged)
Base: Hotfix6

## Goal

Reduce the amount of manual setup and repetitive field testing without weakening TeamForge's fail-closed project identity or realtime authority model. This is a usability/developer-experience pass, not Phase 5.

## Research applied

- Visual Studio Live Share: one prominent share action, invite copied to clipboard, guest join flow, advanced access controls separated from the normal path.
- Scene Fusion: host starts a session, peers join from an Editor panel, participant/lock state is visible without exposing transport internals.
- Unity Multiplayer Play Mode: multiple local Editor/player instances are treated as a first-class iteration workflow rather than a manual copy ritual.
- Unity command-line Editor launch: `-projectPath` is an official supported way to launch another Editor project, which Test Lab uses.
- Unity Version Control: users think in terms of a project/workspace copy, while repository/workspace mechanics remain behind the workflow.

## Implemented UX

### Quick Start home

`Window > TeamForge > Collaboration` now opens `TeamForgeHomeWindow`. The previous dense window remains under `Window > TeamForge > Advanced`.

The home screen exposes:

- Display name and server address.
- One-time `Set Up This Project` action.
- `Start Session`, `Connect`, and `Disconnect`.
- Secret-free `Copy Join Code` / `Paste Join Code`.
- Project/session/participant summaries.
- Doctor and Test Lab shortcuts.
- Manual Project/Session/Realtime Path/Bearer Token fields only inside a collapsed section.

### Project setup

`TeamForgeProjectService.TryEnsureCurrentProjectDescriptor` safely creates or loads `ProjectSettings/TeamForgeProject.json`. Quick Start derives a stable human-readable Project ID from its UUID when the old default is still in use.

### Join code

`TF1.<base64url-json>` carries:

- server address
- realtime path
- project ID
- session ID
- project UUID (when available)
- TeamForge product version

It never carries the Bearer token, user ID, private key, Publisher key, or local path. A mismatching local Project UUID is rejected instead of force-bound.

### TeamForge Doctor

Checks:

- Unity 6000.3 target
- package identity/version
- Project descriptor
- saved/dirty active Scene
- Server/Project/Session input validity
- authentication posture (loopback vs non-loopback)
- Project path length risk
- negotiated realtime capabilities

The report can be copied instead of manually collecting many fields.

### Test Lab

`Window > TeamForge > Test Lab` can create 1–3 additional Editor copies (`TF-B`, `TF-C`, `TF-D`) from the currently-open saved Project. Test Lab now refuses a dirty loaded Scene baseline; by default the last clone stays offline so it is immediately usable as a real Late Join client. It excludes generated/local directories (`Library`, `Temp`, `Logs`, `obj`, `UserSettings`, `.vs`, `.idea`, `.git`) while retaining `Assets`, `Packages`, `ProjectSettings`, Scene files and `.meta` files.

Each clone receives a one-shot local bootstrap under `UserSettings` with display name suffix, Server/Project/Session settings and auto-connect intent. The bootstrap deletes itself after applying. If the current Editor has a Bearer token, clone launch passes it in the child process environment rather than writing it into the bootstrap or Project descriptor.

Unity is launched using the running Editor's `EditorApplication.applicationPath` plus `-projectPath`.

### Local developer launcher

The full workspace candidate includes:

- `Start-TeamForge-Local.cmd`
- `scripts/teamforge.ps1 doctor|install|server|test|smoke`

The default local server remains loopback-only (`127.0.0.1`). `-Lan` refuses to bind broadly unless `TEAMFORGE_AUTH_TOKEN` is configured.

### Diagnostics cleanup

`hierarchy_object_deleted` remains a server rejection, but the client now logs the expected stale/offline edit path as a Warning with user-readable wording instead of a generic red Error.

## Safety / compatibility

- Coordinator source: unchanged from Hotfix6.
- Project Peer source: unchanged from Hotfix6.
- Realtime protocol: v1 unchanged.
- Project payload still does not transit the Coordinator.
- Join code contains no credential.
- Project UUID mismatch remains fail-closed.
- Test Lab does not share `UserSettings` identities between clones.
- Phase 5 persistence/recovery is not implemented.

## Validation in this environment

- Repository/static validator: PASS (`237 files`, `41 C# sources`, protocol v1).
- Server `.mjs` syntax/check: PASS.
- Project Peer syntax/check: PASS (`34 modules`).
- Full Node test command: attempted; dependency installation is blocked by the execution environment's npm mirror returning 404 for `ws@8.21.1`. Server/Project Peer source is byte-for-byte unchanged from Hotfix6; syntax checks pass, but the full Node suites were not rerun here.
- Unity compile/EditMode: NOT RUN here. Existing 74 cases plus 12 new UX cases give an expected **86/86** EditMode cases if Unity discovers them all; do not claim PASS until Unity `6000.3.21f1` runs them.

## Required next field gate

This pass is specifically intended to make the next gate shorter:

1. Replace the embedded package with the UX Pass 1 package.
2. Open `Window > TeamForge > Collaboration` and confirm the Quick Start UI compiles.
3. Run EditMode tests once.
4. Use Test Lab from A to create/launch B/C instead of manually copying projects. Leave the default `Keep last clone offline for Late Join` enabled.
5. Make the hierarchy change in A/B, then connect the last offline clone and verify the snapshot.

Do not call Phase 4 complete until those Unity-side gates pass.
