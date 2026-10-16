# Swarm adaptive concurrency admission — opt-in source experiment (2026-10-17)

## Goal / scope

The user will batch two-PC field tests. Extend the advanced Project Peer CLI with `sync --concurrency-mode adaptive` while retaining exact `fixed` default behavior and unchanged published r8 Windows candidate. This is a **source-side bounded admission algorithm**, not trained link-speed optimization.

## Invariants and failure modes

- Starts with one admitted Chunk job; after twice the current limit's verified completions, increases the limit by one, capped at `--concurrency` (1–64); any failed Chunk attempt halves the limit (rounded up) and resets the ramp counter. Controls only *future* Chunk assignment, **never cancels an existing in-flight request because of a downshift**.
- Only accepted SHA-256 verified, stored Chunk successes count toward growth. Failed/invalid Chunk attempts cannot earn growth; cancellation is not counted as a congestion failure. Failure/retry/HTTP backoff and rotation still use existing source logic.
- Original Manifest, Session, Owner/Publisher Trust, Chunk size, file path/activation, verified resume, cancellation propagation and timeout/terminal settlement semantics are unchanged. No persisted network profile, new protocol or automatic Unity/Launcher default.
- Waking sleeping worker admissions must not leak listeners, spin or deadlock when all sources fail or the caller cancels; a single abort wakes every worker, and workers settle before throwing the original first fatal error.
- Observability: `concurrencyControl` immutable per-download report includes mode/ceiling/starting/peak/final limits and number of actual reductions, not internet speed or saved telemetry; CLI sync and bounded benchmark JSON surface it.

## Evidence

- Focused deterministic tests assert ramp, bounded in-flight requests, retryable failure/downshift, verified resume, fail-closed mode input, fixed defaults and cancellation while remaining workers wait.
- Existing direct transfer resume, failure/failover and final Hash verification tests must keep passing in full Project Peer suite, plus Repo validators and exact-head GitHub CI/Unity automated lanes.
- Compare fixed/adaptive under matched conditions with the bounded four-scenario local benchmark; actual LAN/Wi-Fi/VPN two-Windows-PC measurements and published candidate r8 physical readiness remain **FIELD BLOCKED**.
- Any observed slowdown should count as a negative result; do not activate this automatically before physical benchmarking.

## Rollback

Omit `--concurrency-mode` to return to default `fixed`, or revert this isolated source/CLI/test/doc change. No signed invite, wire protocol or packaged r8 bytes change.
