# Legacy work-state compatibility area

`docs/work-state/` contains **historical engineering material and compatibility entry points** from earlier TeamForge phases. It must not be treated as a current-state database.

For current questions, start with:

- [STATUS.md](../STATUS.md) — current capability, validation boundaries, blockers, and readiness;
- [`../../release-contract.json`](../../release-contract.json) — exact current runtime/protocol/release selections;
- [HOW_IT_WORKS.md](../HOW_IT_WORKS.md) — current end-to-end behavior;
- [architecture.md](../architecture.md) — current as-built topology and trust boundaries;
- [ROADMAP.md](../ROADMAP.md) — planned direction.

The V2 documentation migration is moving durable historical snapshots toward [../history/work-state/](../history/work-state/) while retaining short pointers here where old links still have compatibility value.

Until that migration is complete, filenames such as `HOTFIX*_SESSION.md`, `PHASE*_SESSION.md`, `CHANGED_FILES.md`, `CURRENT_STATE.md`, `NEXT_SESSION.md`, or `DECISIONS.md` describe their recorded historical work context only. Words like “current”, “next”, “remaining”, “blocked”, or “done” inside them do not override current source/tests or the canonical documents above.
