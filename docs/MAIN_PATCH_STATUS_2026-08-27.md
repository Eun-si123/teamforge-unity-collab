# TeamForge main patch status — 2026-08-27

> [!NOTE]
> **Dated engineering evidence, not the current status source.**
>
> This note records the repository state immediately after the WP5.1 core field-blocker patch line was integrated into `main`. For current capability/release readiness, use **[STATUS.md](STATUS.md)**. Later source or validation may supersede statements in this dated snapshot.

## Main integration

- PR #81, `fix: close core Windows field blockers`, was merged into `main`.
- Main merge commit: `8a9bef7a785b2fd4b1842cf0ee70f6e5163481a7`.
- PR #81 already contained the Transform/Lock recovery work from PR #76, so PR #76 was closed as superseded rather than merged separately.
- This was a normal merge into the existing `main` history; `main` was not force-replaced or reset to another branch.

## Patches present in main at this snapshot

- #67: strict verified saved-Guest reconnect path.
- #68/#74: recoverable Transform lock-contention handling and first-snapshot dirty-Scene hardening.
- #69: Launcher receive/shutdown race converted to handled `runtime_shutdown` behavior.
- #70: stable production LAN Seed TCP port `5091`.
- #71: verified Windows execution-alias handoff resolving to the exact canonical Active Project.

## Validation completed before merge

The final PR head included current `main` at the time and passed the recorded repository protection gates before merge.

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

## What was still not closed at this snapshot

The code patches were in `main`, but physical Windows field closure was still pending because the exact two-PC regression scenarios had not yet been rerun.

At this snapshot:

- implementation: complete for the targeted fixes;
- automated/local validation: green;
- integration into `main`: complete;
- physical two-PC validation: pending;
- issues #67–#71 were intended to remain open until their field scenarios were rerun;
- release/candidate state remained `FIELD_BLOCKED` pending the intended physical field gate.

The existing r2 packaged artifact predated this merge and therefore was not an exact packaged post-fix candidate. Current source/candidate distinction is maintained in [STATUS.md](STATUS.md) and [`../builds/README.md`](../builds/README.md).
