# WP6 property observation diff — 2026-10-16

Historical scoped implementation record. The canonical live feature/support status remains in `docs/STATUS.md`.

## Problem and scope

The existing property-snapshot validator can prepare typed, frozen individual observations, but future read-only resnapshot/rejection UX cannot safely identify differences without duplicating identity and policy checks. Add a *disconnected* snapshot observation diff that explicitly separates changed values from records seen in only one potentially partial observation.

This is **not** runtime Inspector synchronization, a cross-revision merge, delta apply, authoritative conflict repair, Session mutation, Unity Editor write, WebSocket command, or a new release. Existing Protocol v1 and r8 field evidence are unchanged.

## Protected invariants

- Both snapshots must be genuine WeakMap-tracked preparations from the exact same Session and same prepared Component identity baseline at the current Session revision.
- The Scene must still be authoritative; owning GameObjects and exact type/path/kind/range policy are rechecked after snapshot creation.
- Matching Component/path identities must not silently change owner/type/value kind.
- Output is deterministic, read-only and frozen. In particular, an observed-only record must **never** be described as a confirmed deletion.
- Existing identity/type, bounds, UTF-8 snapshot-size and record-count ceilings remain in force.
- Invalid or stale observations fail closed; no historical evidence, packaged candidate or UI behavior is rewritten.

## Evidence and recovery boundary

Focused Node tests cover changes, presence differences, order/Vector3 canonicalization, false/zero, rejection of forged/foreign/stale baselines, live owner/Scene/policy rechecks and kind mismatch. Existing server tests, docs/engineering/source validators and CI should provide regression evidence. Two-PC field behavior and Unity Inspector/Undo require future dedicated implementation and physical validation.

The change is additive, isolated to the unconnected WP6 property module, tests and as-built architecture. Reverting these source additions restores original behavior without modifying Session state or saved projects.

## Implementation checkpoint

Branch: `feat/wp6-property-snapshot-reconcile-20261016`, based on public `main` `9b44074`. Initial source/test implementation commits: `fcf1850`, `d739fa5`. Focused Node property snapshot tests: 20 passed, 0 failed, including five new diff scenarios. Broader validation and CI evidence to be recorded in the PR rather than inferring a field pass.
