# TeamForge Phase 4.5 WP2 — Server Authority Core Report

Date: 2026-08-10 (Asia/Seoul)

## Scope

WP2 extracts only the Phase 0–4 Session Authority state machine from `teamforge-server.mjs`. The input baseline is `Unity-TeamForge-Phase4.5-WP1-characterization-compile-hotfix1.zip`, SHA-256 `979E7AD88CAEDF93E04758A813B57AA2CDB5CA86BFA36D9ED68A71F5F675F26E`.

The user verified that baseline in Unity `6000.3.21f1` with **96/96 EditMode PASS**. That is prior field evidence; Unity was not rerun during WP2.

WP3 Project Coordinator extraction and all later work were not started.

## Research before implementation

The following official specifications, official project documentation and primary paper were reviewed before code changes:

- Node.js ECMAScript Modules: <https://nodejs.org/api/esm.html>
- Node.js Timers: <https://nodejs.org/api/timers.html>
- Node.js `process.hrtime.bigint()`: <https://nodejs.org/api/process.html#processhrtimebigint>
- Node.js event-loop security guidance: <https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop>
- `ws` official API and heartbeat guidance: <https://github.com/websockets/ws/blob/master/doc/ws.md> and <https://github.com/websockets/ws>
- RFC 6455 WebSocket Protocol: <https://www.rfc-editor.org/rfc/rfc6455>
- W3C High Resolution Time: <https://w3c.github.io/hr-time/>
- David Harel, “Statecharts: A Visual Formalism for Complex Systems”: <https://doi.org/10.1016/0167-6423(87)90035-9>

Implementation consequences:

- The existing explicit `.mjs` ESM boundary is retained.
- Authority consumes discrete commands and returns ordered effects, matching a reactive state-transition model without adding a state-machine framework.
- Authority imports no WebSocket/HTTP API, holds no socket, performs no send/close, parses no wire JSON and schedules no timer.
- `ws` payload limit, buffering, heartbeat, upgrade/auth and actual socket calls remain in the host.
- Timer callbacks are treated only as triggers; Node does not guarantee exact timer firing time or ordering. The host samples time and passes `nowUnixMs` explicitly to the transition.
- Protocol v1 exposes `expiresAtUnixMs`, so WP2 preserves the existing epoch-based lease meaning. A monotonic internal deadline was not silently introduced because clock-adjustment behavior would require a separate compatibility decision and tests.
- Existing bounded state/payload checks remain to prevent event-loop and memory amplification. No unbounded queue or per-command state clone was introduced.

Local execution used Node `v24.18.1`, which satisfies the repository requirement `node >=20`.

## Extracted Authority responsibilities

`server/src/session-authority.mjs` now owns:

- Session creation and lifecycle checks;
- Presence join/update/leave and same-user supersede;
- Lock ownership, limits, renewal, release, expiry and cleanup reasons;
- shared Session Revision and retained Transform state;
- stale Transform acceptance, future-revision rejection and lock requirement;
- authoritative Hierarchy seed/operation integration through the existing `hierarchy-model.mjs`;
- Tombstone, parent/subtree Lock conflict and deleted Transform/Lock/Presence cleanup;
- operation fingerprint replay and conflict handling;
- ordered `send`, `broadcast`, `close`, bounded-snapshot and Project-cleanup bridge effects.

## Responsibilities remaining in the host

`server/src/teamforge-server.mjs` retains:

- HTTP health and upgrade handling;
- bearer authentication and timing-safe token comparison;
- WebSocket lifecycle, `maxPayload`, buffering and serialization;
- Hello envelope/capability composition, ping/pong, rate limit and heartbeat;
- timer scheduling and time sampling;
- mapping Authority effects to existing WebSocket clients;
- all existing Project Coordinator registry/transitions and project-peer metadata behavior;
- server start/stop and logging.

## Verification and parity

- Server suite: **63/63 PASS** — 58 existing hierarchy/coordinator/WebSocket/golden tests plus 5 new pure Authority tests.
- WP1 Server characterization/golden tests: **PASS** within the Server suite.
- Project Peer suite: **63/63 PASS**.
- Repository validator: **PASS** after final documentation freeze.
- Server syntax: **PASS**, including the new Authority module.
- Project Peer syntax: **PASS**.
- Server smoke: **PASS** — Presence, Transform, Lock, Project snapshot and Revision 1.
- Project Peer smoke: **PASS** — direct transfer/hash/inventory; `serverRelayUsed=false`.
- Unity EditMode during WP2: **NOT RUN**. Prior WP1 field evidence is **96/96 PASS**.
- Product protocol/golden fixture hashes: unchanged from the WP1 input candidate.

The validator now fails if Authority gains WebSocket/HTTP/socket I/O/JSON parsing/timer dependencies, or if the host directly mutates Session Authority maps.

## Risks and ambiguities

- Project membership still shares the Session container so that the unchanged Coordinator can coexist with Presence. `remove_project_client` is an explicit temporary bridge effect; removing it belongs to WP3.
- Authority owns mutable bounded Maps and is deterministic/I/O-free for a command, but it is not a persistent event log or rollback system. Phase 5 recovery remains absent.
- Lease protocol timestamps remain wall-clock epoch values. A future monotonic internal clock would need compatibility tests for clock jumps and process restart before adoption.
- Snapshot byte safety uses the existing JSON representation for parity. Wire JSON parsing and sending remain host-only.
- JavaScript execution is single-event-loop serialized, but effect application can close sockets and cause later close callbacks. Existing idempotent membership checks and black-box supersede/disconnect tests cover this ordering.

## Boundary

WP2 is complete. WP3 and later work were not started.
