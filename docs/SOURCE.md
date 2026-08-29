# TeamForge source guide

The experimental TeamForge source is public for testing, review, security feedback, and contribution.

> [!IMPORTANT]
> Start with **[STATUS.md](STATUS.md)** before treating any source snapshot as a supported release. Source availability and green CI do not by themselves mean the current packaged workflow is ready for general use.

This page explains **how to work with the source tree**. For question-to-file navigation and code ownership, use **[CODEMAP.md](../CODEMAP.md)**. For coding-agent instructions, use **[`../AGENTS.md`](../AGENTS.md)**.

## Source tree

- `unity-package/com.eunsung.teamforge/` — Unity Editor package source and Editor tests
- `server/` — realtime/session authority and Project Coordinator source/tests
- `project-peer/` — Project bootstrap, direct transfer, trust, staging and activation source/tests
- `launcher/` — Windows Guest Launcher source/tests; generated `win-x64/` release output is not committed in a normal source checkout
- `scripts/` — source validation, release validation, packaging and development helpers
- `unity-project/` — minimal Unity project support files used by the source tree
- `docs/` — current documentation plus historical engineering records

Generated runtime payloads, packaged executables, release ZIPs/manifests, local credentials, private keys, and machine-specific state are intentionally not canonical source files.

## Fresh-clone quick start

A normal public source checkout and a staged release candidate are **different validation targets**.

For the normal source-development path:

```powershell
npm run install:all
npm run validate
npm test
```

- `npm run validate` runs the public-source validator. It checks current source/document/release-contract consistency without requiring generated packaged Runtime/Launcher artifacts.
- `npm test` runs the repository's normal source regression suites plus the public-source contract.
- `npm run validate:release` is for a **fully staged release-candidate tree** and is expected to require generated Runtime/Launcher/release evidence that a fresh clone intentionally does not contain.

On Windows, the source-oriented verification path is also available through:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\teamforge.ps1 verify
```

A fully staged release tree may use `teamforge.ps1 verify-release` instead.

## Launcher source checks

Launcher checks span both Node and .NET surfaces:

```powershell
node --test --test-reporter=spec launcher/test/runtime-loader.test.mjs
dotnet run --project launcher/tests/TeamForge.Launcher.Core.Tests/TeamForge.Launcher.Core.Tests.csproj -c Release
dotnet restore launcher/src/TeamForge.Launcher/TeamForge.Launcher.csproj -r win-x64
dotnet build launcher/src/TeamForge.Launcher/TeamForge.Launcher.csproj -c Release -r win-x64 --self-contained true --no-restore
```

The exact supported runtime/tool selections belong to [`../release-contract.json`](../release-contract.json), not to copied version numbers in this guide.

## Unity tests

`.github/workflows/unity-tests.yml` provides the public GitHub Actions path for Unity EditMode and real-server E2E scenarios using the release-contract test line.

Local Unity execution is also available through the repository scripts when the matching Editor is installed.

Treat every test result according to the scenario and revision it actually executed. Local/CI Unity tests do not automatically prove a packaged two-PC Windows field path.

## Module entry points

Read the module README that matches the part you are changing:

- **[Unity package README](../unity-package/com.eunsung.teamforge/README.md)** — Editor-facing collaboration behavior and Unity constraints
- **[Server README](../server/README.md)** — realtime authority, authentication assumptions and Project metadata scope
- **[Project Peer README](../project-peer/README.md)** — direct Project Transfer, Host/Guest orchestration, trust and activation
- **[Launcher README](../launcher/README.md)** — Windows Launcher source-vs-package layout, Runtime integrity, path resilience, trust UX and Unity handoff
- **[CODEMAP.md](../CODEMAP.md)** — file-level routing from a question to the smallest relevant source/tests

## Before changing architecture or trust boundaries

Read **[architecture.md](architecture.md)** before changing any of the following:

- authority or state ownership;
- object/project identity;
- transport or protocol routing;
- persistence/recovery semantics;
- Project transfer/trust/activation;
- filesystem/path containment;
- Runtime integrity or final Unity handoff.

Read **[architecture-decisions.md](architecture-decisions.md)** when you need the reason a current or historical design choice exists. Decisions explicitly marked superseded must not override the current architecture/source.

For security-sensitive changes, also read **[SECURITY.md](../.github/SECURITY.md)** and inspect the exact trust-boundary code plus its tests before making exploitability or safety claims.

## Source-of-truth order

When documentation disagrees, use this order:

1. current source and tests for implemented behavior;
2. **[STATUS.md](STATUS.md)** for current capability/release-readiness claims;
3. [`../release-contract.json`](../release-contract.json) for exact runtime/tool/protocol/release selections;
4. current module READMEs and **[architecture.md](architecture.md)** for supported runtime/architecture boundaries;
5. GitHub Issues for detailed live bug discussion;
6. [`../builds/README.md`](../builds/README.md) and exact GitHub Release hashes for packaged artifact identity;
7. **[ROADMAP.md](ROADMAP.md)** only for planned direction;
8. phase/work-state/audit/evidence notes only for their recorded historical snapshots.

## Pull-request validation expectations

For a normal source contribution:

- run the smallest relevant tests while iterating;
- run `npm run validate` for repository/document contract changes;
- run `npm test` when the change affects normal source behavior;
- run the relevant Launcher/.NET or Unity tests when those surfaces are touched;
- describe meaningful manual testing in the pull request when behavior cannot be fully automated;
- do not treat one happy-path result as proof of unrelated field or security guarantees.

See **[CONTRIBUTING.md](../.github/CONTRIBUTING.md)** for contribution policy and **[CODEMAP.md](../CODEMAP.md)** for the exact files/tests to inspect.

## Historical records

`docs/phases/`, `docs/work-state/`, dated patch/test notes, and audits are retained because they preserve useful engineering history. They may describe superseded behavior.

Do not load historical notes first for an ordinary code task. Start with the smallest current module, its tests, the code map, and the current architecture/status documents; use historical records only when the history itself is relevant.
