# TeamForge Project Peer

Project Peer implements direct Project bootstrap/transfer and Host/Guest orchestration around TeamForge's Project trust, integrity, staging and activation model.

This module README describes **Project Peer responsibilities and source operation**, not current release readiness. Use [STATUS.md](../docs/STATUS.md) for live readiness and [`release-contract.json`](../release-contract.json) for exact runtime/protocol/dependency selections.

## Core boundary

Project payload bytes move directly between Project Peer processes over HTTP. They do **not** pass through the TeamForge Server/Coordinator.

Project Peer owns:

- signed bootstrap/Collaboration Invite validation;
- Host and Guest orchestration bridges;
- deterministic Project manifests and content hashes;
- descriptor/manifest/inventory/chunk transfer;
- retry/resume/source selection/failover behavior;
- filesystem/path safety checks;
- staging and verified immutable Active revisions;
- explicit Project/Owner/Publisher trust checks;
- final verified handoff information for the Launcher/Unity flow.

It does not own realtime Scene authority or silently replace Project trust/identity because a transfer succeeds.

## Developer commands

```powershell
npm.cmd --prefix project-peer ci --ignore-scripts --workspaces=false
npm.cmd --prefix project-peer run check
npm.cmd --prefix project-peer test
npm.cmd --prefix project-peer run smoke
node project-peer/src/cli.mjs --help
```

These commands are for source development and advanced diagnostics. Normal packaged Guests use the Windows Launcher and verified bundled Runtime instead of manually running the CLI.

Exact supported Node/npm/dependency selections belong to [`../release-contract.json`](../release-contract.json).

## Host contract

The Unity Host bridge uses `src/host-orchestrator-cli.mjs` over bounded NDJSON.

Before a normal Host flow becomes ready, it should require the relevant verified Project/Scene baseline, realtime session, Project/Publisher identity/trust and signed Collaboration Invite contracts.

The local listen/bind address is distinct from the concrete Guest-reachable advertised address. Wildcard/unspecified/loopback addresses must not be silently advertised as remote two-PC Guest destinations.

The direct Seed exposes Project payload through the Project Transfer path. Internet discovery/NAT traversal/relay must not be inferred from the word `P2P`.

## Guest contract

The packaged Windows Launcher starts the Guest bridge from a verified Runtime.

The Guest flow validates the bootstrap envelope, signed transfer contract, Project/Owner/Publisher trust, transfer integrity, Active revision and final Unity handoff before the received Project is treated as launchable.

Recovery must not bypass:

- invitation/signature validation;
- Project/Owner/Publisher trust;
- manifest/file/chunk hashes;
- filesystem/path policy;
- staging and immutable activation;
- final Unity handoff validation.

## Direct transfer

Important source areas:

- `src/direct-transfer-server.mjs` — descriptor/manifest/inventory/chunk source;
- `src/direct-transfer-client.mjs` — direct HTTP source adapter, retries and normalized transport errors;
- transfer/downloader code — concurrency, pacing, resume, retry and source/failover logic;
- `src/content-store.mjs` — content-addressed storage primitives;
- `src/filesystem-safety.mjs` — path/filesystem safety primitives.

Transport success is not the same as activation success. Received content must pass the complete verification/trust/activation policy before becoming the current Active Project.

When every eligible Seed is exhausted for a chunk, the download cancels sibling HTTP requests and pacing/cooldown waits, settles all workers, and reports the original terminal failure. Caller pause/cancel still reaches the same worker group. A recoverable Seed failure continues through the bounded retry/failover path; already verified stored chunks remain available for resume.

## Session-local transfer measurements

`SwarmDownloader.download()` returns per-peer `chunkAttempts`, `verifiedBytes`,
`successfulRequestMilliseconds` and `requestServiceBytesPerSecond` in `peers`;
advanced CLI `sync` includes these as `peerMetrics`. Counts reset for each download.
Only chunks accepted after SHA-256 verification and storage contribute bytes and
successful request time. Locally resumed chunks contribute neither. The monotonic
request timer excludes pacing, cooldown, hashing and disk writes.

The rate divides verified bytes by summed successful request service time, including
any overlapping requests separately. It is a comparison signal, **not aggregate
link throughput**. Failed requests count as attempts but do not contribute to that
rate; zero measured service time reports zero. Scheduling and concurrency remain
unchanged; adaptive scheduling requires a separate matched benchmark.

## Repeatable loopback transfer benchmark

Run `npm --prefix project-peer run benchmark:transfer -- --size-mib 8 --iterations 3`
for bounded JSON evidence, or add `--smoke` for a small integrity check. The
fixture uses generated content, signed metadata, real loopback HTTP transfers,
and the production downloader/store. It rotates four cases: one Seed, two Seeds,
two Seeds with the first quarter of unique chunks preloaded, and two Seeds with
chunk unavailability injected at the first client's request boundary. The
surviving client still uses real HTTP; this injection is not a physical outage.

All cases use concurrency four and the same aggregate offered server byte cap
(8 MiB/s, divided across Seeds). Source loss removes that Seed's capacity. Resume
reports actual reused bytes, which need not be exactly a quarter of file bytes.
Elapsed download time includes inventory, resume validation, network work and
verified storage; fixture creation, metadata discovery, resume preload and the
final read-back audit are excluded. Each case audits every stored chunk's hash.

Defaults are 8 MiB and three iterations; limits are 32 MiB, five iterations and
30 seconds per case after server setup. Destinations and loopback listeners are
removed after use. Output contains no endpoint, transfer token or absolute path.
There is no timing pass threshold: loopback medians help compare controlled
experiments, and cannot establish LAN/VPN performance or justify scheduler changes.

## Windows path-resilience boundary

`src/path-resilience-contract.json` is the shared source-side path-risk contract used by Project Peer/Launcher policy.

A TeamForge-owned short execution alias may be accepted only through the separate identity/path validation contract. Supporting that narrow verified case does **not** make arbitrary external symlinks/junctions/reparse points valid Project roots.

Canonical verified Active Project identity remains distinct from the execution alias used to keep a Unity-visible path within a supported budget.

## Advanced CLI

```powershell
node project-peer/src/preflight-cli.mjs inspect --workspace-root <absolute-candidate>
node project-peer/src/cli.mjs publish --launch-settings <absolute-json> --confirm-publish
node project-peer/src/cli.mjs seed --launch-settings <absolute-json>
node project-peer/src/cli.mjs sync --invite <signed-project-invite-file>
```

Publishing remains an explicit action. Secrets/private keys/access codes should not be embedded into public Collaboration Invite/launch-setting data or logs.

## Runtime-only package boundary

Generated bundled Runtime content is a release artifact and is intentionally absent from a normal public source checkout.

Use the public-source validator for a normal checkout. The stronger release validator expects a fully staged candidate tree with generated Runtime/Launcher/release evidence.

See [SOURCE.md](../docs/SOURCE.md) for validation workflow, [architecture.md](../docs/architecture.md) for the complete topology/trust boundaries, and [CODEMAP.md](../CODEMAP.md) for file-level navigation.
