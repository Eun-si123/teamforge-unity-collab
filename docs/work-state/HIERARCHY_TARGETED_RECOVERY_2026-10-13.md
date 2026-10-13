# Hierarchy rejection recovery plan — 2026-10-13

## Outcome and observed baseline

Base: `2a490cc02646038eb1c6cf9da77b9be2e5822d28`.
Branch: `fix/hierarchy-targeted-recovery-20261013`.

Both delayed Hierarchy rejection and local safety rejection call global
`Undo.PerformUndo()`. An unrelated Undo record made later can be reverted
instead of the rejected Hierarchy change. Existing contention coverage has
no intervening unrelated edit. Reproduce the case in actual Unity before
changing production behavior.

## Scope and protected invariants

High risk: live Scene recovery and identity. Restore supported rename,
reparent and sibling-order fields on the exact authoritative live object;
preserve other objects, Component data, selection and unrelated Undo records.
Reparent restoration must use the latest observed server Transform, rather
than stale coordinates from an older Hierarchy update.

Keep canonical Scene/object identity, parent ownership, cycle checks, Prefab
safety, revisions and locks fail-closed. No identity fallback, hidden new
Component/Prefab capability, protocol change or fabricated saved object.
If reliable restoration is unavailable (including rejected deletion or
unverified creation), preserve local data and pause Hierarchy processing with
an explicit manual-recovery/reconnect status rather than undoing arbitrary
history or manufacturing Component-less replacements.

## Evidence

- Real Unity regression: rejected rename/reparent/reorder, followed by an
  unrelated object/Component edit, then delayed conflict/protocol error.
- Local foreign-lock refusal has the same target-only behavior.
- Preserve unrelated Undo and selection; verify latest confirmed Transform
  on reparent, repeated refusal, missing/foreign Scene/parent and unsafe
  Prefab context without local mutation or a publish loop.
- Exercise explicit pause for destructive or ambiguous recovery and verify
  connection reset clears the transient pause.
- Full existing Unity authority/lock-contention E2E, Server/Project Peer
  regression and source/docs/workflow/engineering/privacy validators.
- Source and Unity CI do not prove packaged bytes or physical two-PC behavior.

## Documentation and wider review

Unity package README owns the recovery contract. This dated plan and the task
PR own investigation evidence; STATUS/release contract/r8 physical gates are
unchanged. User authorized a surrounding workflow review: sample recovery,
state/cache coherence, user-facing readiness, tests and documentation drift;
fix required neighbors and record independent findings with a revisit trigger.
Do not restart live services, publish a release, relax review requirements or
mix unrelated PR changes into this task. PR #261 is an independent validated
identity foundation awaiting its required review.

## Checkpoint

Baseline test commit: `2c2d7a6b15f1ef9eec08fd232f3090fffd454c37` in PR #262.
Its first actual Unity run executed 218 cases, with 203 passed, 13 failed and
two intentional skips. All new failures were fixture setup: an additive Scene
cannot be created while an untitled Scene is unsaved. This run is **not** Undo
bug reproduction. The fixture now uses the existing suite's disposable
single-Scene convention and isolates its Undo groups and authority records.

Production recovery is prepared locally but not yet committed to this branch;
the next baseline commit changes tests/checkpoint only. Next: confirm the
actual wrong-Undo/cache failures on unchanged production, then commit and test
the target-aware recovery. Rollback is a source revert; recovery must preserve
local Scene data if the safe path cannot complete.
