# UX Bootstrap WP3.5 — Runtime Discovery, Packaging & Security Update Foundation

Date: 2026-08-14 (KST)

## Result

WP3.5 adds a package-relative, fail-closed runtime foundation without changing the Node backend or the WP0–WP3 Host, lifecycle, Authority, Publish, Seed, invite, and CLI contracts.

The Windows x64 candidate contains the official Node.js `v24.19.0` executable and the runtime-only TeamForge backend with locked `ws@8.21.3`. Unity resolves the installed package through `PackageInfo.resolvedPath`, verifies the pinned runtime manifest and every payload file, probes an absolute executable path with shell execution disabled, and only then starts the existing Host bridge. npm, PowerShell, dependency installation, and source-workspace layout are not part of the end-user Host path.

`TEAMFORGE_WORKSPACE_ROOT` and `TEAMFORGE_NODE_PATH` remain developer compatibility fallbacks. They are considered only when the packaged `Runtime~` directory is absent; a present but corrupt package never falls through to an unverified installation.

## Resolution order

1. Locate `com.eunsung.teamforge` using the Unity package that owns the Editor assembly.
2. If `Runtime~/runtime-manifest.json` exists, verify its compile-time SHA-256 pin, schema/product/backend contract, bounded relative paths, declared file sizes and SHA-256 values.
3. Use the matching verified platform runtime. This candidate supplies `win-x64`.
4. When a package is valid but has no matching platform payload, probe only safe absolute installed-runtime candidates and accept Node LTS major 22 or 24.
5. Only when `Runtime~` is absent, permit explicit developer workspace/node overrides and the existing CLI workflow.
6. Missing, incompatible, unsafe, or corrupt runtime state returns a stable diagnostic and starts no Coordinator or Seed.

## Packaging and dependency contract

- Package payload: `unity-package/com.eunsung.teamforge/Runtime~` (Unity ignores `~` package folders in the Asset Database).
- Backend: unchanged existing `server/src` and `project-peer/src` plus exact package/lockfiles.
- Runtime dependency: only `ws@8.21.3`, copied from the lockfile installation; optional native accelerators are not added.
- Windows runtime: official `node-v24.19.0-win-x64.zip`, archive SHA-256 `57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73` matched the official `SHASUMS256.txt` entry.
- Bundled executable SHA-256: `3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237`.
- npm is not bundled and bundled-mode preflight reports it as `not_requested`; a damaged immutable payload returns `runtime_bundle_corrupt` and cannot run `npm ci`.

## Diagnostics

- `runtime_bundle_missing`: complete package payload not installed.
- `runtime_bundle_corrupt`: manifest, path, size, hash, product, backend, or executable mismatch.
- `runtime_version_unsupported`: installed fallback is not a supported LTS major.
- `runtime_probe_failed`: bounded absolute-path version probe failed or timed out.

Messages tell end users to reinstall the TeamForge package without requiring Node/npm knowledge. Advanced diagnostics retain the stable code.

## Security/update policy

- Review runtime and direct dependencies at least every 30 days; begin urgent security review within 72 hours of a relevant upstream advisory.
- Pin exact production versions and npm lockfile integrity values. Regenerate the runtime manifest and compile-time pin for every payload change.
- Release gate: match the Node archive against official SHASUMS, run the bundle verifier from a fresh extraction, run `npm audit --omit=dev`, and run `npm audit signatures` online.
- Treat archive signature verification as distinct from checksum matching. Detached cryptographic verification was **NOT RUN** for this candidate and is not claimed as PASS.
- Never self-update binaries or dependencies inside a Unity project. Updates are reviewed, rebuilt, verified, and distributed as a new immutable package candidate.

Primary sources: [Node.js release policy and LTS status](https://nodejs.org/en/about/previous-releases), [Node.js v24.19.0 release files and checksums](https://nodejs.org/download/release/v24.19.0/), [Unity PackageInfo resolvedPath](https://docs.unity3d.com/es/current/ScriptReference/PackageManager.PackageInfo.html), [Unity custom package layout and `~` folders](https://docs.unity3d.com/6000.0/Documentation/Manual/cus-layout.html), [npm audit and registry signatures](https://docs.npmjs.com/cli/v11/commands/npm-audit/), [npm package-lock integrity](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/), and [ws upstream releases](https://github.com/websockets/ws/releases).

## Verification evidence

Executed on Windows x64, 2026-08-14:

- Official Node archive SHA-256 against official `SHASUMS256.txt`: **PASS**.
- Bundled `node.exe --version`: **PASS**, `v24.19.0`.
- Runtime manifest: **PASS**, 86 declared payload files; exact size/hash and no undeclared files.
- Existing Host bridge launched with bundled absolute paths and `TEAMFORGE_RUNTIME_KIND=bundled_package`: **PASS**; preflight returned `idle`, npm `not_requested`.
- WP3.5 bundled-preflight regression tests: **PASS**, 9/9.
- Server regression suite: **PASS**, 72/72.
- Project Peer regression suite, including WP3 re-arm and embedded runtime Publish → Sync → Active preservation: **PASS**, 94/94 on the final fresh rerun.
- Repository invariant/static C# validation: **PASS**, 405 tracked files, 56 C# sources, Protocol v1.
- New runtime-discovery C# source compiled with Unity 6000.3.21f1's Roslyn compiler against the Unity NetStandard 2.1 reference plus API-shape stubs: **PASS** (only expected JSON-deserialization field warnings).
- `npm audit --omit=dev`: **PASS**, 0 vulnerabilities.
- `npm audit signatures`: **PASS**, 2 packages with verified registry signatures.

Unity 6000.3.21f1 batchmode compile/EditMode execution: **NOT RUN (BLOCKED)**. The Editor process was started, but licensing repeatedly lost its Licensing Client connection and reported that `com.unity.editor.headless` was unavailable. No test-result XML was produced; the bounded process was stopped after 285 seconds. The log is retained outside the candidate source as fresh evidence. This is not reported as a compile or test PASS.

The first fresh Project Peer suite attempt was **FAIL**, 93/94: the pre-existing loopback concurrency timing test observed HTTP 200 where it expected a transient 503. The same test passed alone and the complete suite then passed 94/94 without source changes. Both outcomes are retained; the failed attempt is not relabeled as PASS.

The complete Node/server/Project Peer/repository/fresh-candidate results are recorded with the final candidate evidence. Unity compilation and EditMode Test Runner results must only be marked PASS if the Unity process produces the corresponding artifacts.

## Platform boundary

- Windows x64 runtime packaging/execution: implemented and executed.
- macOS installed-runtime discovery: implemented; runtime execution **NOT RUN**.
- Linux installed-runtime discovery: implemented; runtime execution **NOT RUN**.
- macOS/Linux bundled payloads: **NOT PACKAGED** in this Windows candidate.

## Explicit exclusions

WP4 Guest Launcher, Phase 5 persistent recovery, WebRTC/ICE/STUN/TURN/Relay, and Component Sync were not implemented. Protocol v1, Project Transfer, Project UUID/Owner/signature/hash/Authority checks, Coordinator registry re-arm, verified lifecycle ownership, and the Advanced/debug CLI remain unchanged.
