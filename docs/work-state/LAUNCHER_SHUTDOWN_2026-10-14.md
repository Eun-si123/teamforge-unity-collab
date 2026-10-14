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
- Late runtime verification and pending startup health belong to the same window
  lifecycle: they must not start a child or publish ready after closing begins.
  Preserve production's pinned verifier and verified BridgeClient.Start behind a
  private initialization seam. Unity handoff races remain an adjacent hypothesis,
  outside this patch's child-startup/close contract.

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
5. A gated verification completion after no-bridge close must never call the child
   factory; cancelled startup health must settle without ready or callback errors.
   A positive real synthetic-child health case must still enable the Guest flow.

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

## Native baseline and implementation checkpoint

- Regression-only HEAD: `7560be6bb1c9565cb12fa474335bc54162f91a24`.
- CI `38517680505`, Windows job `115700085238`: **FAIL**, WPF **16/19**.
  Repeated Close bypassed cleanup, workflow input remained enabled, and queued
  progress changed the closing UI. Existing nonresponsive-child termination passed.
  Core **33/33**, diagnostics and portable lanes passed at that baseline.
- Correction separates closing-in-progress from cleanup-complete, disables the
  content tree, suppresses queued bridge work/cancellation failure presentation,
  and checks closing before and after private runtime initialization awaits.
- Seven lifecycle cases are implemented, including three startup cases. Corrected
  native execution remains **NOT RUN** here; the live PR will record final evidence.
- Documentation ownership: source contract in Launcher README, test navigation in
  CODEMAP, this dated plan as history. No new canonical document/navigation surface.
