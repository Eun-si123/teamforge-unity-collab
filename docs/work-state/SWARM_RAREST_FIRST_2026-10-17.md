# Opt-in Swarm rarest-first inventory scheduling (2026-10-17)

## Purpose / scope

The Stage A R&D idea is to move uniquely advertised chunks earlier in the transfer, before chunks that many healthy known sources could plausibly provide. Only source scheduling order changes behind an **explicit advanced opt-in** `sync --chunk-order rarest-first`; the default `manifest` keeps previous order. This can be combined with the existing `--peer-selection verified-throughput`.

## Invariants, negative conditions and acceptance

- Select from the **same signed validated Manifest unique chunks**, with existing trusted source/session, verified SHA-256 data, atomic activation, retry/failover and cancellation semantics. Never invent availability from advertisement.
- Consider only non-permanently-failed peers with successfully validated inventory; deduplicate by peer ID (labels do not independently prove replicas).
- An unknown inventory remains **unknown**, not proof that a chunk is unavailable. It stays eligible under existing logic; assign these chunks no spurious 'rarest' confidence. A chunk with no eligible source at all fails promptly rather than being falsely guaranteed.
- Sort only **after checking stored verified chunks**, never re-download local validated content. Tie-break by original Manifest order; avoid a global persistent peer score, retries/extra network requests, or new wire/API requirements.
- Reject invalid mode before starting advanced CLI sync. Add regression tests for selection, unknown inventory, duplicated labels, resume, and integrity. Compare with original mode on identical bounded benchmarks.
- No claims of lower wall-clock time, better survivability or actual Seed content until real two-PC field evidence and benchmarks.

## Validation plan

Focused Swarm and benchmark tests; complete Project Peer and Server suites; public source, engineering, doc, workflow and maintainability validators; GitHub PR CI/Unity automation. Physical two-Windows-PC r8 validation remains **FIELD BLOCKED**.

## Rollback

Remove the `--chunk-order` option to retain the original `manifest` behavior; revert this branch/PR if needed. The immutable published r8 candidate is unaffected.
