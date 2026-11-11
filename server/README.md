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

### WP6 complete saved-Scene Collider observation gate (local-only)

`src/component-collider-completeness.mjs` adds a strict gate ahead of
the existing **local simulation**, not a general-purpose source of truth:
`inspectCompleteSavedColliderObservation` checks that a genuine
same-Session, same-revision prepared Component identity baseline has **one
exact, complete set** of three typed `SerializedProperty` observations for
**every** supported saved `BoxCollider`/`SphereCollider`. It rejects unknown
Component types, non-Scene or Prefab-backed IDs, missing Scene/owner
membership, missing/extra/incorrect property paths, broad-but-insufficient
prototype policies, negative sizes/radii, nonfinite/out-of-range values,
duplicate or absent observations, 512+1 supported Components and cross-Session
or stale clones. The result contains bounded counts and existing canonical
fingerprints, not any claim that a network peer supplied verified project
bytes. A separate `seedCompleteSavedColliderTransactionForLocalTest` only
enters the previously isolated simulator **after** that check passes; the
older generic simulator API is unchanged for other experiments.

This is a **completeness** predicate, not Publisher-signature attestation,
saved Unity Scene file provenance, Editor authorization, wire dispatch or
live Inspector mutation. In particular, passing it does not prove the
prepared observations reflect a real Project. No new packets, locks,
revisions or Unity edits are enabled. See
`test/component-collider-completeness.test.mjs` for both negative and
local commit-simulation evidence.

### WP6 Ed25519 Publisher approval of a complete local observation (source only)

`src/component-publisher-observation-approval.mjs` extends the **strict**
complete local Collider gate above with a narrowly scoped Publisher
**approval signature**. For a server-owned active Editor connection present
in both the Project Coordinator and realtime Session Authority registries,
it re-verifies the currently registered signed Project Baseline Descriptor
and Owner-authorized Publisher key. The signature is domain-separated and
binds Project ID/UUID, Session ID, exact current connection ID, published
Baseline revision and manifest/descriptor hashes, Scene GUID, realtime
revision and SHA-256 of the already-prepared exact Component identity and
property fingerprints. Ed25519 signatures must be canonical base64.
Cross-Editor replays, cloned/malformed approvals, stale Baselines,
altered observation values or Publisher keys fail closed. No property
values or signing keys are included in the approved result.

The result explicitly says
`publisher_approved_local_observation_scene_bytes_unverified`.
**Crucially, a signature is approval by a Publisher key holder, not proof
that observed values match the signed Project manifest's actual Unity
Scene bytes.** The Project Coordinator's manifestHash authenticates the
published manifest, but does not itself bind an independently signed
Collider fingerprint to a file's parsed Scene contents. This source-only
helper neither sends nor receives a new protocol message, installs a
trusted property transaction, writes a Component, persists credentials,
starts Undo or grants authority. It has no automatic Unity editor
signature producer. Tests use ephemeral generated test-only keys and
registered in-memory Coordinator/Session fixtures; see
`test/component-publisher-observation-approval.test.mjs`.

### WP6 Publisher-bound local Collider ledger lifecycle (source-only)

`src/component-publisher-ledger-lifecycle.mjs` is a **strictly
disconnected** experimental integration of the existing
Publisher-signed **complete** Collider observation with the
existing Session-authoritative **local** property transaction.
It does not add a new server packet or claim real Unity Editor
Scene-byte provenance.

`beginPublisherApprovedColliderLedgerForLocalTest` accepts only
the genuine prepared same-Session identity/property snapshot,
currently registered real Project Coordinator and realtime
Session Authority connection, current Owner-authorized Publisher
Ed25519 approval and bounded allowlisted property policy.
After full verification, it seeds the existing local transaction
*once* and returns an opaque WeakMap-backed handle. Cloned handles
and invalid signatures cannot create or use a ledger.

`commitPublisherApprovedColliderLedgerForLocalTest` rechecks
the **current exact Project and realtime membership**, the signed
Baseline revision/hash/Owner/Publisher pin, and current seeded
Session ledger **for every operation**. A rotated/revoked
Publisher/Baseline, changed connection or unrelated Session
revision is detected on the next inspection/commit or approved begin;
that operation retires the stale local ledger and requires a fresh signed
observation. A still-valid ledger cannot be silently replaced. Each seed
has an opaque transaction identity so a retired Publisher handle cannot
operate on, or delete, an independently re-seeded ledger. The existing
transaction retains ownership of
the shared revision, per-object lock/expiry, typed target,
operation history and matching replay. It returns the actual
server-created applied record; a client cannot supply an
`applied` receipt or force a new revision through this helper.
Successful results explicitly expose `sceneBytesAttested: false`.

An existing historical committed revision cannot be undone
simply by deleting this *local* ledger: retirement removes its
preview/seed state but leaves the Session history unchanged.

`inspectPublisherApprovedColliderNextDeliveryForLocalTest` is the
next **receiver-side delivery-order contract** in the same disconnected
simulator. It accepts a current registered Project+Hierarchy-capable
recipient connection object and a *caller-supplied known revision
cursor*. The original Publisher/Project ledger is revalidated for
every read. The function emits **at most one** exact server-authored
`component_property_applied` record for `knownRevision + 1`, using
the original in-memory ledger's committed-record identity and current
Session operation history. It never synthesizes a missing intermediate
revision, rewrites the shared operation history, trusts a client-sent
`applied` record or sends a WebSocket message. A missing/overwritten
revision or an invalid cursor requests `resnapshot_required` rather
than pretending the client is synchronized. Output is bounded to
8 KiB, tied to the recipient's active connection ID and pinned
Project/Session/Baseline, and explicitly marks
`sceneBytesAttested: false`.

**Important:** a recipient saying it knows revision N is not evidence
that its Unity Scene applied revisions through N. Neither the
`publisher_bound_local_next_applied_unverified` result nor the
`publisher_bound_local_delivery_current_unverified` status is a
signed delivery receipt, a trusted ACK, or a command that may be
applied to a live Unity Scene. Actual Editor source attestation,
authenticated opt-in transport, post-apply verification, Undo,
reconnect and recovery remain separate WP6 gates.

`inspectPublisherApprovedColliderReceiverObservationForLocalTest`
adds a bounded **full-state reconciliation classifier** in that
disconnected simulation. The recipient must be the same exact
registered Project/Session member as for ordered delivery, and
the observation must be a private-registry-prepared, same-Session,
same-revision **complete** saved-Scene Collider snapshot. It
compares every exact Component/owner/property identity and typed
value against the current server-created ledger (not just a
peer-supplied digest or cursor). A missing or extra property,
stale revision, changed project baseline or forged snapshot
fails closed; changed values produce a mismatch count and
`manual_reconcile_required`, **not** automatic overwrite.
Exact equality reports
`publisher_bound_local_receiver_observation_matches_unverified`
with a deterministic server-ledger fingerprint and explicit
`editorApplyVerified: false` / `sceneBytesAttested: false`.

This remains an offline *simulation*. A malicious remote client
could claim to have observed matching values, and a trusted
same-process test can construct those prepared snapshots. A
matching comparison never increments a receiver's cursor,
records an ACK, proves Unity Undo/reimport state, or enables a
network Inspector write. Real post-apply success requires a
separately authenticated Editor/source evidence channel and
reconnect repair logic.
Do not wire this helper into WebSocket or Unity Inspector apply.
Publisher approval by itself does **not** prove a Collider snapshot
matches signed `.unity` Scene content; it does not bind the
Project Peer source witness to this Session, or authenticate
actual Editor delivery/Undo, lease epochs or reconnect. The
implemented handle is **not a production security token**;
it exists only inside disposable in-memory integration tests.
See the publisher-observation test suite's lifecycle cases.

### WP6 signed Scene source ↔ Publisher observation *monorepo test bridge*

The monorepo test-only helper
`../scripts/wp6-source-approval-bridge.mjs` connects the two
independently verified experiments for the first time. It does not
accept a claimed Scene-file hash: it derives a current Server-owned
Project/Owner pin, checks a current registered Publisher's signed
complete Collider observation, then calls the **real Project Peer**
signed Scene/.meta byte verifier against stored content-addressed
chunks and rechecks Publisher/Session/Baseline authority after the
asynchronous file reads. Success is explicitly
`signed_scene_bytes_and_publisher_observation_same_baseline_values_unverified`.

That result proves both pieces refer to the same signed Baseline
and Scene GUID **not that their Collider property values correspond**:
the latter still requires an authenticated Unity serialized-value
witness. The helper is not imported by production Server runtime and
does not create a WebSocket route or grant write permissions.
See `test/wp6-project-source-approval-bridge.test.mjs` and
`../docs/work-state/WP6_CROSS_SOURCE_APPROVAL_BRIDGE_2026-11-09.md`.
This integration branch depends on both #511 (Project Peer) and
#517 (Publisher-approved Server reconciliation).

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
with Hierarchy capability. Its validated `SessionAuthority` entrypoint is
`inspectComponentRecoveryPreview`. It is used by the **explicitly negotiated**
read-only WebSocket preview handler, but has no generic mutation/seed dispatch
command; default and legacy sockets never gain that read capability.
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
sessions**: an opted-in request with no authoritative Hierarchy Scene seed
returns `component_recovery_scene_unseeded`; after a legitimate Hierarchy
seed, a request returns `component_transaction_unseeded`. Neither case may
fabricate Inspector data or modify Unity state.
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
