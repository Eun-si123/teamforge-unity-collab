# TeamForge Phase 4 v0.5.0 — UX Pass 2 Report

Date: 2026-08-09 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Product version: `0.5.0`
Realtime protocol: `1` (unchanged)
Base: UX Pass 1 / Hotfix6 authority model
Phase 5: NOT STARTED

## Goal

Make the common user path and the developer field-test path materially shorter without weakening Project/Scene identity, lock, hierarchy authority, tombstones, or Direct P2P boundaries. The repeated manual A/B/C copy, wrong-baseline Late Join, and one-shot clone auto-connect startup race are treated as product workflow defects rather than documentation problems.

## UX design references

- Visual Studio Live Share: one prominent share action, invite copied to clipboard, paste/link join, advanced controls outside the common path.
- Unity Multiplayer Play Mode: multi-client local testing is a first-class workflow, but its Virtual Players are not suitable for TeamForge authoring validation, so TeamForge still uses independent Editor Project copies.
- Unity Editor/Test Framework command line: `-projectPath`, `-batchmode`, `-runTests`, `-testPlatform EditMode`, and `-testResults` enable repeatable developer automation instead of manual Test Runner clicks.

## Implemented

### 1. Start / Join home

`Window > TeamForge > Collaboration` now centers the normal path on:

- `Start Collaboration`
- `Join from Clipboard`
- `Connect Current`
- `Copy Invite`
- `Leave`

Server endpoint, realtime path, Project/Session IDs and Bearer Token remain available under a collapsed manual section; the full legacy diagnostics/bootstrap surface remains under Advanced.

### 2. Baseline-bound secret-free invite

The `TF1.` payload now also carries the host's saved active Scene baseline:

- project UUID
- Scene asset path
- Scene asset GUID
- SHA-256 of the saved `.unity` file
- non-authoritative host display-name hint / creation time

Before realtime connection the join path verifies Project UUID, Scene GUID/path, and saved Scene SHA-256. A mismatch is rejected with a user-facing sync/copy action instead of allowing the realtime hierarchy snapshot to reach a later `GlobalObjectId ... missing locally` warning. GUID/SHA fields are shape-validated as hexadecimal input.

Bearer Token/private keys remain excluded from the invite.

### 3. Session baseline cache

`UserSettings/TeamForgeInviteCache.asset` remembers the baseline used when the current Session was created/joined. This lets `Copy Invite` continue to work after normal realtime hierarchy edits make the Scene dirty, while keeping the original baseline stable. It does not convert dirty local state into a new baseline.

### 4. One-click A/B/C Test Lab

`Quick A/B/C Lab` now:

1. saves/verifies A's baseline,
2. prepares a host Session when needed,
3. clones B and C outside the source Project,
4. preserves Assets/Packages/ProjectSettings/Scene `.meta` identity,
5. excludes generated/local identity directories,
6. launches the same Unity Editor executable with `-projectPath`,
7. auto-connects B,
8. deliberately leaves C offline for Late Join,
9. puts the current secret-free Invite on the clipboard.

On Windows it attempts `robocopy` first and falls back to managed copies. Clone credentials, when required for a local test, are inherited through the child process environment only.

### 5. Startup-safe clone auto-connect

The one-shot `delayCall` behavior from UX Pass 1 could miss auto-connect if the clone happened to be compiling/importing. UX Pass 2 registers an Editor update retry window and waits until Unity is no longer compiling/updating before connecting. Timeout leaves the Home UI open for an explicit `Connect Current` fallback.

### 6. Doctor / developer automation

Doctor now includes Scene baseline fingerprint status, Project bootstrap state and Test Lab role, plus safe-fix actions and friendlier diagnostics.

The full candidate now provides:

- `Start-TeamForge-Local.cmd`
- `Start-TeamForge-LAN.cmd` (requires auth; can securely generate a temporary token and copy it to the clipboard without printing it)
- `Verify-TeamForge.cmd`
- `Run-Unity-Tests.cmd`
- `scripts/teamforge.ps1 doctor|install|server|dev|test|smoke|verify|unity-test`

`unity-test` resolves the bundled Unity Project and compatible Editor path, then launches EditMode tests headlessly and writes XML/log evidence under `test-results/`.

## Compatibility / authority boundary

- Coordinator source: unchanged from UX Pass 1 / Hotfix6.
- Project Peer source: unchanged from UX Pass 1 / Hotfix6.
- Realtime protocol: v1 unchanged.
- Coordinator still does not relay Project payload.
- Join cannot force-bind a mismatching Project UUID or Scene baseline.
- Test Lab does not clone `UserSettings` identity.
- Persistent hierarchy recovery remains Phase 5.

## Validation boundary

Current source/static evidence before handoff:

- repository validator: PASS (`246 files`, `43 C# sources`, protocol v1)
- all `.mjs` syntax checks: PASS (`46 files`)
- Coordinator: `17/17` files byte-identical to UX Pass 1
- Project Peer: `38/38` files byte-identical to UX Pass 1
- Unity package source: `110 files`
- NUnit `[Test]`/`[TestCase]` discovery markers in package source: `90` expected cases (not a Unity execution result)

Unity `6000.3.21f1` itself is not available in this execution environment, so no Unity compile or EditMode PASS is claimed here. Node dependency reinstall was attempted and blocked by this execution environment's package mirror returning 404 for the locked `ws@8.21.1` tarball; the Node suites were therefore not rerun for Pass 2. A separate packaged-artifact validation report records final ZIP hashes and fresh-extraction comparisons.
