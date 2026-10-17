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

**Source-only Host commit diagnostics:** a failed `commitHost` response additionally
provides an optional fixed `failure.stage` identifier such as
`start_coordinator`, `read_coordinator_baseline`, `restore_approved_baseline`,
`start_or_publish_seed`, or `verify_seed_registration`. It describes the last
Host operation boundary reached, **not** the underlying network or firewall root
cause; the original stable `rawCode`, failure kind and recovery action stay
unchanged. The stage is not an endpoint, credential or captured exception.
Existing released r8 Host bytes do not include this source update.

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

## Coordinator lifecycle

Overlapping `CoordinatorClient.connect()` calls share one handshake. A reconnect
requires a fresh Project registry snapshot; a previous connection's identity,
snapshot and outstanding requests are cleared on close. Late messages or close
callbacks from a retired transport cannot alter its successor. Closing during
the handshake settles it immediately rather than waiting for the deadline;
failed handshakes release their transport and preserve the original error code.
The long-running Seed still reconnects and re-advertises after Coordinator loss.
Invalid advertised Host configuration releases a bound Host or partial Guest
Seed before returning the error, so retrying does not leave an orphan listener.

## Direct transfer

Important source areas:

- `src/direct-transfer-server.mjs` — descriptor/manifest/inventory/chunk source;
- `src/direct-transfer-client.mjs` — direct HTTP source adapter, retries and normalized transport errors;
- transfer/downloader code — concurrency, pacing, resume, retry and source/failover logic;
- `src/content-store.mjs` — content-addressed storage primitives;
- `src/filesystem-safety.mjs` — path/filesystem safety primitives.

Transport success is not the same as activation success. Received content must pass the complete verification/trust/activation policy before becoming the current Active Project.

When every eligible Seed is exhausted for a chunk, the download cancels sibling HTTP requests and pacing/cooldown waits, settles all workers, and reports the original terminal failure. Caller pause/cancel still reaches the same worker group. A recoverable Seed failure continues through the bounded retry/failover path; already verified stored chunks remain available for resume.

Retry budgets and exhaustion belong to each source instance, even if two sources
share a display label. Duplicate labels cannot hide a healthy fallback or turn
exhausted discovery into an internal error. Inventory-health replica counts and
speculative Endgame requests still treat a repeated label conservatively.

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
rate; zero measured service time reports zero. By default, scheduling and
concurrency remain unchanged. For a **manual experimental comparison**,
the advanced `sync` CLI accepts
`--peer-selection verified-throughput` (default: `balanced`).
The opt-in scheduler uses only current-download, hash-verified per-peer chunk
service rates to prefer demonstrably faster healthy sources **when retry,
cooldown and in-flight pressure are equal**, and periodically retains the
legacy selection order to avoid locking out an eligible source. Every source
starts unmeasured; corrupt/missing chunks earn no throughput credit. Unsupported
modes fail closed. This does **not** adapt worker concurrency, modify trust or
activation, promise aggregate bandwidth, or change the default Windows
Launcher/Unity handoff. Use matched real-world benchmarks before considering
this a speed improvement or a default behavior.

An additional **opt-in Chunk scheduling order** is available to the advanced
`sync` CLI as `--chunk-order rarest-first` (default: `manifest`).
After already-verified local Chunk resume is accounted for, the experimental
scheduler attempts Chunks with fewer **distinct eligible known advertisers**
first, and preserves original Manifest order for ties. A Chunk absent from all
known inventories but potentially available from an eligible *unknown* inventory
is **not** falsely counted as zero-replica; existing source/Hash validation,
retry and abort rules remain unchanged. Known advertiser counts are an
untrusted scheduling hint, **not verified durability or a recovered proof of
content**. This mode can be combined with `--peer-selection verified-throughput`.
Neither option changes the normal Windows Launcher/Unity path or promises a
measured speedup.

For a separate **experimental concurrency-admission** comparison, the
advanced CLI accepts `--concurrency-mode adaptive` (default: `fixed`).
Adaptive begins with **one** active Chunk job and raises the limit by one
after `2 × current_limit` verified Chunk completions, up to the
`--concurrency` ceiling (1..64). Any failed Chunk attempt halves the
current new-job admission limit (rounded up) and resets the success count.
Existing in-flight attempts are not cancelled or force-retried on adjustment;
the original per-Seed retry/cooldown/Hash/activation checks still decide
whether bytes are safe. Each download starts fresh, with no learned profile
saved across sessions, and the default Windows/Unity Launcher remains
unchanged.

For an optional, bounded **Endgame Mode**, advanced `sync` accepts
`--endgame-mode hedged` (default: `off`). On at most the **final two pending
unique Chunks**, if the selected source has not returned a verified Chunk after
180 ms, it may issue one speculative request to a second *distinct eligible*
Seed. Both replies must match the signed Manifest Chunk length and SHA-256;
only the **first verified** response is stored and announced once, and the
other request is cancelled and settled. A fast primary request, only one
eligible source, or repeated identical Seed IDs do **not** trigger duplication.
Locally verified resume chunks are never re-requested. All existing pacing,
cooldown, retry, cancellation, trust and activation checks still apply.

The read-only `endgame` summary reports `mode`, `speculativeRequests`,
and `speculativeWins` without reporting secrets or URLs. Extra requests can
waste data or CPU; the prototype does **not** promise a faster connection,
generalized torrent endgame or reliable physical speedup. The packaged r8
Windows and Unity Launcher behavior remain unchanged.

The read-only `concurrencyControl` result/CLI JSON exposes
`mode`, `ceiling`, `startingLimit`, `finalLimit`, `peakLimit` and
`reductions`. Limits measure simultaneous *Chunk jobs*, not raw network
sockets or assured bandwidth, and the controller does **not** currently
infer optimal network throughput, latency, battery usage or congestion.
Use matched throughput, completion, failure and resume measurements before
claiming any physical performance benefit.

The same `download()` result now includes `peerInventoryHealth`, also printed
in the CLI's sync JSON output. This **advertised-inventory coverage** counts
manifest-validated unique Chunks covered by known Seed inventory listings,
single/multiple distinct advertiser labels, and inventory sources whose listing
could not be read. A duplicate peer label cannot inflate the multi-advertiser
count. `unadvertisedByKnownPeersChunks` means only that no *known inventory*
advertised the Chunk: unknown inventory sources might still serve it, and even
an advertised Chunk can fail real retrieval/hash verification. Byte-weighted
counterparts (`totalUniqueBytes`, `advertisedBytes`,
`unadvertisedByKnownPeersBytes`, `singleAdvertiserBytes`,
`multipleAdvertiserBytes`, `advertisedByteCoveragePercent`) reveal
whether missing/weakly advertised Chunks represent a disproportionate share
of the actual Manifest bytes. They use **unique Manifest Chunk sizes**, not
on-wire traffic or proven stored replicas. This is not a proven Swarm
durability percentage, scheduling input, transfer success promise, protocol
change, or trust substitute.

## Repeatable loopback transfer benchmark

Run `npm --prefix project-peer run benchmark:transfer -- --size-mib 8 --iterations 3`
for bounded JSON evidence, or add `--smoke` for a small integrity check.
Add `--peer-selection verified-throughput`, `--chunk-order rarest-first`,
`--concurrency-mode adaptive`, `--endgame-mode hedged` or combinations
to run the **same bounded scenarios** with experimental scheduling. The JSON
configuration records each mode and per-run concurrency/endgame telemetry. Compare separate balanced/opt-in runs under equivalent load rather than
treating a synthetic loopback median as a physical speed claim. The
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
