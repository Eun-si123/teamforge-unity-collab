# TeamForge Phase 4.5 WP1 — Characterization / Golden Compatibility Report

Date: 2026-08-10 (Asia/Seoul)

## Scope

WP1 freezes current Phase 0–4 behavior as executable compatibility evidence before any refactoring. It adds test/fixture/validator sources only.

Baseline:

- Closure artifact: `Unity-TeamForge-Phase4-v0.5.0-closure.zip`
- Closure SHA-256: `4453D67CD13A524ED7A9B4740781DAA844397EB729D4FCABFDD9B9B5561AA702`
- Product: `0.5.0`
- Realtime Protocol: `1`
- Transfer Protocol: `1`

WP2 Authority Core extraction, runtime interface implementation, product behavior changes, WebRTC, `project-peer` removal and Phase 5 are outside this work and were not started.

## Shared golden fixture

One public, secret-free fixture is stored at:

`unity-package/com.eunsung.teamforge/Tests/Fixtures/teamforge-compatibility-v1.json`

It is consumed by:

- Node Server WebSocket/Coordinator tests;
- Node `project-peer` Descriptor/Invite tests;
- Unity EditMode compatibility test source;
- Repository validator.

The fixture freezes:

- all 16 Presence/Transform/Hierarchy/Project capability combinations;
- accepted snapshot ordering and rejected Hello error details;
- Transform stale-base and operation-ID behavior;
- Hierarchy exact-base and operation-ID behavior;
- Lock expiry, supersede and disconnect traces;
- Hierarchy delete Lock/apply/Presence-cleanup order;
- Project Coordinator publish/retry/announce/late-snapshot event trace;
- canonical Baseline Descriptor UTF-8 bytes and SHA-256;
- a valid public Ed25519 Descriptor and signed Project Invite.

No private key, bearer token, live endpoint credential or user data is stored in the fixture. The transfer token appearing in the event test is a fixed non-secret test value.

## Characterized behavior

### Capability matrix

Valid combinations retain conditional order:

`hello_ack → presence_snapshot → hierarchy_snapshot → transform_snapshot → project_registry_snapshot`

Unnegotiated snapshots are omitted. Transform without Presence is rejected with `invalid_hello`. Hierarchy without both Presence and Transform is rejected with `invalid_hello`. Project-only remains valid and receives `hello_ack → project_registry_snapshot`.

### Authority traces

- A current Lock owner may submit a stale Transform `baseRevision`; accepted operations advance the shared Session Revision.
- A future Transform Revision remains rejected by existing tests.
- Hierarchy requires an exact `baseRevision`; stale operations return `hierarchy_conflict:stale_revision` without mutation.
- An identical operation-ID replay returns the original applied revision with the new request ID.
- Reusing an operation ID with a different fingerprint returns `operation_id_conflict`.
- Lock expiry emits `lock_state_changed → lock_released:lease_expired` to an observer.
- Same-user replacement emits `lock_released:session_superseded → error:session_superseded` to the stale owner.
- Disconnect emits `lock_state_changed → lock_released:connection_closed → user_left` to an observer.
- Deleting a selected locked Hierarchy object emits `lock_released:hierarchy_deleted → hierarchy_applied → presence_updated` and clears the selection reference.

### Project Coordinator trace

The frozen path is:

1. `hello_ack`;
2. empty `project_registry_snapshot`;
3. first `project_baseline_changed` with revision 1 and `idempotent=false`;
4. identical publish retry with `idempotent=true`;
5. complete verified peer announcement as `project_peer_joined` with `seedRank=1` when Owner proof is absent;
6. late Project peer `hello_ack` and snapshot containing Baseline revision 1 and one peer.

## Test evidence

Final results are recorded after all WP1 sources and documentation are frozen:

- Server Node suite: **58/58 PASS**.
- Project Peer Node suite: **63/63 PASS**.
- Repository validator: **PASS** — `264 files, 44 C# sources, protocol v1`.
- Server/Project Peer smoke: **PASS** — realtime smoke passed; direct transfer reported `serverRelayUsed=false`.
- Syntax checks: **PASS** — Server entry/protocol/coordinator/host modules and all 34 Project Peer modules.
- Product-source diff from Closure baseline: **PASS** — 7 test/documentation files added, 5 test/documentation/validator files modified, 0 removed, 0 product or unexpected changes.
- Unity EditMode execution in this WP1 environment: **NOT RUN**

Two Unity EditMode test methods were added as source. The earlier user field evidence remains `94/94 PASS` for the unmodified Closure candidate. WP1 does not claim `96/96` or any other Unity execution result until the user runs the WP1 test surface in Unity `6000.3.21f1`.

## Compatibility boundary

Dynamic values such as timestamps, connection IDs, ports and lease expiry instants are intentionally normalized. Message type/order, capability flags, error codes/details, revision values, idempotence, cleanup reasons, seed rank, canonical bytes and cryptographic hashes are compared exactly.

The suite characterizes existing behavior; it does not declare every current behavior ideal. A future intentional behavior change must update the relevant ADR and golden fixture explicitly rather than silently changing tests.

## Outcome

WP1 exit condition is satisfied when the final Node suites, validator, smoke and product-source comparison pass. Work stops at WP1. WP2 is not authorized by this report.
