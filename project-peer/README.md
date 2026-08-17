# TeamForge Project Peer 0.5.1

Project Peer is the direct HTTP Project Transfer v1 implementation used by the
Unity Host and Windows Guest Launcher. Project payload bytes never pass through
the Coordinator. Realtime Protocol v1, Project Transfer Protocol v1, Manifest
Schema v1, signed descriptors/invites, hash-verified chunks, immutable Active
revisions, retry/resume, and fail-closed trust checks are unchanged.

Normal WP4 Host/Guest operation uses the manifest-pinned bundled Runtime. It
does not require system Node or npm. The commands below are developer or
advanced diagnostics only.

## Supported developer runtime

- Node `>=22.23.2 <23 || >=24.18.1 <25`
- npm `11.19.0` for lock regeneration/release construction
- exact production dependency `ws@8.21.3`
- TeamForge Server, Project Peer, and Unity package `0.5.1`

```powershell
npm.cmd --prefix project-peer ci --ignore-scripts --workspaces=false
npm.cmd --prefix project-peer run check
npm.cmd --prefix project-peer test
npm.cmd --prefix project-peer run smoke
node project-peer/src/cli.mjs --help
```

All commands resolve Project paths from explicit arguments or the launch
settings file. The `teamforge-project-peer.launch.json` path may be anywhere;
relative values inside it resolve from that file's directory.

## Host contract

The Unity Host bridge runs `src/host-orchestrator-cli.mjs` over bounded NDJSON.
Before starting Coordinator or Seed it requires:

- a saved and reviewed Unity Project/Scene baseline;
- a fresh TF1 realtime session;
- exact source/review fingerprint agreement;
- a signed `teamforge-bootstrap-invite-v1` Collaboration Invite;
- a safe Coordinator bind and advertised Guest endpoint;
- an access code for any non-loopback listener.

`coordinatorListenHost` controls only the local bind. `serverAddress` is the
origin Guests receive. A wildcard bind may be `0.0.0.0`, but a two-PC invite
must advertise a concrete reachable LAN/VPN address. Wildcard, unspecified,
and loopback addresses are rejected for two-PC advertising. Explicit same-PC
mode may use loopback for both.

The direct Seed binds on the selected listener host and advertises the same
Guest host with the actual selected port. No WebRTC, ICE, STUN, TURN, relay,
NAT traversal, discovery, or automatic fallback is implemented.

## Guest contract

The standalone Launcher runs `src/guest-orchestrator-cli.mjs` from its verified
Runtime. It validates the bootstrap envelope, signed transfer invite,
Publisher/Owner trust, Active revision, Unity version, and one-time handoff
before Unity starts. Transfer-only or TF1-only values cannot complete a fresh
Guest bootstrap.

## Advanced CLI

```powershell
node project-peer/src/preflight-cli.mjs inspect --workspace-root <absolute-candidate>
node project-peer/src/cli.mjs publish --launch-settings <absolute-json> --confirm-publish
node project-peer/src/cli.mjs seed --launch-settings <absolute-json>
node project-peer/src/cli.mjs sync --invite <signed-project-invite-file>
```

Publishing requires explicit review and confirmation. Owner keys, access codes,
and private paths are never embedded in Collaboration Invites or launch
settings. Key rotation and ownership transfer remain unsupported and fail
closed in 0.5.1.

## Runtime-only package manifests

The generated `Runtime~/backend` copy deliberately removes source development
`scripts` and the npm build-tool pin. It keeps dependency metadata, locked
integrity, and only bin targets whose files are present. Do not run dependency
repair inside the hash-verified Runtime.
