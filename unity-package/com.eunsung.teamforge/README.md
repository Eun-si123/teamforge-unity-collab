# Unity TeamForge package

This Unity Editor package provides TeamForge's Editor-facing realtime collaboration, Host flow, diagnostics/recovery UX and supported same-Scene collaboration behavior.

This module README describes **package behavior and boundaries**, not current release readiness. Use [`../../docs/STATUS.md`](../../docs/STATUS.md) for live readiness and [`../../release-contract.json`](../../release-contract.json) for exact Unity/protocol/runtime selections.

## Host workflow

Open **Window > TeamForge > Collaboration**, choose **Host**, save/review the Scene, and complete **Publish & Start**.

Host Ready succeeds only after the backend returns a signed Collaboration Invite that contains separately validated Project-transfer and realtime-session contracts.

The Collaboration Invite does not contain the access code, private key or local absolute Project path. The access code is shared separately.

The advanced realtime-only Session Invite is for an already-provisioned matching Project and is not a fresh-Guest bootstrap value.

## LAN endpoint policy

For two PCs:

- **Guest address** is a concrete Host LAN/VPN origin reachable from the Guest;
- **Coordinator listen address** is a separate local bind;
- non-loopback listening requires authentication according to current policy;
- wildcard/unspecified/loopback addresses are not valid advertised remote Guest destinations.

Explicit same-PC mode may use loopback.

TeamForge does not currently provide automatic Internet peer discovery, NAT traversal or relay. Current connectivity boundaries belong to [architecture.md](../../docs/architecture.md) and [STATUS.md](../../docs/STATUS.md).

## Guest / Project transfer boundary

Fresh packaged Guests use the standalone Windows Guest Launcher. Generated packaged Launcher/Runtime output is intentionally not committed as normal source.

The packaged Launcher/Host path uses a manifest-pinned verified Runtime. Normal Guests do not need to install system Node/npm or operate the Project Peer CLI manually.

Project payload bytes move directly between Project Peer processes. The TeamForge Server carries realtime authority and signed Project coordination metadata rather than Manifest/File/Chunk payload bytes.

Owner/Publisher identity, signed invites/descriptors, hashes, staging, immutable activation and final Unity handoff are fail-closed trust boundaries.

## Hierarchy / identity boundary

Supported same-Scene GameObject create/delete/rename/reparent/sibling-order operations are authoritative collaboration operations.

Saved Scene objects use stable Unity identity; session-created objects use TeamForge logical identity after authoritative binding. Name, hierarchy path or sibling index must not silently become authority fallbacks when identity is ambiguous.

General Component/Inspector/Prefab/Asset synchronization and cross-Scene structural collaboration are separate future surfaces and must not be inferred from supported Hierarchy behavior.

## Diagnostics and recovery

Diagnostics/recovery UX should explain failures and offer state-driven recovery actions without bypassing:

- invitation/signature validation;
- stored Project/Owner/Publisher trust;
- Project staging/activation verification;
- Scene/baseline checks;
- authority/identity rules.

A recovery button is not permission to force unknown local state over authoritative state.

## Windows path-resilience boundary

The packaged Windows flow can use a TeamForge-owned short execution path when the platform/filesystem policy can prove the expected canonical Active Project identity.

Path shortening is an execution detail. It must not weaken managed-destination containment, Runtime integrity, Project trust, immutable Active verification or final Unity handoff checks.

Arbitrary external reparse/symlink/junction paths are not implicitly trusted because a narrow TeamForge-owned execution alias is supported.

## Settings / secrets

Project-local user settings live under `UserSettings` according to the package implementation.

Credentials/access secrets are not intended to be embedded into Collaboration Invites or Project descriptors. Remove secrets/private paths from logs before sharing diagnostics publicly.

## Validation

Package behavior is covered by Unity EditMode and real-server E2E paths in the repository, but each result applies only to the exact scenario and source revision exercised.

Do not infer physical two-PC Windows field closure from EditMode/CI results. Current validation and release effects are tracked in [`../../docs/STATUS.md`](../../docs/STATUS.md).
