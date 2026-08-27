# TeamForge main patch status — 2026-08-27

This note records the repository state immediately after the WP5.1 core field-blocker patch line was integrated into `main`.

## Main integration

- PR #81, `fix: close core Windows field blockers`, was merged into `main`.
- Main merge commit: `8a9bef7a785b2fd4b1842cf0ee70f6e5163481a7`.
- PR #81 already contained the Transform/Lock recovery work from PR #76, so PR #76 was closed as superseded rather than merged separately.
- This was a normal merge into the existing `main` history. `main` was not force-replaced or reset to another branch.

## Patches now present in main

- #67: strict verified saved-Guest reconnect path.
- #68/#74: recoverable Transform lock-contention handling and first-snapshot dirty-Scene hardening.
- #69: Launcher receive/shutdown race converted to handled `runtime_shutdown` behavior.
- #70: stable production LAN Seed TCP port `5091`.
- #71: verified Windows execution-alias handoff resolving to the exact canonical Active Project.

## Validation completed before merge

The final PR head included current `main` and passed the repository protection gates before merge.

- CI run #216: PASS.
  - Server (Node 24): PASS.
  - Project Peer (Node 24): PASS.
  - Launcher runtime loader (Node 24): PASS.
  - Launcher (.NET 10 / Windows): PASS.
  - Public source contract: PASS.
- Dependency Review run #140: PASS.
- Unity Tests run #73: PASS.
  - Unity Lock Contention E2E: PASS.
  - Unity Realtime Authority E2E: PASS.
  - Realtime Authority Chaos E2E: PASS.
  - Project Transfer Resume E2E: PASS.

Earlier local validation also recorded 143/143 runnable Unity EditMode tests passing, same-machine A/B contention recovery, and A/B/C late-join convergence.

## What is still not closed

The code patches are now in `main`, but physical Windows field closure is still pending because the exact two-PC regression scenarios cannot currently be rerun.

Therefore:

- implementation: complete for these targeted fixes;
- automated/local validation: green;
- integration into `main`: complete;
- physical two-PC validation: pending;
- issues #67–#71 should remain open until their field scenarios are rerun;
- release/candidate state should remain `FIELD_BLOCKED` until the intended physical field gate is satisfied.

This pending field debt does not need to block beginning WP6 design and implementation. When two physical Windows PCs are available again, rerun the narrow WP5.1 regression checklist and close the remaining field issues based on that evidence.
