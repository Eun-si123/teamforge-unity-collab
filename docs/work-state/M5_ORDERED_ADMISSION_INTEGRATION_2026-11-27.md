# M5 ordered Scene admission and transition barrier — 2026-11-27

Draft #620 base e23e5f6; upstream main 78b7baf (#685). Main and the integration branch both changed signed Scene admission and its tests. Resolve both conflicts by preserving upstream per-connection causal ordering AND the M5 transition fence through asynchronous completion. No merge into main or field-readiness change.

## Confirmed defect
Cached signed Scene admission returned a Promise but did not put it into the per-connection queue on the integration branch. Merge upstream's ordering fix without discarding M5 pending admission accounting. In a second regression, deterministically attempt a trusted online pause immediately after the join admission releases and before the already queued lock request executes. The pre-fix test observed a successful pause and a subsequent lock grant despite the fence. The paused state was not actually quiescent.

## Correction
- Track cached asynchronous signed Scene admission in the connection queue, preserving the immediate path for cached synchronous edits.
- Hold the existing Project transition admission guard for all queued lock/component commands from enqueue through completion, not merely during their execution. Ignore commands whose connection/session has already departed; release the guard even on failures.
- Keep source verification and deferred Project approval covered by the existing release path. No new remote pause/commit capability.
- Preserve upstream tests for fresh/cached signed Scene ordering, and add real WebSocket regression tests for pause during signed Scene verification and the precise pending-lock gap. The latter failed before this correction and passed afterward.

## Validation
Four focused ordering/transition tests PASS, Server 526 PASS / 0 FAIL (npm exit 0), Server syntax and engineering/docs/workflow/public-source checks PASS. No Project Peer/Unity/Launcher source modifications in this merge. A prior intermediate 525-test run returned all passing with an anomalous terminal wrapper status; explicit rerun returned exit 0. New Windows/Unity CI, packaged runtime and physical two-PC verification remain outstanding. FIELD_BLOCKED retained.
