# Unity TeamForge package 0.5.1

This Unity 6.3 LTS Editor package provides TeamForge Realtime Protocol v1
connection, presence, transform/basic lock, hierarchy synchronization, signed
Project Bootstrap metadata, and the WP4 Host flow.

## Host

Open **Window > TeamForge > Collaboration**, choose **Host**, save the Scene,
and complete **Publish & Start**. Host Ready succeeds only when the backend
returns one signed `teamforge-bootstrap-invite-v1` **Collaboration Invite**.
The invite is copied automatically and can also be saved.

The Collaboration Invite contains two separately validated internal contracts:
a signed Project Transfer invite and a TF1 realtime session. It contains no
access code, private key, or local absolute path. If the realtime session is
missing, Host fails as `realtime_session_missing` before starting Coordinator
or Seed.

The TF1-only **Session Invite** is under Advanced. It is valid only for an
already-provisioned matching Project and is not a fresh-Guest bootstrap value.

## LAN endpoint policy

For two PCs:

- **Guest address** is a concrete Host LAN/VPN origin reachable from the Guest.
- **Coordinator listen address** is a separate local bind, normally
  `0.0.0.0`.
- A non-loopback bind requires a unique access code shared separately.
- Wildcard, unspecified, and loopback addresses are never advertised in a
  two-PC Collaboration Invite.

Explicit same-PC mode may use loopback for both values. TeamForge does not
provide WebRTC, ICE, STUN, TURN, relay, NAT traversal, or discovery.

## Guest and Project transfer

Fresh Guests use `launcher/win-x64/TeamForge.Launcher.exe`. The Launcher and
Unity package use their embedded, hash-verified Node Runtime; normal users do
not install Node/npm or run a sidecar command.

Project payloads move directly over HTTP between `project-peer` processes.
The Coordinator carries only signed metadata and realtime state. Owner and
Publisher fingerprints, script/package scope, manifest hashes, chunk hashes,
staging, immutable activation, and one-time Unity handoff checks fail closed.

## Hierarchy and safety

Supported same-Scene create/delete/rename/reparent/sibling-order operations are
server-authoritative. Saved objects use `GlobalObjectId`; session-created
objects use `tf:<32 lowercase hex>`. Cross-Scene structure, Prefab structure,
general Component/Asset sync, and persistent restart recovery remain outside
this release.

Settings live in project-local `UserSettings/TeamForgeSettings.asset`.
Credentials are not written to invites or descriptors. Back up the Unity
Project and preserve matching Scene/`.meta` files before field testing.

## Release state

Package minimum is Unity `6000.3`; the reproducible candidate test project is
pinned to `6000.3.21f1`. Unity `6000.3.22f1` is the current upstream patch
and is a follow-up rebaseline because it is not installed or validated here.
WP4 0.5.1 remains **FIELD BLOCKED** until the exact two-PC Windows checklist
passes.
