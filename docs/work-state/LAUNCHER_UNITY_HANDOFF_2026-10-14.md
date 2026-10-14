# Launcher Unity handoff context fence — 2026-10-14

## Problem and outcome

MainWindow's Unity-open and Editor-selection tasks await validation, Editor probing,
handoff refresh and path preparation while continuing to read mutable window
fields. Invite/destination replacement or close can invalidate those fields;
late work can restore stale ready state, open the previous project, overwrite a
newer context or allow repeated open attempts.

Capture the project context before starting, serialize Unity selection/open work,
and check that the context is still current after asynchronous stages and before
launch. A stale completion must neither start a process nor publish errors/ready
state into the newer context. Retire only its own unused refreshed handoff.

## Scope, ownership and invariants

- MainWindow owns the context lifetime and UI operation state; UnityLaunchPolicy
  and UnityPathStrategy retain verification, handoff/hash/path/alias and process
  argument/environment policy.
- Extract the coherent Unity selection/open orchestration to a MainWindow partial
  owner, not generic helpers. Private stage delegates default only to the existing
  production policies; no public injection, wire or Runtime trust bypass.
- Keep Active versus Existing-Active semantics distinct: only Active carries the
  verified realtime handoff and optional in-memory access code.
- Invalidation/close fences old tasks. One window has at most one Unity-selection
  or open task; stale errors cannot clear newer project or credential state.
- A refreshed handoff is retained for a successful launch and retired on failed or
  cancelled launch; unrelated files/Active data are never removed.
- Invalidation/close requests cancellation of the owned operation. Final window
  close waits for its completion/cleanup, alongside existing BridgeClient cleanup.
  A cancelled Editor-version probe must terminate and reap only its own child,
  preserving the existing 45-second non-cancellation probe timeout.
- Secret retirement, exact Unity version, Runtime integrity, managed containment,
  immediate alias revalidation and source/project identities remain fail-closed.

Risk: high launch/recovery/secret-lifetime surface. No protocol, permanent state,
authentication, release identity or broad Inspector/Component support changes.

## Implementation and falsifiable evidence

First save a behavior-preserving extraction/private stage seam and deterministic
native regression baseline. Tests use real WPF MainWindow and actual temporary
Active/handoff validation/refresh/path policy. Explicit TaskCompletionSource gates
control ordering; only Editor probe/process start are synthetic, with no real Unity
launch, credentials, Runtime startup or Project transfer.

Then add context/in-flight guards and immutable local inputs. Cover healthy Active
and Existing-Active, invite/close during validation and probing, cancellation after
refresh/path preparation, double open, late failure preserving newer state, and
late Editor selection. Assert zero starts on cancellation, one on success,
targeted handoff cleanup and unchanged final token/environment retirement.

Required: native Windows Launcher CI (WPF, Core, diagnostics, build), portable
handoff/static and loader tests, relevant repository validators, plan privacy and
maintainability review. Record actual baseline failures before treating the fix as
verified; preserve assertions and fail boundedly rather than depending on delays.

## Recovery, docs and evidence boundary

Cancel a stale task without clearing the newer window context. Current-context
failure keeps existing safe receive-again recovery. A source revert restores the
previous orchestration; no verified Active directory is mutated by this patch.
Launcher README owns the behavior, CODEMAP the partial/test route, and this dated
plan is history. STATUS/release-contract and historical field evidence are not
updated as new validation. No new ZIP/release or physical two-PC claim.

## Initial checkpoint

- Base main: `0c5a9fcc149413a37dff2d220a2402ad98c438a2`; no open PRs.
- Source inspection identified mutable-field and missing context/in-flight fences.
- Native reproduction and implementation: **NOT RUN / NOT IMPLEMENTED**.
- Next step: save the baseline extraction and gated regressions on a task branch,
  inspect native results, then implement the context fence. PR owns live state.

## Baseline and implementation checkpoint

Initial baseline `69f794dbd8605b77f76a8ef2da5ca7fa9d93a697`, CI
`38582721917`, Windows job `115916603323`: **FAIL / 24 of 36**. Fixture alias
cleanup obscured several results, so only directly observed late-error/selection/
probe-child defects were claimed. Fixture-only correction uses a short independent
alias root and verified owned-junction removal before ordinary tree cleanup.

Corrected-fixture baseline `4a66508bba1e35350b31a6033da131867cc27030`, CI
`38583991191`, Windows job `115921035268`: **FAIL / 26 of 36**. All previous
23 cases and healthy Active/Existing-Active/Editor selection passed; all 10 new
race/cancellation cases failed as intended. Core 33/33 and other CI jobs passed.
No assertion, path-budget, ownership or production context rule was relaxed.

Implementation captures local project/result/Editor inputs, owns one cancellable
context-bound operation, checks completions before effects/UI publication, retires
only unused refreshed handoffs, and waits for operation cleanup before final close.
Core version-probe cancellation now reaps its child and observes pipe-reader tasks.
One additional close-after-refresh regression checks cleanup-before-close directly.
Corrected native execution is **NOT RUN** at this checkpoint; the PR owns final
evidence and the next safe step is final-head Windows CI.
