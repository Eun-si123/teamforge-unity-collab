# TeamForge Server

The TeamForge Server is the authoritative realtime/session coordinator and signed Project-metadata coordinator.

This module README describes **server responsibilities and source operation**, not current release readiness. Use [STATUS.md](../docs/STATUS.md) for live readiness and [`release-contract.json`](../release-contract.json) for exact runtime/protocol selections.

## Responsibilities

The server owns:

- HTTP health and WebSocket hosting;
- authentication for configured listeners;
- in-memory Presence/session membership;
- shared Revision ordering;
- Transform and supported Hierarchy authority;
- lock/lease ownership;
- bounded replay/idempotency/tombstone state;
- signed Project/Owner/Publisher/Baseline/Peer metadata coordination.

The server does **not** own:

- Project Manifest/File/Chunk payload storage;
- Project payload relay;
- Unity filesystem activation;
- durable session persistence or restart recovery;
- automatic Internet discovery/NAT traversal/relay.

Project payload bytes move directly between Project Peer processes.

## Developer commands

```powershell
npm.cmd --prefix server ci --ignore-scripts --workspaces=false
npm.cmd --prefix server test
npm.cmd --prefix server run smoke
npm.cmd --prefix server start
```

Use [`../release-contract.json`](../release-contract.json) for the exact supported developer Node range, bundled Runtime selection and production dependency versions rather than copying them into this README.

## Listen and authentication

Direct source execution reads:

- `TEAMFORGE_HOST` — bind host, default `127.0.0.1`;
- `TEAMFORGE_PORT` — listen port, default `5080`;
- `TEAMFORGE_AUTH_TOKEN` — shared Bearer access code;
- `TEAMFORGE_HEALTH_PATH` — default `/health`;
- `TEAMFORGE_WS_PATH` — default `/ws`.

The packaged Host flow keeps the local bind address separate from the concrete Guest-reachable advertised address. Wildcard addresses are bind values, not remote Guest destinations.

A non-loopback listener requires authentication according to current policy. The shared access-code model is intended for a trusted team/LAN/VPN environment, not an untrusted public-Internet identity system.

## Authority / state boundary

- Session authority and Project Coordinator registries are currently memory-resident.
- The Session Authority core owns collaboration transitions; the socket host should execute effects rather than duplicate authority rules.
- The Project Coordinator carries signed metadata and coordination state, not Project payload bytes.
- Server restart persistence and durable old-session recovery are separate future capabilities.

## Networking boundary

Current Project Peer payload transfer requires direct peer reachability. The Server does not imply or provide WebRTC, ICE/STUN/TURN, relay, discovery, NAT traversal or automatic transport fallback.

See [architecture.md](../docs/architecture.md) for the complete topology and authority/trust boundaries.

## Disconnected WP6 Component identity experiment

`src/component-foundation.mjs` validates canonical saved Scene Component
GlobalObjectIds before the separate structural/property candidate validators.
It requires identifier type `2`, a non-null Scene GUID, a nonzero local file ID
and canonical decimal local/prefab IDs within Unity's unsigned 64-bit range.
It preserves full file-ID precision as strings; null/asset IDs, leading zero
aliases and overflowing values are refused rather than normalized.

`src/component-operation-preflight.mjs` separately classifies structural and
typed property retries in the Session-wide operation-ID namespace. Property
identity includes the exact path, kind and value; Vector3 axis order is
canonical and JSON numeric zero semantics are preserved. A matching fingerprint
also needs a complete, consistent hypothetical applied record; no ACK is returned.
`src/component-authority-preflight.mjs` checks current registered membership,
the prepared baseline and exact policy, and an owned unexpired Scene/GameObject
lease for new candidates. A replacement connection needs its own authoritative
lease. These read-only checks reserve nothing and cannot commit an edit.

`src/component-property-foundation.mjs` can also prepare a same-Session frozen
typed property snapshot and inspect one exact target. Snapshots reject duplicate
Component/path records and apply explicit count policy plus prototype ceilings
of 2,048 records and 256 KiB canonical UTF-8 bytes. Target lookup revalidates the
current revision, owner and typed policy; it never substitutes another property
or returns a repair message. Values remain local prototype test data, not a live
authoritative seed. See `test/component-property-snapshot.test.mjs` for byte/count,
identity, immutable-value and target-isolation evidence. The same module can
compare two genuine snapshots prepared for the identical Session, revision and
Component baseline, reporting immutable changed and observed-only records. This
comparison rechecks current owner and typed policy; absence in one partial
observation is not deletion, and comparison is not a cross-revision repair,
network ACK or Unity operation.

The same disconnected module additionally supports a **three-way observation**
of one locally prepared baseline plus independent local and remote observations
from the exact same Session, revision and Component baseline. It reuses the
pairwise owner/policy/identity checks, reports immutable
`observedLocalOnly`, `observedRemoteOnly`, `observedConvergent`,
`observedDivergent` and `observedIncomplete` records, and counts unchanged
properties. **Missing** properties are incomplete evidence, not deletion.
Even 'convergent' is an observation, not permission to commit, ACK, merge,
repair or perform an Inspector write; future runtime authority and Unity
reconciliation remain separate work.

A separate **local-only** stateful experiment in
`src/component-property-transaction.mjs` now models a bounded *atomic*
property commit after a genuine same-Session prepared property seed. It
requires an authenticated, currently registered writer holding a live
Scene/object lock; known exact Component/property identity and typed policy;
a current shared revision; and a new Session-wide operation ID. Only its own
previously committed result can be replayed. It advances the shared Session
revision and stores an operation history entry, while rejecting stale or
externally advanced seeds, collisions and full history without evicting
unrelated operations. Explicit retirement drops only the local simulator ledger;
it retains committed Session revision/history and requires a fresh verified seed. A property cannot be introduced without a verified
seed; values are cloned and snapshot size is bounded. Automated regression
tests are in `test/component-property-transaction.test.mjs`.

The `SessionAuthority` now also has explicit `*ForLocalTest` methods to
exercise this transaction against an **actual registered Session** with
Hierarchy seeding, a live Transform lock and the shared Session revision.
The adapter checks active session membership and Hierarchy capability before
committing; a normal Transform update invalidates an older Component view
until an explicit retirement/reseed. These methods do not appear in
`dispatch()` or the WebSocket routing table and emit no Component packets to
connected peers. `test/component-session-adapter.test.mjs` tests the
integration and negative compatibility/absence of an exposed operation.

The separate `src/component-property-recovery-preview.mjs` provides a
**read-only, local Session recovery preview** for a valid registered editor
with Hierarchy capability. Its `SessionAuthority` adapter is named
`inspectComponentRecoveryForLocalTest` and is **not** in the command router.
A caller provides a canonical Scene, request ID, last observed revision and
optional 64-character SHA-256 fingerprint. The preview returns a deterministic
fingerprint and immutable known property observations; it omits repeated data
only when both the revision **and** fingerprint match. Responses are bounded
by a configurable UTF-8 byte ceiling (maximum 256 KiB). Unknown/replaced
connections, non-Hierarchy peers, wrong Scenes, malformed requests and
externally advanced Session revisions fail closed. These values come from a
local experimental fixture seed and are **not a network-backed, authoritative
late-join snapshot**, nor proof that a Unity client may apply them. Regression
coverage includes matching retries, content mismatch, late read after a local
commit, cross-user membership, revoked connections, hostile request shapes,
size limits and unrelated Transform activity.

### Opt-in read-only Component recovery preview transport (source only)

The WebSocket Server now exposes a narrow **read-only** request path solely for
an explicitly enabled developer server and a Hierarchy-capable client that
explicitly requests it. Production/default creation leaves it off.
A source caller must pass `createTeamForgeServer({ enableComponentRecoveryPreview: true })`;
there is **no environment variable, packaged default or automatic activation**.
The client must also send `supportsComponentRecoveryPreview: true` in
`hello` along with Presence, Transform and Hierarchy support. The Server
returns `componentRecoveryPreviewEnabled: true/false` only for such an opt-in
request; legacy Hello replies and existing `supportsComponentSync` /
`supportsInspectorSync` spoofing semantics remain unchanged.

After an accepted, negotiated Hello, a client may send exactly:
`{ "type":"component_recovery_preview_request","protocolVersion":1,
"requestId":"...","sceneId":"...","knownRevision":0,
"knownFingerprint":"" }`. Server membership, field validation and a
64 KiB per-response limit are enforced before any reply. The read-only result
uses type `component_recovery_preview` with status
`local_preview_resnapshot` or `local_preview_unchanged`; denial is a normal
correlated `error` message. The request is `unsupported_message` unless
both sides opted in. **No Component/property seed exists in deployed socket
sessions**: an opted-in request currently returns
`component_transaction_unseeded`, never invented Inspector data.
No client can upload a trusted seed over the socket and no Component write
or Unity/Undo operation is accepted. See
`test/component-recovery-wire.test.mjs` for real WebSocket negative
compatibility and explicit-opt-in coverage.

The local transaction experiment still has **no WebSocket mutation handler**,
and its seed remains a trusted local fixture, not a verified Component baseline
received from Unity. An explicit opt-in only activates the narrow read-only
request/denial path, not Component synchronization, automatic resnapshot,
Undo/rejection rollback, cross-peer changes or a packaged feature. A future
release requires authenticated initial Component state, Scene/component
provenance, client reconciliation, late-join tests and versioned compatibility.

The identity check is format validation, not proof that an ID resolves to the claimed
Component, owner or trusted project. A prefab-instance ID does not enable
Prefab editing. Existing pre-wire classifiers cannot enable any Component
write; the optional read-only recovery request does not mutate Unity or
the Session. See
[the WP6 roadmap](../docs/ROADMAP.md#wp6-narrow-component--inspector-foundation)
for the remaining authority, identity and reconciliation prerequisites, and
[Unity's GlobalObjectId reference](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/GlobalObjectId.html)
for the native identity format.
