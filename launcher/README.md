# TeamForge Guest Launcher

This directory contains the source and tests for the standalone Windows Guest Launcher.

This module README describes **Launcher behavior and trust boundaries**, not current release readiness. Use [STATUS.md](../docs/STATUS.md) for live readiness and [`release-contract.json`](../release-contract.json) for exact framework/runtime/candidate selections.

## Source versus packaged output

A fresh source checkout contains the Launcher project, Runtime loader and tests. Generated packaged output such as `launcher/win-x64/` is intentionally **not committed to the public source checkout** and is not canonical source.

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
dotnet run --project launcher/tests/TeamForge.Diagnostics.Tests/TeamForge.Diagnostics.Tests.csproj -c Release
dotnet run --project launcher/tests/TeamForge.Launcher.Ui.Tests/TeamForge.Launcher.Ui.Tests.csproj -c Release
dotnet publish launcher/src/TeamForge.Launcher/TeamForge.Launcher.csproj -c Release -r win-x64 --self-contained true --no-restore -o launcher/win-x64
```

Core/Runtime validation is available through `npm run testlab -- plan launcher`
and `npm run testlab -- run launcher`. The separate `launcher-ui` scenario requires
Windows x64 and the .NET SDK; it executes actual STA WPF controls and credential
cleanup handlers, plus real BridgeClient lifecycle/request regressions with a
public synthetic child. CI runs it in the existing Windows Launcher job. Native UI
automation does not establish an exact packaged or physical Host/Guest result.

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

Bridge request values cannot replace the NDJSON envelope's reserved `id` or `type`.
That local validation runs before pending-request registration, so a rejected
payload is neither sent nor retained and other in-flight requests remain intact.

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

The access-code input is masked by default and provides explicit **Show/Hide**
and **Clear** actions. Hiding retires the cleartext view while preserving the
masked input selected for same-invite retries. Switching windows, collapsing
advanced details or starting receive hides the code automatically. Clear, invite
replacement, retention opt-out and Launcher close forget it. Session retention
remains an explicit checkbox; there is no permanent credential storage or
automatic clipboard copy. `AccessCodeInput.xaml(.cs)` owns presentation;
MainWindow owns invite-scoped lifetime, transient bridge/Unity copies and redaction.

Unity selection/open work is owned by `MainWindow.UnityLaunch.cs`. Each operation
captures its project context and rechecks it after asynchronous validation, probe,
handoff and path stages. Invite/destination replacement cancels old work; late
success or error cannot restore or clear a newer context. Only one Unity selection
or open operation runs per window. Existing-Active opening stays separate from the
Active realtime handoff and never receives its access code or session handoff.

Receive feedback distinguishes transferred bytes from file verification and
Project preparation. Verification remains visibly busy after all bytes arrive;
progress alone never enables Unity launch. Non-finite/malformed percentages use
an indeterminate indicator, and queued progress cannot overwrite a confirmed
pause. Diagnostics retain the current verification/paused phase.
`ReceiveProgressPresentation.cs` owns this pure presentation policy; MainWindow
applies it to the WPF controls. Core tests exercise numeric/phase edge cases;
Windows UI tests exercise the actual indicator, status and pause/resume handlers.
Pause/resume acknowledgements apply the requested state, so a runtime event
that arrived first cannot be toggled back by a late acknowledgement.
Only one pause/resume request and one cancellation request may be pending per
receive lifetime. Cancellation remains available while pause is pending and
takes priority over late pause events/ACKs. When receiving ends or starts again,
old control results, errors and already-queued events cannot change the new UI.
Transport failure or close retires controls without an unhandled UI callback.
Cancel during invite/previous-Active inspection stops before the receive starts.
If activation already committed while cancellation was requested, the completed
Project is still validated and offered for manual opening; Unity does not open
automatically. Closing during final validation cannot publish a new ready state.

Closing cancels this operation and waits for its cleanup before final window close.
Unused refreshed handoffs are retired through the existing targeted Core policy;
successful starts retain the handoff for Unity's one-shot consumption. Editor-probe
cancellation terminates/reaps its owned child; the ordinary 45-second probe timeout
is unchanged. Private stage seams use the existing production verification/path/
process policies; gated native tests do not establish actual Unity launch or
physical/package evidence.

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

Launcher diagnostics and recovery actions are bounded, secret-redacted and based on known state.

Two manual diagnostics surfaces are available:

- **Copy diagnostics** — a compact, bounded current-run text summary for quick inspection/paste.
- **Save support bundle** — creates a local ZIP containing a manifest, safe structured state summary, short human-readable summary, and bounded redacted current-run history.

The default support bundle is deliberately **not a dump of the machine**. It does not automatically include raw local paths, raw endpoint addresses, environment-variable dumps, Collaboration Invite contents, Project files, private keys, access credentials, arbitrary process dumps, or unbounded logs. Endpoint troubleshooting retains only coarse classification such as loopback/private/public/DNS plus a useful port where available.

Support bundles are created locally and are **not uploaded automatically**. The manifest records the default privacy boundary so a user can review what the bundle represents before sharing it.

A recovery or diagnostics action must not bypass invite signatures, Project trust, activation, Runtime integrity, path validation or final handoff checks merely to make the workflow continue.

Interrupted receive/shutdown should converge into a handled recoverable state where possible; physical field evidence for current source/candidates is tracked in [STATUS.md](../docs/STATUS.md), not this module README.

MainWindow's first close retires access-code copies and disables workflow input.
Repeated close requests wait for the same BridgeClient cleanup to finish; only
then is final Close dispatched. The existing bridge policy cancels pending requests
with `runtime_shutdown`, allows two seconds for graceful child exit, and terminates
a nonresponsive process tree. Queued bridge UI events and cancellation failures
cannot reopen the closing workflow. Late runtime verification cannot start a child
after close, and shutdown-cancelled startup health cannot mark the UI ready. The
private initialization seam keeps production's pinned verifier and verified
BridgeClient.Start; native tests inject only a public synthetic child.

## Distribution boundary

Code signing, current packaged-platform availability, exact candidate hashes and release-readiness state are distribution facts owned by [STATUS.md](../docs/STATUS.md), [compatibility.md](../docs/compatibility.md), [`release-contract.json`](../release-contract.json), and [`../builds/README.md`](../builds/README.md).

Do not duplicate those changing values here unless they are essential to a source-level explanation.

See [How TeamForge works](../docs/HOW_IT_WORKS.md) for the end-to-end flow, [architecture.md](../docs/architecture.md) for complete topology/trust boundaries, [TEST_LAB.md](../docs/TEST_LAB.md) for named validation scenarios, and [CODEMAP.md](../CODEMAP.md) for file-level navigation.
