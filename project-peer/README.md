# TeamForge Project Peer 0.5.1

Current release lineage: `0.5.1-wp5.1-path-resilience`  
Current release state: **FIELD BLOCKED**

Project Peer is the Direct HTTP Project Transfer v1 implementation used by the Unity Host and Windows Guest Launcher. Project payload bytes never pass through the Coordinator. Realtime Protocol v1, Project Transfer Protocol v1, Manifest Schema v1, signed descriptors/invites, hash-verified chunks, immutable Active revisions, retry/resume, and fail-closed trust checks remain the current contract.

Normal packaged Host/Guest operation uses the manifest-pinned bundled Runtime. It does not require system Node or npm. The commands below are developer or advanced diagnostics only.

WP5 adds diagnostics/recovery behavior around the Guest orchestration path. WP5.1 adds path-resilience policy shared with the Windows Launcher. Neither work package creates a second payload route or weakens the existing transfer/trust/activation contract.

## Supported developer runtime

- Node `>=22.23.2 <23 || >=24.18.1 <25`
- bundled candidate Node `24.19.0`
- npm `11.19.0` for lock regeneration/release construction
- exact production dependency `ws@8.21.3`
- TeamForge Server, Project Peer, and Unity package product version `0.5.1`
- current release ID `0.5.1-wp5.1-path-resilience`

```powershell
npm.cmd --prefix project-peer ci --ignore-scripts --workspaces=false
npm.cmd --prefix project-peer run check
npm.cmd --prefix project-peer test
npm.cmd --prefix project-peer run smoke
node project-peer/src/cli.mjs --help
```

All commands resolve Project paths from explicit arguments or the launch settings file. The `teamforge-project-peer.launch.json` path may be anywhere; relative values inside it resolve from that file's directory.

These CLI commands remain useful for source development and advanced diagnostics. They are **not** the normal fresh-Guest product workflow; packaged Guests use the Windows Launcher and verified bundled Runtime.

## Host contract

The Unity Host bridge runs `src/host-orchestrator-cli.mjs` over bounded NDJSON. Before starting Coordinator or Seed it requires:

- a saved and reviewed Unity Project/Scene baseline;
- a fresh TF1 realtime session;
- exact source/review fingerprint agreement;
- a signed `teamforge-bootstrap-invite-v1` Collaboration Invite;
- a safe Coordinator bind and advertised Guest endpoint;
- an access code for any non-loopback listener.

`coordinatorListenHost` controls only the local bind. `serverAddress` is the origin Guests receive. A wildcard bind may be `0.0.0.0`, but a two-PC invite must advertise a concrete reachable LAN/VPN address. Wildcard, unspecified, and loopback addresses are rejected for two-PC advertising. Explicit same-PC mode may use loopback for both.

The direct Seed binds on the selected listener host and advertises the same Guest host with the actual selected port. No WebRTC, ICE, STUN, TURN, relay, NAT traversal, discovery, or automatic fallback is implemented.

## Guest contract

The standalone Windows Launcher runs `src/guest-orchestrator-cli.mjs` from its verified Runtime. It validates the bootstrap envelope, signed transfer invite, Publisher/Owner trust, Active revision, Unity version, and one-time handoff before Unity starts. Transfer-only or TF1-only values cannot complete a fresh Guest bootstrap.

WP5 diagnostics expose stable failure/recovery information while keeping secrets redacted and previous verified Active state intact where appropriate. Recovery UX must not bypass invite signatures, stored Project/Owner trust, staging verification, immutable activation, or Scene-baseline validation.

## Windows path-resilience boundary

`src/path-resilience-contract.json` is the shared source-side contract for the conservative Windows/Unity path budget consumed by Project Peer policy and Launcher path handling.

WP5.1 allows a verified project to be opened through a TeamForge-owned short execution path only under the Launcher's separate identity/reparse-point verification rules. It does **not** make arbitrary external symlinks/junctions valid Project roots, and it does not change the canonical verified Active identity.

## Advanced CLI

```powershell
node project-peer/src/preflight-cli.mjs inspect --workspace-root <absolute-candidate>
node project-peer/src/cli.mjs publish --launch-settings <absolute-json> --confirm-publish
node project-peer/src/cli.mjs seed --launch-settings <absolute-json>
node project-peer/src/cli.mjs sync --invite <signed-project-invite-file>
```

Publishing requires explicit review and confirmation. Owner keys, access codes, and private paths are never embedded in Collaboration Invites or launch settings. Key rotation and ownership transfer remain unsupported and fail closed in 0.5.1.

## Runtime-only package manifests

The generated `Runtime~/backend` copy deliberately removes source-development `scripts` and the npm build-tool pin. It keeps dependency metadata, locked integrity, and only bin targets whose files are present. Do not run dependency repair inside the hash-verified Runtime.

The generated Runtime is a packaged artifact and is intentionally absent from a normal public source checkout. Use [`../scripts/validate-public-source.mjs`](../scripts/validate-public-source.mjs) for source-tree validation; the stronger release-candidate validator expects generated Runtime/Launcher/release evidence and is intended for staged candidate trees.

See [`../docs/architecture.md`](../docs/architecture.md) for current topology, [`../docs/STATUS.md`](../docs/STATUS.md) for readiness, and [`../release-contract.json`](../release-contract.json) for exact current candidate/runtime identity.
