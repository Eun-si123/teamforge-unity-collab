# TeamForge Guest Launcher

This directory contains the source and tests for the standalone Windows Guest Launcher.

This module README describes **Launcher behavior and trust boundaries**, not current release readiness. Use [STATUS.md](../docs/STATUS.md) for live readiness and [`release-contract.json`](../release-contract.json) for exact framework/runtime/candidate selections.

## Source versus packaged output

A fresh source checkout contains the Launcher project, Runtime loader and tests. Generated packaged output such as `launcher/win-x64/` is intentionally not committed as canonical source.

A packaged Launcher contains a self-contained app plus a manifest-pinned Runtime. The normal packaged path does not fall back to system Node/npm, arbitrary PATH executables, project-local runtimes or a source workspace.

## Trusted packaged layout

A packaged candidate is closed over app-owned paths similar to:

```text
win-x64/
  TeamForge.Launcher.exe
  runtime-loader.mjs
  Runtime/
    runtime-manifest.json
    platforms/win-x64/node.exe
    backend/...
  <self-contained .NET files>
```

The release packaging flow must finalize Runtime content and generated pins/manifests before the Launcher is treated as a valid packaged artifact.

A development checkout may contain placeholder/generated values that are intentionally insufficient for release-runtime startup. An arbitrary local `dotnet publish` directory is not automatically an official TeamForge candidate.

## Build and focused tests

```powershell
dotnet restore launcher/src/TeamForge.Launcher/TeamForge.Launcher.csproj -r win-x64
dotnet run --project launcher/tests/TeamForge.Launcher.Core.Tests/TeamForge.Launcher.Core.Tests.csproj -c Release
dotnet publish launcher/src/TeamForge.Launcher/TeamForge.Launcher.csproj -c Release -r win-x64 --self-contained true --no-restore -o launcher/win-x64
```

The exact target framework, SDK/runtime selections and bundled Runtime versions belong to [`../release-contract.json`](../release-contract.json).

A complete packaged candidate additionally requires the repository Runtime/pin/manifest generation and staged-release validation steps described in [SOURCE.md](../docs/SOURCE.md) and the release tooling.

## Runtime integrity boundary

The Launcher verifies the packaged Runtime layout before starting the Guest bridge.

Trust-relevant responsibilities include:

- manifest/layout/hash verification for app-owned Runtime files;
- an explicit allowlisted bridge entry point;
- child-process environment scrubbing/policy;
- absolute verified executable selection;
- bounded NDJSON communication with the Guest bridge;
- no shell-based arbitrary launch path.

Environment convenience must not become a fallback that bypasses the packaged Runtime contract.

## Guest trust and handoff boundary

The Launcher drives the fresh-Guest flow but does not become Project authority.

Before Unity starts, the flow must preserve:

- signed Collaboration Invite/bootstrap validation;
- Project/Owner/Publisher trust review;
- verified receive/staging/activation;
- exact Active Project identity;
- Unity-version/project handoff checks;
- fail-closed handling of mismatched or tampered state.

Invite/access-code values should use bounded IPC rather than being exposed as process command-line arguments or persistent raw logs.

## Path-resilience boundary

The Windows flow uses a bounded managed path strategy rather than promising arbitrary path depth.

A TeamForge-owned short execution alias may be used only when policy can prove that it resolves to the expected canonical Active Project and remains valid immediately before launch.

Path shortening must not:

- escape the managed destination;
- weaken Runtime/hash verification;
- change Project trust;
- accept arbitrary external reparse/symlink/junction roots;
- turn an unverified received directory into a valid Unity handoff.

Canonical Active Project identity and Unity-visible execution path are related but distinct concepts.

## Diagnostics / recovery boundary

Launcher diagnostics and recovery actions should be bounded, secret-redacted and based on known state.

A recovery action must not bypass invite signatures, Project trust, activation, Runtime integrity, path validation or final handoff checks merely to make the workflow continue.

Interrupted receive/shutdown should converge into a handled recoverable state where possible; physical field evidence for current source/candidates is tracked in [STATUS.md](../docs/STATUS.md), not this module README.

## Distribution boundary

Code signing, current packaged-platform availability, exact candidate hashes and release-readiness state are distribution facts owned by [STATUS.md](../docs/STATUS.md), [compatibility.md](../docs/compatibility.md), [`release-contract.json`](../release-contract.json), and [`../builds/README.md`](../builds/README.md).

Do not duplicate those changing values here unless they are essential to a source-level explanation.

See [architecture.md](../docs/architecture.md) for complete topology/trust boundaries and [CODEMAP.md](../CODEMAP.md) for file-level navigation.
