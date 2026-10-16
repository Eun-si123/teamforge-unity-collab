# Transfer advertised inventory health — 2026-10-16

Historical, additive source change. Current supported transfer capability and release readiness remain governed by `docs/STATUS.md`.

## Motivation and scope

The private TeamForge future R&D notes suggest Swarm health and redundancy observability. Current direct Project transfer already validates per-Seed inventory, but the download result cannot distinguish a single advertising source from multiple advertisers or an unknown inventory. Expose a small conservative **observation**, not a health guarantee or new scheduling policy.

## Invariants and boundaries

- The Manifest remains validated and chunks are deduplicated before counting.
- Known inventory contents have already been checked against the exact Project UUID, Manifest hash and allowed Chunk set.
- An inventory request failure remains **unknown**, never asserted to mean absence or unavailable bytes. Conversely an advertised Chunk is not proof of successful download or integrity until SHA-256 verification and storage.
- Multiple entries sharing the same peer ID count as a single *advertiser label* for redundancy; identity is not independently authenticated by this metric.
- Do not change retry/failover scheduling, concurrency, transport requests, trust, rate limits, activation or persistent data.
- Avoid emitting success-looking diagnostics on the error channel; expose frozen `download().peerInventoryHealth` and sync CLI JSON field instead.
- Existing Protocol v1, published r8 ZIP and field readiness remain untouched.

## Tests and rollback

Three targeted tests cover full/partial/unknown inventories, a successful download despite absent inventory advertisement and duplicate peer IDs. Compare results against the actual validated unique Manifest Chunks rather than assumed fixture size; verify metrics are frozen. Regression: full Swarm downloader suite, Project Peer suite and standard source/documentation/engineering checks; CI/physical testing remain separately identified.

Remove the additive helper, return field, CLI field and tests to roll back; no on-disk Project state changes.

## Initial implementation evidence

Branch `feat/swarm-advertised-inventory-health-20261016`, forked from `main` `9b44074`. Implemented in source commits `9c8e0be`, `3a69860`, `c541f3f`. Targeted Swarm downloader tests: **24 passed, 0 failed**, including three new health scenarios (Node 24, isolated mini-PC worktree).
