# WP6 disconnected three-way property observation (2026-10-17)

## Outcome and risk

Add an **offline/read-only** comparison of three independently locally prepared same-Session, same-revision Component property snapshots: common baseline, local observation, and remote observation. This is a conservative investigation tool for later Inspector rejection/reconnect UX, **not** a synchronization or merge engine.

The logic reuses the existing two-way fail-closed validation **for every pair** (baseline/local, baseline/remote, local/remote), so foreign/faked prepared snapshots, mismatched owner/type, stale authority, Scene, baseline, or changed typed policy fail consistently. Record sets are incomplete observations; absence is never treated as delete, property creation or an implicit patch. Preserve private identity/Session ownership, exact allowlist/value bounds, no Unity/WS integration, no Session mutation, replay grant or automatic conflict resolution.

Complete triple-observed records are classified as:
- unchanged: all values equal;
- local-only: local differs while remote equals baseline;
- remote-only: remote differs while local equals baseline;
- convergent: local and remote agree on the same change;
- divergent: both differ and disagree.

Incomplete records from any source are quarantined in an `observedIncomplete` group; never auto-merge or apply. Results share only already frozen records and are frozen themselves.

## Validation

Positive and negative deterministic Node tests for all five classes, missing paths, Vector3 normalization, owner/type/kind conflict, fake/foreign snapshots, changed policy/revision, no mutation. Run full Server suite, source/document/engineering/workflow validation and the exact GitHub PR CI/Unity checks. **No physical two-PC, live Inspector, or packaged Windows evidence** is asserted.

## Rollback

Revert this isolated helper/tests/doc. Existing two-way snapshot diff and current Project Peer/Scene authority stay unchanged.
