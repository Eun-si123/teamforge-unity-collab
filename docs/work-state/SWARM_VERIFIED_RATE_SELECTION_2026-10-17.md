# TeamForge — opt-in verified-throughput source selection (2026-10-17)

## Scope

- Advanced Project Peer `sync --peer-selection verified-throughput` chooses among eligible direct transfer peers using **only verified stored chunk service-rate samples** within a single download.
- Default `balanced` preserves original selection and original Windows Launcher/Unity behavior. No protocol/schema/manifest, signature, trust, path, activation or worker concurrency change.
- Hard cooldown and error/availability checks remain first. Compare observed rates only where failure count and in-flight pressure tie. Initial eligible sources receive sampling opportunity; every eighth chunk uses legacy order as bounded exploration.
- Faster in the source-rate estimate is not proof of faster total transfer. Deterministic tests assert selection and existing integrity/failover, **not** throughput benefit.
- Unknown or unverified content never earns rate credit. An explicit unsupported option fails closed before download.

## Evidence gates

- Focused `node --test project-peer/test/swarm-downloader.test.mjs` — 27 pass on Node 24, including opt-in rate selection, corrupt source failover and option rejection.
- Bounded comparison: `npm --prefix project-peer run benchmark:transfer -- --smoke --peer-selection verified-throughput`, against default `--smoke`. JSON identifies the selection mode.
- Full Project Peer suite, source and engineering validation, GitHub CI should be recorded as completed or pending against the **actual** PR commit.
- Later: same immutable candidate with LAN/Wi-Fi/VPN single/multi-seed downloads on two PCs, comparing equal fixture, connectivity, concurrency, total bytes, verified hashes and error/recovery behavior; preserve negative results.

## Rollback

Switch to default `balanced` (omit the option); revert the targeted source/README/tests if necessary. Packaged r8 is unchanged. This is **not** automatic adaptive concurrency, complete Swarm Health, live Unity Inspector sync, or a release-readiness claim.
