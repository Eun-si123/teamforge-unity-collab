# Changelog

## 0.5.1 - 2026-08-15

- Repaired WP4 Host Ready so it fails closed without a signed
  `teamforge-bootstrap-invite-v1` Collaboration Invite.
- Separated Coordinator listen/bind from the advertised Guest endpoint and
  rejected wildcard or loopback addresses for two-PC invites.
- Moved the TF1-only Session Invite under Advanced and preserved it for
  already-provisioned matching Projects.
- Added a single release contract, security-patched Node floors, current
  runtime/tool provenance, CWD-independent smoke gates, and short Windows
  release-root/path-budget validation.
- Removed the obsolete Phase 3 Windows validator and generated runtime-only npm
  manifests without dead development script declarations.
- Preserved Realtime Protocol v1, Project Transfer Protocol v1, Manifest Schema
  v1, direct HTTP payload transfer, and existing authority/security invariants.
- WP4 remains FIELD BLOCKED until the exact two-PC Windows checklist passes.

## UX Pass 2 Hotfix2 - 2026-08-10

- Fixed Quick A/B/C Lab clone startup so B/C carry the exact host saved Scene baseline (path/GUID/SHA-256), verify it in the clone, and open that Scene before realtime connection.
- B now waits one additional Editor update after Scene load before auto-connect so Scene/Hierarchy callbacks settle; C opens the same baseline Scene but intentionally remains offline for Late Join.
- Clone preparation waits for Unity compile/AssetDatabase update to finish, retries bounded transient startup failures, and fails closed on dirty local Scene state or baseline identity/hash mismatch.
- Home now shows `Collaboration partially ready` when realtime is connected but the authoritative Hierarchy snapshot has not been accepted.
- Added regression coverage/validator wiring for baseline-aware clone bootstrap and exact Scene opening. Coordinator, Project Peer and protocol v1 remain unchanged.

## UX Pass 2 Hotfix1 - 2026-08-10

- Fixed Unity C# compiler error CS0177 in Scene baseline validation by separating the missing-file branch from `TryHashFile(..., out error)` instead of short-circuiting them with `||`.
- Added a repository-validator regression that rejects the short-circuit pattern and requires an actionable missing-baseline error path.
- Investigated `(GetStatus) Cannot get non-existing progress id ...`: TeamForge does not call `UnityEditor.Progress.GetStatus`/lifecycle APIs; Unity has tracked the same Progress Window failure mode independently. Keep it as an external Unity Editor diagnostic unless a TeamForge action produces a reproducible package-owned stack trace.
- Coordinator, Project Peer, realtime protocol, hierarchy authority, transform/lock behavior, and invite format are unchanged.

## UX Pass 2 - 2026-08-09

- Reduced the normal collaboration surface to `Start Collaboration`, `Join from Clipboard`, `Connect Current`, `Copy Invite`, and `Leave`; transport/identity fields remain available only under manual/advanced settings.
- Bound new `TF1.` invites to the exact saved Scene baseline using Scene asset GUID + SHA-256, and reject mismatched Project/Scene state before realtime connection rather than waiting for `GlobalObjectId` snapshot warnings.
- Added a local invite-baseline cache under `UserSettings` so a host can copy the same invite again after realtime edits make the Scene dirty without silently changing the session baseline.
- Added a one-click Standard A/B/C Test Lab: B auto-connects, C intentionally stays offline for Late Join, clones preserve the saved baseline, Windows uses `robocopy` when available, and clone auto-connect now waits/retries through import/compile/update startup.
- Expanded TeamForge Doctor with saved Scene baseline fingerprinting, safe-fix actions, Project Bootstrap/Test Lab status, and friendlier connection diagnostics.
- Expanded developer scripts with `dev`, `verify`, `unity-test`, and authenticated LAN startup helpers; Unity EditMode tests can be launched headlessly from the full workspace.
- Coordinator and Project Peer source remain byte-for-byte unchanged from UX Pass 1 / Hotfix6; realtime protocol remains v1.

## UX Pass 1 - 2026-08-09

- Added a Quick Start collaboration home screen while preserving the full Advanced diagnostics/bootstrap UI.
- Added secret-free `TF1.` join codes for Server/Project/Session handoff.
- Added TeamForge Doctor checks for Unity/package/project identity/Scene/settings/auth/path/realtime state.
- Added Test Lab to create and launch clean B/C/D Unity Editor copies from one saved baseline. Test Lab now requires a saved Scene baseline and can keep the last clone offline for a real Late Join check.
- Added environment-token fallback for launched test Editors without putting credentials into join codes/bootstrap JSON.
- Downgraded the expected `hierarchy_object_deleted` stale-edit rejection from generic Error logging to a clear Warning.
- Added Windows `Start-TeamForge-Local.cmd` and `scripts/teamforge.ps1` developer helpers in the full workspace candidate.
- Realtime protocol remains v1; Coordinator and Project Peer source are unchanged from Hotfix6.


## 0.5.0 - 2026-08-07

- Added Phase 4 Hierarchy Synchronization for GameObject create/delete/rename/reparent/sibling order.
- Added additive Protocol v1 hierarchy capability, server-authoritative hierarchy snapshots, tombstones and conflict handling.
- Added logical `tf:` identities for session-created objects without Scene metadata Components.
- Integrated hierarchy create/reparent/delete with Phase 2 Transform baseline and Basic Lock conflict policy.
- Added Phase 2-only authority guard for Phase 4 authoritative Scenes.
- Added hierarchy status/diagnostics and EditMode test source.
- Preserved Phase 3 Direct P2P payload architecture and closure fixes.
- Persistent server restart recovery remains out of scope until Phase 5.

## 0.4.1 - 2026-08-04

- Fix Unity 6000.3.21f1 CS0104 by fully qualifying `UnityEditor.PackageManager.PackageInfo` in EditMode tests.
- Distinguish a missing verified baseline from a retained baseline whose direct seeds are offline.
- Add Unity/status and repository-validator regressions for both field defects.
- Include direct and unlisted Embedded UPM packages in deterministic Project Baselines.
- Reject escaping Local Package paths, intermediate symlinks/junctions, missing Package lock metadata, and Owner identity JSON.
- Add bounded Direct Transfer retry, Retry-After handling, exponential backoff, jitter, peer failover, pacing, and secret-free diagnostics.
- Add Embedded Package Publish-to-Sync regression coverage and Editor package/menu surface tests.

## 0.4.0 - 2026-08-03

- Added additive Realtime Protocol v1 negotiation for `supportsProjectTransfer` / `projectTransferEnabled`.
- Added metadata-only Project Coordinator DTOs and capability-gated routing for registry, peer, baseline, and sync-required events.
- Added fail-closed Project UUID, baseline, SHA-256, Ed25519 SPKI shape/key-ID, version, endpoint, inventory, timestamp, and relative-path validation.
- Added an atomic in-memory Project registry that rejects invalid snapshots, revision rollback, same-revision forks, and mismatched selectable seeds.
- Added a secret-free `ProjectSettings/TeamForgeProject.json` identity descriptor, created only after explicit seed-source approval and never automatically overwritten.
- Added signed sidecar invite import shape validation, Owner fingerprint review, managed-staging guidance, and secret-free project-peer launch-settings export.
- Invite application now requires a fully stopped connection, cancels pending Assembly Reload resume, clears the previous Bearer Token, and never connects automatically.
- Added Project Bootstrap UI and read-only diagnostics without Project payload transfer, key generation, automatic scanning, publish, download, or activation inside Unity.
- Added Unity EditMode test sources for DTO round trips, atomic registry behavior, UUID/hash/version/path validation, invitation interoperability, and payload-field exclusion.
- Preserved Phase 0 Ping/Pong, Phase 1 Presence, and Phase 2 Transform/lock behavior under Realtime Protocol v1.

## 0.3.0 - 2026-08-02

- Added capability-negotiated Transform Sync for saved Scene GameObjects.
- Added server-authoritative revisions, idempotent operation IDs, and in-memory late-join snapshots.
- Added GameObject-wide lease locks with renewal, conflict denial, disconnect cleanup, and timeout release.
- Added throttled local Transform capture and remote apply suppression for position, rotation, and scale.
- Added selected-lock controls, status, revision diagnostics, server tests, and Unity EditMode test sources.
- Added clean Scene/Object/parent baselines preserved across reconnect and Assembly Reload; blocked new objects, multi-selection, Prefab Stage, and hierarchy drift.
- Added dirty-snapshot conflict protection, target-specific stale Undo cleanup, Prefab instance override recording, and graceful final-send disconnect draining.
- Bounded retained session state, snapshots, locks, outbound buffers, Hello time, and WebSocket heartbeat lifetime.
- Preserved Phase 0 Ping/Pong and Phase 1 Presence client behavior through Protocol v1 capability negotiation.

## 0.2.0 - 2026-08-02

- Added project/session-scoped Presence snapshots and join/update/leave events.
- Added stable per-project editor identity, user color, selection, active Scene, heartbeat, and Scene View camera sharing.
- Added remote selection wireframe/name overlays and teammate navigation actions.
- Added server-side identity validation, session isolation, and stale-connection supersession for Assembly Reload recovery.
- Added Presence server tests and Unity EditMode test sources while preserving Phase 0 Hello/Ping/Pong behavior.

## 0.1.0 - 2026-08-02

- Added Unity 6.3 LTS Editor-only UPM package.
- Added UI Toolkit collaboration and diagnostics window.
- Added configurable ClientWebSocket transport with Hello and Ping/Pong protocol v1.
- Added RTT measurement, manual disconnect, bounded exponential reconnect delay, and Assembly Reload resume intent.
- Added local UserSettings persistence and optional Bearer Token header.
- Added EditMode tests for URI construction, protocol serialization, and identity validation.

### 0.5.0 Hotfix3 field stabilization - 2026-08-08

- Re-arm Transform selection tracking after an authoritative Hierarchy create admits the currently selected logical object into the baseline.
- Preserve an in-flight local Transform delta against the server-approved create Transform so it is sent after lock acquisition instead of being silently adopted.
- Add an EditMode regression for create-to-Transform continuity and repository validation for the integration wiring.

### 0.5.0 Hotfix4 test-harness stabilization - 2026-08-08

- Make the new create-to-Transform EditMode regression deterministic by explicitly invoking selection tracking after assigning the test GameObject instead of relying on synchronous `Selection.selectionChanged` timing.
- No TeamForge runtime, protocol, server, Project Peer, dependency, or persistent identity behavior changed from Hotfix3.

### 0.5.0 Hotfix5 Transform/Hierarchy coherence - 2026-08-08

- Keep authoritative Hierarchy Transform fields current when accepted Transform updates arrive on the server.
- Prevent remote rename/reorder acknowledgement from overwriting a peer's live Transform with stale Hierarchy coordinates.
- Add server/Unity regressions for rename and late-join Transform coherence.

### 0.5.0 Hotfix6 offline tombstone reconciliation - 2026-08-08

- Apply authoritative tombstone deletes before the reconnect dirty-Scene safety gate so an offline-edited object that was deleted by another peer cannot remain alive locally.
- Allow reconnect to continue when the remaining dirty Scene's live Hierarchy and Transform still exactly match authority, preserving unrelated component-only dirty state.
- Keep fail-closed protection when any remaining live object has unsaved rename/reparent/reorder/Transform divergence or an unknown local object.
- Add EditMode regressions for tombstone dominance and dirty-live-state safety.
