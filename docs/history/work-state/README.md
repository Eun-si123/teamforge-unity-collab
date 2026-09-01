# Historical work-state snapshots

Files in this directory are frozen engineering snapshots from earlier TeamForge stabilization, phase, hotfix, or handoff work. They are preserved for provenance, debugging, regression archaeology, and decision reconstruction.

They are **not current project truth**. Terms inside these files such as “current”, “next”, “remaining”, “candidate”, “blocked”, “must”, or “resume” are scoped to the date and work package recorded by that snapshot.

For current questions, use the maintained owners:

- [STATUS.md](../../STATUS.md) — current capability/readiness;
- [`../../../release-contract.json`](../../../release-contract.json) — exact current runtime/protocol/release selections;
- [architecture.md](../../architecture.md) — current as-built architecture and trust boundaries;
- [ROADMAP.md](../../ROADMAP.md) — current planned direction;
- [architecture-decisions.md](../../architecture-decisions.md) — decision index and supersession state.

Do not edit these snapshots merely to make them agree with current `main`. If an old record contains a durable lesson or decision that remains useful, distill that knowledge into the appropriate current lesson/decision surface and leave the historical record intact.
