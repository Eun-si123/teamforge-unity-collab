# TeamForge source guide

The experimental TeamForge source is published here for testing, review, security feedback, and contribution.

> [!IMPORTANT]
> Start with **[STATUS.md](STATUS.md)** before treating anything in this repository as a supported release. The source is public, but a general-user packaged alpha is **not ready or recommended yet**.

If you are trying to answer a code question rather than browse the whole tree, start with **[CODEMAP.md](../CODEMAP.md)**. It maps common questions to the relevant module, entry points, source files, and tests.

## LLM / coding-agent reading contract

An AI tool should not treat every file in the repository as equally current or equally authoritative. Use this order when sources appear to disagree:

1. **Current source and tests** for implemented behavior.
2. **[STATUS.md](STATUS.md)** for current capability and release-readiness claims.
3. **[`../release-contract.json`](../release-contract.json)** for exact current product/release/runtime/protocol identity.
4. **Module READMEs** for supported runtime contracts and operational boundaries.
5. **[architecture.md](architecture.md)** for the current as-built topology, ownership and trust boundaries.
6. **[architecture-decisions.md](architecture-decisions.md)** for decisions that are not marked superseded; historical decisions remain useful context but do not override later current material.
7. **[`../builds/README.md`](../builds/README.md)** plus exact Release hashes for packaged artifact identity.
8. **[CHANGELOG.md](../CHANGELOG.md)** for version history.
9. **[ROADMAP.md](ROADMAP.md)** only for planned direction.
10. `docs/phases/` and `docs/work-state/` only as historical context; they may be superseded.

For a code-change task, read the smallest relevant module and its tests before loading historical notes. For security-sensitive changes, also read `.github/SECURITY.md` and the architecture/trust-boundary documents before proposing a patch.

## Source tree

- `unity-package/com.eunsung.teamforge/` — Unity Editor package source and Editor tests
- `server/` — coordination/session server source and tests
- `project-peer/` — project bootstrap and P2P tooling/tests
- `launcher/` — Windows Launcher source/tests; the generated `win-x64/` release folder is not committed in a normal public source checkout
- `scripts/` — development, source-validation and release-validation helpers
- `unity-project/` — minimal Unity project support files used by the source tree

Generated runtime payloads, packaged executables, release manifests/ZIPs, local credentials, private keys, and machine-specific state are intentionally not committed as canonical source.

## Fresh-clone contributor quick start

A normal public source checkout and a staged release candidate are **different validation targets**. Do not run the release-candidate validator against a fresh public clone and interpret missing generated Runtime/EXE/audit files as source corruption.

For Node source work:

```powershell
npm run install:all
npm run validate
npm test
```

- `npm run validate` runs `scripts/validate-public-source.mjs`. It validates current source/document/release-contract consistency and does **not** require generated packaged Runtime/Launcher artifacts.
- `npm test` runs the Server and Project Peer regression suites plus the public-source validator.
- `npm run validate:release` runs the stronger historical/staged-candidate `scripts/validate-repository.mjs`. It expects generated Runtime/Launcher/release-evidence files and is therefore for a fully staged release-candidate tree, **not** an ordinary public clone.

On Windows, the same source-oriented path is available through:

```powershell
Verify-TeamForge.cmd
```

or directly:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\teamforge.ps1 verify
```

A fully staged release tree may use `teamforge.ps1 verify-release` instead.

Launcher checks are separate because they use both Node and .NET surfaces:

```powershell
node --test --test-reporter=spec launcher/test/runtime-loader.test.mjs
dotnet run --project launcher/tests/TeamForge.Launcher.Core.Tests/TeamForge.Launcher.Core.Tests.csproj -c Release
dotnet restore launcher/src/TeamForge.Launcher/TeamForge.Launcher.csproj -r win-x64
dotnet build launcher/src/TeamForge.Launcher/TeamForge.Launcher.csproj -c Release -r win-x64 --self-contained true --no-restore
```

Unity EditMode execution now also has a public GitHub Actions path: `.github/workflows/unity-tests.yml` runs Unity `6000.3.21f1` on relevant pull requests and `main` pushes, including generic/package EditMode coverage and real-server E2E scenarios. `scripts/teamforge.ps1 unity-test` remains useful for local testing when the matching Unity Editor is installed. Both CI and local Unity results are evidence for the scenarios and revisions they actually execute; neither should be generalized into physical two-PC field closure or an unconditional release PASS.

## Module entry points

- **[Unity package README](../unity-package/com.eunsung.teamforge/README.md)** — Editor-facing realtime collaboration, Host flow, hierarchy/transfer safety and current Unity constraints
- **[Server README](../server/README.md)** — authoritative realtime/session coordinator and signed Project metadata scope
- **[Project Peer README](../project-peer/README.md)** — direct HTTP Project Transfer, Host/Guest orchestration, trust and activation contract
- **[Launcher README](../launcher/README.md)** — Windows Guest Launcher source-vs-package layout, runtime integrity, path resilience, trust UX and Unity handoff constraints
- **[CODEMAP.md](../CODEMAP.md)** — file-level deep links and question-to-code routing across all four modules

## LLM reading guide: canonical and project-level files

| File | Read it to understand | LLM caution / next read |
| --- | --- | --- |
| `README.md` | Project purpose, public-facing scope, demos and high-level feature framing | Do not infer release readiness from overview text; check `docs/STATUS.md` |
| `docs/STATUS.md` | What is currently implemented, validated, blocked or unsupported | Pair behavior claims with current source/tests when reviewing code |
| `release-contract.json` | Exact current product version, release ID, runtime/tool selections, protocols and candidate state | It identifies the candidate contract; it does not prove every manual field gate passed |
| `builds/README.md` | Current/superseded packaged candidate classification and artifact-identity rules | Byte-level identity still requires the exact Release asset + SHA-256 |
| `CODEMAP.md` | Which module/file/test is relevant to a specific question | Use it to narrow the task; it is a navigation map, not an implementation substitute |
| `CHANGELOG.md` | Milestones and version history | Older entries describe older behavior; do not let them override current source/status |
| `docs/ROADMAP.md` | Planned work and possible direction | Roadmap items are not implemented facts or promises |
| `.github/SECURITY.md` | Security scope, reporting path and high-level safety expectations | For a finding, inspect the exact trust-boundary code and tests before making exploitability claims |
| `.github/CONTRIBUTING.md` | Test/review expectations and AI-assisted contribution policy | Contribution rules do not prove a particular change was validated |
| `docs/architecture.md` | Current as-built topology, state ownership and dependency boundaries | Read before changing authority, identity, transport, persistence or trust behavior |
| `docs/architecture-decisions.md` | Important current and historical design decisions | Respect explicit superseded/partial-supersession markings; do not revive an old requirement accidentally |
| `docs/AI_COMMENT_AUDIT.md` | Current code-comment readability assessment and comment policy | It is a readability audit, not a security or release-quality score |

## LLM reading guide: Unity Editor package

| File / area | Read it to understand | LLM caution / next read |
| --- | --- | --- |
| `unity-package/com.eunsung.teamforge/README.md` | Supported Host/Guest Unity workflow and package-level constraints | Read before treating an internal helper as a user-facing path |
| `Editor/Connection/TeamForgeConnectionService.cs` | Connection lifecycle, handshake, negotiated capabilities, reconnect/backoff and main-thread routing | Transport/authority behavior is split across strategy/transport/server files; do not assume this service is authoritative state |
| `Editor/Authority/TeamForgeAuthorityView.cs` | Client-side observed session revision, lock state, connection identity and capabilities | It mirrors/observes authority; it does not create server authority |
| `Editor/Presence/TeamForgePresenceService.cs` | Presence sampling, selected-object/camera state and remote SceneView helpers | Identity resolution depends on current Scene/session identity rules; cross-check Hierarchy identity code for edge cases |
| `Editor/TransformSync/TeamForgeTransformSyncService.cs` | Transform observation/application, lock workflow, baseline/revision compatibility behavior | Read `TeamForgeAuthorityView` and server Session Authority before changing revision/lock semantics |
| `Editor/HierarchySync/TeamForgeHierarchySyncService.cs` | Supported same-Scene hierarchy observation/application, snapshot gating and local-difference processing | Read `docs/architecture.md` and server `hierarchy-model.mjs`; unsupported Prefab/cross-Scene cases are intentionally fail-closed |
| `Editor/UX/` | Host/Guest guided workflow, diagnostics, preflight and runtime discovery | UX helpers may wrap lower-level contracts; trace into Project Peer before changing trust/activation behavior |
| `Tests/` | Unity Editor regression/contract tests | Prefer tests that exercise the exact service/invariant being changed rather than assuming folder-level coverage |

## LLM reading guide: realtime / coordination server

| File / area | Read it to understand | LLM caution / next read |
| --- | --- | --- |
| `server/README.md` | Server runtime scope, authentication assumptions and exclusions | The server does not relay Project payload bytes |
| `server/src/index.mjs` | Process startup/shutdown and environment-configured server composition | This is a thin entry point, not the protocol/authority implementation |
| `server/src/teamforge-server.mjs` | HTTP/WebSocket shell, Bearer auth, connection I/O, timers and execution of authority/coordinator effects | Authority transitions belong in the cores; avoid duplicating state rules in the socket host |
| `server/src/session-authority.mjs` | In-memory Presence/Lock/Transform/Hierarchy authority and ordered effects | It is intentionally transport-agnostic; inspect tests before changing conflict/revision semantics |
| `server/src/hierarchy-model.mjs` | Hierarchy state validation, identity and operation preparation | Pair with Unity Hierarchy Sync for end-to-end behavior |
| `server/src/project-coordinator-core.mjs` | Project UUID/Owner/publisher/baseline/peer coordination state | This is metadata coordination, not file/chunk transport |
| `server/src/project-coordinator.mjs` | Host-facing wrapper around coordinator core | Read the core first for actual transition rules |
| `server/src/protocol.mjs` | Server-side protocol constants and validation helpers | Protocol v1 compatibility is broader than one helper file; check golden/integration tests |
| `server/test/` | Server/authority/protocol regression coverage | Use the tests nearest the modified authority or host boundary |

## LLM reading guide: Project Peer / direct project transfer

| File / area | Read it to understand | LLM caution / next read |
| --- | --- | --- |
| `project-peer/README.md` | Host/Guest transfer contracts, runtimes, trust and activation workflow | Normal users use the bundled runtime; developer CLI paths are not the default UX |
| `src/host-orchestrator-cli.mjs` | Serialized NDJSON Host bridge operations exposed to Unity | This bridge dispatches; inspect `host-orchestrator.mjs` and underlying transfer code for behavior |
| `src/guest-orchestrator-cli.mjs` | Launcher-facing Guest bridge, receive/activation/handoff orchestration | Do not bypass its trust/validation stages when reasoning about Guest setup |
| `src/bootstrap-invite.mjs` | Signed Collaboration Invite/bootstrap envelope validation | Treat parsing/signature/trust changes as security-sensitive |
| `src/coordinator-client.mjs` | Signed metadata interaction with TeamForge Server | Project bytes do not flow through this client |
| `src/direct-transfer-client.mjs` | Direct HTTP transfer-source adapter, retries/error normalization | Pair with transfer server and downloader tests before changing retry/failure semantics |
| `src/direct-transfer-server.mjs` | Direct HTTP seed/source for descriptor/manifest/inventory/chunks | Review request bounds and filesystem/content-store assumptions for security changes |
| `src/content-store.mjs` | Content-addressed local Project data primitives | Activation/staging policy lives in additional Project Peer code; do not infer the whole lifecycle from this file |
| `src/filesystem-safety.mjs` | Canonical path and redirected-segment safety primitives | These checks are a trust boundary; avoid “simplifying” them without Windows/path-security tests |
| `src/path-resilience-contract.json` | Shared Windows/Unity path-risk threshold and cache headroom used by source/Launcher policy | This does not authorize arbitrary symlink/reparse-point Project roots |
| `project-peer/test/` | Transfer/bootstrap/trust/regression tests | Check corrupted, interrupted, malicious-path, WP5 recovery and WP5.1 path cases, not only happy paths |

## LLM reading guide: Windows Guest Launcher

| File / area | Read it to understand | LLM caution / next read |
| --- | --- | --- |
| `launcher/README.md` | Source-vs-packaged layout, bundled runtime, path resilience and Guest-launch constraints | `launcher/win-x64/` is generated release output, not a fresh-clone source directory |
| `src/TeamForge.Launcher/MainWindow.xaml(.cs)` | User-facing WPF flow and orchestration glue | UI code should not become the source of truth for trust/integrity rules |
| `src/TeamForge.Launcher.Core/BridgeClient.cs` | Child bridge process and bounded NDJSON communication | Pair with Guest orchestrator and environment/runtime policy for trust analysis |
| `src/TeamForge.Launcher.Core/RuntimeLayout.cs` | Manifest/hash/layout verification for the bundled runtime | Treat hash, file-inventory and containment checks as a security boundary |
| `src/TeamForge.Launcher.Core/EnvironmentPolicy.cs` | Environment scrubbing/policy for child execution | Do not reintroduce PATH/system-Node/project-local fallback accidentally |
| `src/TeamForge.Launcher.Core/PathSafety.cs` | Launcher-side containment/reparse/path safety | Pair with RuntimeLayout/UnityLaunchPolicy tests |
| `src/TeamForge.Launcher.Core/PathResilience.cs` | WP5.1 path budget, capability/strategy routing and Unity-visible execution-path preparation | Canonical verified Active identity remains distinct from an execution alias |
| `src/TeamForge.Launcher.Core/ExecutionAliasManager.cs` | TeamForge-owned Windows execution junction creation and pre-launch identity/target revalidation | Do not generalize this exception into acceptance of arbitrary external reparse points |
| `src/TeamForge.Launcher.Core/DiagnosticsRecovery.cs` | WP5 stable error/recovery actions and bounded redacted diagnostic history | Recovery UX must not become a trust/activation bypass |
| `src/TeamForge.Launcher.Core/UnityLaunchPolicy.cs` | Final Unity executable/project validation and safe process launch | A received project is not launchable until this policy accepts the exact handoff |
| `launcher/runtime-loader.mjs` | Final JS-side runtime manifest verification and Guest bridge import | It intentionally rejects unmanifested/missing/redirected runtime content |
| `launcher/test/`, `launcher/tests/` | Node runtime-loader and .NET launcher tests | Read both test roots; they cover different pieces of the launcher |

## LLM reading guide: repository/release tooling

| File / area | Read it to understand | LLM caution / next read |
| --- | --- | --- |
| `scripts/validate-public-source.mjs` | Fresh-clone source/document/release-contract consistency | This is the normal public source validator; it intentionally does not require generated release binaries/evidence |
| `scripts/validate-repository.mjs` | Fully staged release-candidate policy/integrity checks | It expects generated Runtime/Launcher/release evidence and should not be used to judge an ordinary public source clone |
| `scripts/build-runtime-bundle.mjs` | How bundled runtime payloads/manifests are constructed | Treat generated-runtime contents and pins as part of the release trust boundary |
| `.github/workflows/` | CI, Unity automation, dependency review, release validation, and Pages/AI-readable mirror generation | Workflow success does not replace required two-PC manual field gates |

## Code comments and LLM readability

A focused sample of core files found **low inline-comment density**. The code often relies on descriptive names, tests and external architecture documents rather than comments. See **[AI_COMMENT_AUDIT.md](AI_COMMENT_AUDIT.md)** for the review and adopted policy.

TeamForge does not use a target comment percentage. Comments should explain high-value information that is hard to recover from syntax alone: state ownership, trust boundaries, fail-closed reasons, lifecycle/concurrency rules and compatibility traps. Avoid comments that merely restate the next line of code or duplicate documentation likely to drift.

When touching a complex invariant, prefer a short durable comment near the boundary plus an automated test. For large state-machine files, use `CODEMAP.md` and the module README to locate the relevant architecture/tests before adding prose broadly.

## What to read next

- **[STATUS.md](STATUS.md)** — current capabilities, automated validation, release blockers, and known limitations
- **[`../release-contract.json`](../release-contract.json)** — exact current release/runtime identity
- **[`../builds/README.md`](../builds/README.md)** — current/superseded packaged artifact identity rules
- **[CODEMAP.md](../CODEMAP.md)** — repository responsibilities and direct source entry points
- **[ROADMAP.md](ROADMAP.md)** — development direction rather than current release claims
- **[SECURITY.md](../.github/SECURITY.md)** — security expectations and vulnerability reporting
- **[CONTRIBUTING.md](../.github/CONTRIBUTING.md)** — testing, review, comment, and contribution guidance
- **[architecture.md](architecture.md)** — current architecture overview
- **[architecture-decisions.md](architecture-decisions.md)** — current/historical design decisions and supersession notes

This is an early public preview, not a production-ready release. Use backups or disposable test projects when experimenting with network, realtime-sync, or project-transfer features.