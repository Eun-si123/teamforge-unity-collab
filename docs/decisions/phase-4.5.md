# ADR — Phase 4.5 Architecture Foundation Closure

Date: 2026-08-11  
Status: Accepted for the Phase 4.5 Closure candidate  
Scope: Architecture-preserving foundation over Phase 0–4

## Context

Phase 4 delivered working Presence, Transform/Lock, Project bootstrap/transfer and Hierarchy collaboration, but several state, transport and configuration responsibilities were composed inside concrete hosts/services. Phase 4.5 creates testable boundaries without changing Protocol v1, external behavior, active routes, defaults or security floors.

## Decisions

### D-450 Preserve Protocol v1 and Phase 0–4 behavior

Realtime Protocol, Project Transfer Protocol and Manifest schema remain version `1`. Capability acceptance, initial snapshot order, message fields, error codes, Revision/Lock/Hierarchy/Tombstone meaning, Project identity and activation semantics are compatibility constraints, not refactor opportunities.

### D-451 Separate authority transitions from hosts

`SessionAuthority` owns mutable collaboration state transitions and ordered effects. `ProjectCoordinatorCore` owns mutable Project/Baseline/Peer registry transitions and effects. The Node host owns HTTP/WebSocket/auth/JSON/timers and applies effects. Time is supplied to transitions explicitly; cores do not schedule host timers.

### D-452 Use a transient Unity Authority View

Observed Session Revision, Locks, capabilities and connection identity live in `TeamForgeAuthorityView`. Transform and Hierarchy consume `IAuthorityView`. The view is connection-scoped and non-persistent. Existing `TeamForgeTransformSyncService.CurrentRevision` and `Locks` remain compatibility facade aliases.

### D-453 Compose the current transport without adding routes

`LegacyServerStrategy` returns one ordered attempt for the configured Server endpoint. `WebSocketTransportFactory` creates the existing `ClientWebSocketTransport`. Strategy selects attempts; it does not implement transport. No route probing, discovery or fallback exists.

### D-454 Freeze the Project Transfer Source boundary

Transfer Core consumes `descriptor`, `manifest`, `inventory` and `chunk` operations plus normalized errors. `DirectTransferClient` owns HTTP interpretation and remains the sole real adapter. `ProjectPeerEngine` remains the stable backend. Project bytes never cross or persist in the TeamForge Server.

### D-455 Resolve existing settings into one legacy profile

Unity settings, Server environment inputs and Project Peer CLI/constructor defaults resolve into immutable/get-only value snapshots. `LegacyPhase4Compatible` is the only profile. No profile UI or tuning change is introduced.

Project UUID, signatures/proofs, content hashes/sizes, path and link defenses, staged atomic activation, non-destructive Active/User Project behavior and authority rules are mandatory safety floors and cannot be disabled by a profile.

### D-456 Keep persistence and alternate topology outside Phase 4.5

Server Session Authority and Project Coordinator state remain memory-only. Phase 4.5 does not add an operation log, persistent authority snapshot, missing-revision recovery, serverless/embedded authority, host migration, Component Sync, WebRTC/ICE/STUN/TURN/relay, automatic routing/fallback or Protocol v2.

## Consequences

- Existing Server WebSocket and Project Peer Direct HTTP paths remain deployable without migration.
- Pure transition and golden tests can distinguish refactor regression from transport/Editor problems.
- A future adapter or policy can be proposed against explicit boundaries, but it requires a new ADR and must preserve or explicitly version compatibility and safety semantics.
- Server restart still loses live authority and Coordinator registry state.
- Direct Project transfer still requires peer reachability.

## Verification

The repository validator freezes the core/host dependency bans, Authority View ownership, Strategy/Factory composition, sole Direct HTTP adapter, profile safety floor, Protocol/Manifest version parity, golden snapshot ordering, active routes and forbidden-feature absence. Full automated and manual evidence boundaries are recorded in the Phase 4.5 Closure report and field checklist.

## Rollback

Rollback is artifact replacement, not a state-schema migration. Stop/disconnect the Phase 4.5 processes, preserve Unity Projects, `TeamForgeProjects`, Owner key backups and evidence, verify the selected prior ZIP SHA-256, and replace Server/Unity package/Project Peer together. Do not manually downgrade Project Peer `published.json` or active pointers. See [../phase-4.5-rollback-reference.md](../phase-4.5-rollback-reference.md).
