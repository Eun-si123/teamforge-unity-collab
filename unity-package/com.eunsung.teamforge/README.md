# Unity TeamForge package 0.5.1

Current release lineage: `0.5.1-wp5.1-path-resilience`  
Current release state: **FIELD BLOCKED**

This Unity 6.3 LTS Editor package provides TeamForge Realtime Protocol v1 connection, presence, Transform/basic lock, supported same-Scene Hierarchy synchronization, signed Project Bootstrap metadata, the Host flow, and the current diagnostics/recovery UX.

WP5/WP5.1 stabilization adds diagnostics/recovery and Windows path-resilience behavior around the existing Host/Guest workflow. It does not introduce a new Realtime Protocol, Project Transfer Protocol, Project Manifest schema, payload route, or authority model.

## Host

Open **Window > TeamForge > Collaboration**, choose **Host**, save the Scene, and complete **Publish & Start**. Host Ready succeeds only when the backend returns one signed `teamforge-bootstrap-invite-v1` **Collaboration Invite**. The invite is copied automatically and can also be saved.

The Collaboration Invite contains two separately validated internal contracts: a signed Project Transfer invite and a TF1 realtime session. It contains no access code, private key, or local absolute path. If the realtime session is missing, Host fails as `realtime_session_missing` before starting Coordinator or Seed.

The TF1-only **Session Invite** is under Advanced. It is valid only for an already-provisioned matching Project and is not a fresh-Guest bootstrap value.

## LAN endpoint policy

For two PCs:

- **Guest address** is a concrete Host LAN/VPN origin reachable from the Guest.
- **Coordinator listen address** is a separate local bind, normally `0.0.0.0`.
- A non-loopback bind requires a unique access code shared separately.
- Wildcard, unspecified, and loopback addresses are never advertised in a two-PC Collaboration Invite.

Explicit same-PC mode may use loopback for both values. TeamForge does not provide WebRTC, ICE, STUN, TURN, relay, NAT traversal, discovery, or automatic route fallback.

## Guest and Project transfer

Fresh Guests use the packaged `launcher/win-x64/TeamForge.Launcher.exe`. That generated release folder is intentionally **not committed to the public source checkout**; it is produced by the release packaging flow.

The packaged Launcher and Host path use a manifest-pinned, hash-verified bundled Node Runtime. Normal users do not install system Node/npm or run a Project Peer CLI/sidecar command themselves.

Project payloads move directly over HTTP between Project Peer processes. The Coordinator carries only signed metadata and realtime/project coordination state. Owner and Publisher fingerprints, script/package scope, manifest hashes, chunk hashes, staging, immutable activation, and one-time Unity handoff checks fail closed.

`P2P` here means direct Project Peer payload transfer. The current implementation still requires direct network reachability; it does not automatically discover peers or traverse Internet NAT.

## Diagnostics, recovery, and path resilience

WP5 adds stable user-facing error/recovery explanations and bounded current-run diagnostics with secret redaction. Recovery actions are intended to preserve existing trust, baseline, activation, and process-ownership boundaries rather than bypass them.

WP5.1 adds Windows path-resilience handling for the packaged candidate. A high-risk canonical project path may use a TeamForge-owned, identity-bound short execution path when the platform/filesystem can support it. External arbitrary reparse points remain rejected, and the selected Unity-visible path is revalidated before launch.

Arbitrarily deep Windows paths are not a supported promise. Path optimization must not weaken managed-destination containment, Runtime integrity, Project trust, immutable Active validation, or the final Unity handoff.

## Hierarchy and safety boundaries

Supported same-Scene create/delete/rename/reparent/sibling-order operations are server-authoritative. Saved objects use `GlobalObjectId`; session-created objects use `tf:<32 lowercase hex>`. Cross-Scene structure, general Prefab structure, general Component/Inspector/Asset sync, and persistent restart recovery remain outside the supported current release scope.

Settings live in project-local `UserSettings/TeamForgeSettings.asset`. Credentials are not written to invites or descriptors. Back up the Unity Project and preserve matching Scene/`.meta` files before field testing.

## Release state

Package minimum is Unity `6000.3`; `6000.3.21f1` is the recorded candidate test Editor in the current release contract. Do not infer validation for another Unity patch merely because it belongs to the same `6000.3` line; a different patch needs its own recorded test evidence.

Product version `0.5.1` alone does not identify every packaged candidate from WP4/WP5/WP5.1 stabilization. Use [`../../release-contract.json`](../../release-contract.json) for the current release ID/runtime contract and [`../../builds/README.md`](../../builds/README.md) plus an exact SHA-256 for byte-level artifact identity.

The current WP5.1 candidate remains **FIELD BLOCKED** until the required exact-candidate Unity/two-PC Windows field gates are completed. See [`../../docs/STATUS.md`](../../docs/STATUS.md) for the current readiness source of truth.
