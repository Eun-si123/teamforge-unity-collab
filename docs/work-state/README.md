# Legacy work-state compatibility area

`docs/work-state/` is now a **compatibility area for older TeamForge references**. It must not be treated as a current-state database.

For current questions, start with:

- [STATUS.md](../STATUS.md) — current capability, validation boundaries, blockers, and readiness;
- [`../../release-contract.json`](../../release-contract.json) — exact current runtime/protocol/release selections;
- [HOW_IT_WORKS.md](../HOW_IT_WORKS.md) — current end-to-end behavior;
- [architecture.md](../architecture.md) — current as-built topology and trust boundaries;
- [ROADMAP.md](../ROADMAP.md) — planned direction.

Raw Phase 4, hotfix, takeover, and UX session snapshots are preserved under [../history/work-state/](../history/work-state/). The old `CHANGED_FILES.md`, `CURRENT_STATE.md`, `NEXT_SESSION.md`, `PROJECT_CONTEXT.md`, `DECISIONS.md`, and `TEST_EVIDENCE.md` paths remain only as short compatibility pointers where older references are likely to exist.

`TEST_EVIDENCE.md` now routes to its scoped verification record under [`../evidence/verification/`](../evidence/verification/); it is not current release status.

Words such as “current”, “next”, “remaining”, “blocked”, or “done” inside archived snapshots describe the historical work context in which they were written and do not override current source/tests or the canonical documents above.
