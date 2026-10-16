# Swarm manifest-byte inventory coverage (2026-10-17)

## Change and boundaries

- Extend the existing **read-only** validated advertised-Chunk health summary with Manifest-byte-weighted counters: total unique bytes, advertised bytes, bytes not advertised by known inventories, single/multiple-advertiser bytes, and the rounded advertised byte coverage percent.
- The previous Chunk count counters retain their exact meaning and names. Distinct advertiser labels do not prove independent replicas; **unknown inventory remains unknown**, not absent. This is observed advertising, **not** actual Source availability, Hash correctness, durability or data transfer speed.
- Operates only on unique, validated Manifest Chunk sizes; no new wire fields, automatic replication, scheduling, project activation or stored state. CLI already exposes the additive `peerInventoryHealth` object.

## Tests and release boundary

- Focused Swarm test coverage includes all-bytes-known, unknown-inventory-but-successfully-downloaded, duplicate peer labels and known-small/unknown-large Chunk scenarios.
- Record complete peer suite and GitHub CI evidence against the final PR head.
- Physical Windows two-PC, LAN, VPN and Wi-Fi results remain pending; no change to already published immutable r8.

## Rollback

Revert added counters and associated tests/docs without touching trusted Manifest/hash/activation logic.
