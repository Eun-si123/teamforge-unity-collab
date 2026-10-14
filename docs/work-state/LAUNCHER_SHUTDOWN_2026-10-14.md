# Launcher shutdown completion fence — 2026-10-14

## Problem and intended outcome

Current MainWindow sets `_closingAfterCleanup` before awaiting BridgeClient disposal.
A second Close can therefore pass Closing while the child process is still draining
or waiting for its two-second graceful timeout. The first close also leaves inputs
and queued bridge UI events active during that wait.

Keep the first close cancelled, reject repeated close requests until cleanup has
actually finished, retire access-code copies immediately, and prevent new input or
queued bridge UI work from restarting the closing workflow.

## Scope, ownership and invariants

- MainWindow owns the WPF close state and credential/UI lifetime. BridgeClient owns
  child-process shutdown, pending-request cancellation and its existing deadline.
- Separate cleanup-in-progress from cleanup-complete; dispose the bridge once.
- Final Close remains dispatched after the cancelled Closing event unwinds.
- Child shutdown keeps the current graceful NDJSON frame, bounded wait and forced
  process-tree termination fallback. No authentication, integrity, path, trust,
  protocol, state-store or transfer/activation policy changes.
- Inputs remain disabled through pending-request and queued-event continuations;
  clearing copies remains best-effort managed-memory retirement, not zeroization.
- Runtime verification/startup and Unity handoff races are adjacent hypotheses to
  inspect, not permission to introduce unrelated launch abstractions in this patch.

Risk: high lifecycle/recovery surface, bounded to existing Launcher orchestration.
No persistent state is added. A source revert restores the previous close behavior;
verified partial Project data and existing bridge recovery policy stay owned by
their current modules.

## Required evidence

Native Windows WPF cases must use the real MainWindow and BridgeClient with a
public synthetic NDJSON child fixture, never a live credential, verified production
Runtime bypass or real Project transfer:

1. Delay child shutdown behind an explicit gate; a second Close must remain
   cancelled until process cleanup completes, then the window closes exactly once.
2. Pending requests settle with `runtime_shutdown`, credential copies are retired,
   and UI input stays disabled even when normal button updates run again.
3. A queued progress event must not change the closing UI; queued trust handling
   must not open a new trust prompt.
4. A child ignoring graceful shutdown must be terminated by the existing deadline
   and allow the window to finish closing.

First run the new regressions against the current implementation and record actual
failures. Then run the Windows Launcher CI lane (Core, diagnostics, WPF and build),
portable runtime-loader tests, relevant docs/workflow/engineering/privacy checks,
and a bounded second look at affected callbacks and close ordering.

## Documentation and release boundary

Update the Launcher module README for the source-level shutdown contract and
CODEMAP only if test navigation changes. Keep this dated plan historical; the PR
owns the live checkpoint. STATUS and release-contract keep the selected candidate
and field readiness. No new package, release or physical result is implied.

## Initial checkpoint

- Baseline: main `32eac67637f1fe1d9e69b9ea71df3f0952d66648`.
- Source inspection complete; reproduction, implementation and native checks are
  **NOT RUN** at this plan checkpoint.
- Next step: save native synthetic-child regressions on the task branch and obtain
  baseline Windows evidence before changing production code.
