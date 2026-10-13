# Guest access-code controls — 2026-10-14

Historical change plan; the task PR owns the live checkpoint and exact evidence.

## Problem and scope

Issue #225's session-only retry retention is already implemented. The masked
Guest field still lacks show/hide and explicit clear controls. Add those controls
without changing the existing user-selected retry retention or authentication.

Use one small WPF input component to own secret presentation and its transient
cleartext view. MainWindow continues to own credential lifetime, invite changes,
bridge requests, one-shot Unity handoff and diagnostics redaction. Preserve its
existing Password/Clear/Focus/IsEnabled interface and the 8,192-character ceiling.

## Invariants, failure paths and risk

- Medium UI change with a sensitive secret-display boundary: masked by default;
  plaintext appears only after explicit Show, never via automatic copy/logging.
- Hiding retires the cleartext view without losing the masked retry input.
- Explicit Clear, invite replacement, opt-out and window close retire both views
  and reset visibility. Preserve MainWindow's working-copy cleanup.
- Receiving/disabled input, window deactivation and component unload hide the
  view; unload also clears input and detaches the previous window's event.
- Synchronizing edits must not erase the password when clearing the hidden view,
  recurse across WPF change events or resurrect old values after reuse.
- No disk/credential-manager storage, clipboard feature, new authentication,
  permanent remember policy, protocol, dependency, trust or field-gate change.

## Evidence and recovery

Add an STA Windows WPF executable suite against the actual input: default mask,
reveal/edit/hide, clear, disabled input, deactivation, unload/reload and bounded
input. Exercise MainWindow's invite/opt-out/close cleanup where practical. Run in
the existing Windows Launcher CI job with the existing Core/diagnostics checks.
Run local Node/loader/source/docs/workflow/Test Lab checks and diff review.

Local environment has no .NET SDK/Windows; native UI tests remain NOT RUN until
remote Windows CI actually executes them. A published exact ZIP, hands-on Windows
UI and physical two-PC validation remain separate. Failed UI setup must fail the
new suite rather than silently skip it. Reverting the control preserves the
current masked PasswordBox and all existing credential/transport boundaries.

## Documentation and checkpoint

Update Launcher README and CODEMAP for input ownership and native tests; review
Test Lab discovery and existing secret safety validators. No new current
canonical document or release claim. Base:
`7644ce5025188905edb57539b4d2da8d22e9f032`; branch:
`feat/launcher-access-code-controls-20261014`. At the initial checkpoint only
this plan is written. Next: implement the input and native Windows regression.

## Implementation checkpoint

AccessCodeInput now owns masked/revealed views, explicit clear, disabled/hidden/
deactivated masking and unload cleanup. MainWindow uses its existing credential
lifetime calls without new storage or protocol. Fifteen native WPF cases cover
the input and MainWindow's retry, invite, opt-out and shutdown handlers; the
existing Windows job runs the new executable. Launcher-ui is a separate Windows
Test Lab scenario so non-Windows local checks do not pretend to run native UI.

Local full Node tests and source/docs/workflow/Test Lab checks pass; Runtime
loader checks, XML parsing, diff and public plan privacy pass. Native compilation
and WPF execution remain pending remote CI. The shutdown case exercises a real
first Window.Close and fails on any unhandled dispatcher callback; source review
identified a possible synchronous close-inside-Closing path when no bridge exists,
which needs actual Windows evidence before claiming or changing it.

Next safe step: inspect Windows build/UI results, correct any reproduced defect,
then verify the immutable final head and finish the task PR.

## Reproduced Windows shutdown defect

Initial implementation head `f189fe8a476061e50404851874199077c84dd522`:
Windows CI run `38486341591`, Launcher job `115600856453` FAILED. The UI
executable printed 15/15 cases, then exited with an unhandled
InvalidOperationException: Window.Close was called while the first Closing event
was still running. This verifies the existing no-bridge close reentry; it is not
a green native UI run despite the earlier printed case count.

The production fix schedules the final Close on the Dispatcher after cancellation
and cleanup so the original event can finish. Working copies and both input views
are still cleared before that scheduled close. The STA harness now installs the
normal WPF synchronization context explicitly, ensuring async-void exceptions are
reported as failed callback assertions instead of escaping after its summary.
Native tests and Windows build must pass on the corrected immutable head.
