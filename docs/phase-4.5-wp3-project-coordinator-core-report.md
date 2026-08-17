# TeamForge Phase 4.5 WP3 — Project Coordinator Core Report

Date: 2026-08-10 (Asia/Seoul)

## Scope and baseline

WP3 extracts only Project Coordinator validation orchestration and mutable Project/Project-session transitions from `server/src/teamforge-server.mjs`. The exact input is `Unity-TeamForge-Phase4.5-WP2-server-authority-core.zip`, SHA-256 `050F5EC3447656A7AD5B7CFC8962A0EC8A21FA2BA18CAABF835C2EA4AB98C472`.

The user reported that WP2 automated tests and an actual Unity A/B/C smoke were normal. This is prior user field evidence, not a Unity execution performed during WP3. WP4 and all later work were not started.

## Internet research before implementation

Primary and official material reviewed before code changes:

- Node.js Crypto API: <https://nodejs.org/api/crypto.html>
- RFC 8032, Edwards-Curve Digital Signature Algorithm: <https://www.rfc-editor.org/rfc/rfc8032.html>
- RFC 8785, JSON Canonicalization Scheme: <https://www.rfc-editor.org/rfc/rfc8785.html>
- Node.js EventEmitter: <https://nodejs.org/api/events.html>
- Node.js ECMAScript Modules: <https://nodejs.org/api/esm.html>
- Node.js event-loop security guidance: <https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop>
- RFC 6455, WebSocket Protocol: <https://www.rfc-editor.org/rfc/rfc6455.html>
- `ws` official API: <https://github.com/websockets/ws/blob/master/doc/ws.md>
- IETF Idempotency-Key draft: <https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header>
- OWASP WebSocket Security Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html>

Implementation consequences:

- Existing `.mjs` modules remain the boundary; no framework or generalized state-machine library was added.
- Existing Ed25519 SPKI parsing, key-ID hash checks and `crypto.verify(null, ...)` validation remain unchanged and are invoked by the Core.
- TeamForge's existing newline-delimited signed canonical payload remains byte-for-byte unchanged. RFC 8785 was reviewed for deterministic-signing principles but was not adopted because doing so would change Protocol v1 signatures and hashes.
- Each Core command runs synchronously and returns an ordered effect array. The host applies effects immediately, preserving serial publish, supersede and disconnect ordering.
- Publish retry continues to use the existing descriptor identity: the same revision and matching descriptor is idempotent, while the same revision with different descriptor metadata conflicts. No new wire idempotency key was introduced.
- WebSocket upgrade, message parsing, size/rate/buffer limits, heartbeat and actual send/close remain host responsibilities. The Core receives already-parsed bounded commands and has no WebSocket/HTTP/timer API dependency.
- Project payload fields remain rejected and no Server disk write or relay path was introduced.

Local execution used Node `v24.18.1`, satisfying the repository requirement `node >=20`.

## Responsibilities moved to Coordinator Core

`server/src/project-coordinator-core.mjs` now owns:

- mutable Project registry and independent Project-session member registry;
- Project UUID and Owner-key pin validation;
- Descriptor and publisher/owner signature verification orchestration through the existing canonicalization module;
- explicit/recovered Baseline creation and TOFU behavior;
- serial Baseline revision acceptance, downgrade/gap/conflict rejection and idempotent retry;
- peer announce/update/remove transitions and session isolation;
- Owner proof result, compatibility check, seed-rank recalculation and discovery ordering;
- Project sync-required reasoning;
- ordered send, broadcast, close and bounded-snapshot effects;
- registry counts and lifecycle cleanup.

`server/src/project-coordinator.mjs` remains the focused validation/canonicalization primitive module. It retains the existing Protocol v1 canonical bytes, Ed25519 parsing/verification, compatibility predicates and rank comparator.

## Responsibilities remaining in the host

`server/src/teamforge-server.mjs` retains:

- HTTP health/upgrade, bearer authentication and timing-safe token comparison;
- WebSocket lifecycle, `maxPayload`, buffering, serialization and actual send/close;
- JSON parsing, Protocol envelope validation, Hello capability composition and ping/pong;
- rate limiting, heartbeat, connection IDs, time sampling, start/stop and logging;
- mapping Session Authority and Coordinator effects to current WebSocket clients;
- aggregate health representation across the separate Authority and Coordinator session maps.

Project content remains direct `project-peer` HTTP traffic. Manifest/File/Chunk bytes are neither accepted, stored nor relayed by the Server.

## WP2 bridge cleanup and ordering parity

`projectMembers` was removed from Session Authority state. Project membership is now owned only by Coordinator Core. The Project-specific `remove_project_client` Authority effect was replaced by neutral `connection_superseded`; the host composes Coordinator cleanup at the same ordered position.

Preserved same-user combined-client order:

1. release and broadcast stale Authority Locks;
2. remove and, when announced, broadcast the stale Project peer;
3. send `session_superseded` and close the stale connection;
4. publish replacement Presence state and snapshots;
5. register the replacement Project member and send its Project snapshot.

Disconnect still removes the Project peer before Presence cleanup. Both removals are idempotent against later close callbacks.

## Verification and parity

- Server suite: **68/68 PASS** — all 63 WP2 tests plus five direct Coordinator Core tests.
- WP1 golden/characterization coverage: **PASS** within the Server suite.
- WP2 Session Authority tests: **PASS** within the Server suite.
- Project Peer suite: **63/63 PASS**.
- Server syntax: **PASS**, including `project-coordinator-core.mjs`.
- Project Peer syntax: **PASS**, 34 modules.
- Server smoke: **PASS** — health, legacy Hello, ping, Presence, Transform, Lock, Project snapshot and Revision 1.
- Project Peer smoke: **PASS** — direct transfer, Descriptor/Manifest hashes and inventory; `serverRelayUsed=false`.
- Repository validator: **PASS** after report/changed-file creation and final packaging checks.
- Unity Editor/EditMode during WP3: **NOT RUN**. No Unity PASS is claimed for this WP.

The existing black-box Coordinator tests passed without expected-message changes. Golden fixture JSON and Protocol v1 schema/version were not edited. The direct Core tests additionally freeze session isolation, supersede effect order, serial/idempotent publish, TOFU rank 0 reconstruction and established Owner pin rejection.

## Risks and ambiguities

- Registry state remains memory-only and is lost on Server restart. Persistent recovery is Phase 5 and was not started.
- JavaScript transitions are synchronous on one event loop. Signature verification and scans are bounded by existing message/registry limits, but large future limits could increase event-loop latency.
- Protocol-visible timestamps remain wall-clock epoch values. WP3 did not introduce a monotonic wire timestamp or change timestamp meaning.
- A valid compatible signed peer announce can reconstruct registry state after restart under the existing TOFU rule. This behavior is preserved, not expanded; deployment trust policy remains important.
- Core effects refer to connection IDs. The host remains responsible for the race where a connection disappears before an effect is applied; existing safe-send and idempotent removal behavior is retained.
- RFC 8785 is not the TeamForge Protocol v1 canonicalization format. A future migration would require a new compatibility decision/version and cross-implementation golden fixtures.

## Candidate and boundary

Candidate: `Unity-TeamForge-Phase4.5-WP3-project-coordinator-core.zip`. Its SHA-256 is recorded in the adjacent `.sha256` sidecar and release handoff because embedding an archive hash inside that same archive is circular.

WP3 is complete. WP4, Transport abstraction, Connection Strategy, Policy/Profile, Transfer Core changes, WebRTC, Phase 5 and `project-peer` replacement were not started.
