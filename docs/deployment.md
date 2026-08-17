# Deployment and rollback — TeamForge 0.5.1

## Normal Windows deployment

Distribute the immutable candidate ZIP and its adjacent SHA-256 sidecar. Do not
overlay it on the published 0.5.0 candidate.

1. Verify the sidecar.
2. Extract the one short internal root into a path containing no unusually deep
   parent hierarchy. Korean and spaces are supported.
3. Host from Unity with the embedded package Runtime.
4. Guest with `launcher/win-x64/TeamForge.Launcher.exe`.

Normal Host/Guest operation does not use the repository source tree, system
Node/npm, `TEAMFORGE_WORKSPACE_ROOT`, `TEAMFORGE_NODE_PATH`, or caller CWD.

## Host network settings

The Host flow separates:

- **Coordinator listen address**: local bind, default `0.0.0.0` for managed
  two-PC Host flow;
- **Guest address**: concrete origin reachable from the Guest PC.

A two-PC invite cannot advertise `0.0.0.0`, `::`, `127.0.0.1`, or
`localhost`. Any non-loopback listener requires a unique access code shared
separately from the Collaboration Invite. Explicit same-PC mode may use
loopback for both.

The direct Seed advertises the selected Guest host and its actual runtime port.
Firewall and LAN/VPN routing must allow the Coordinator and Seed endpoints.
There is no NAT traversal, relay, discovery, or automatic fallback.

## Invite handling

Share the signed `teamforge-bootstrap-invite-v1` **Collaboration Invite** from
Host Ready. It contains the signed Project Transfer invite and TF1 realtime
session as distinct validated values. It does not contain the access code.

The Advanced TF1-only **Session Invite** is not sufficient for a fresh Guest.
A missing realtime session returns `realtime_session_missing` before processes
start.

## Developer source execution

Source developers use the versions in `release-contract.json`:

```powershell
npm.cmd --prefix server ci --ignore-scripts --workspaces=false
npm.cmd --prefix project-peer ci --ignore-scripts --workspaces=false
& '<candidate>\scripts\teamforge.ps1' verify
```

The supported Node ranges are `>=22.23.2 <23 || >=24.18.1 <25`; npm
`11.19.0` is the lock/release tool. These are build/developer requirements,
not end-user installation steps.

Direct Server variables remain `TEAMFORGE_HOST`, `TEAMFORGE_PORT`,
`TEAMFORGE_AUTH_TOKEN`, `TEAMFORGE_HEALTH_PATH`, and `TEAMFORGE_WS_PATH`.
Do not expose an unauthenticated non-loopback listener or treat the shared
access code as public-internet user identity.

## Update and rollback

- Stop collaboration and back up the Unity Project, Scene, and `.meta` files.
- Replace Server, Project Peer, Unity package, Runtime, and Launcher as one
  0.5.1 artifact set.
- Never mix generated manifests/pins from another candidate.
- Preserve Owner keys and immutable Active revisions.
- Roll back only to a complete previously verified artifact set; do not
  hand-copy individual binaries or manifests.

Protocol versions remain 1, but signed Project descriptors require exact
TeamForge product-version agreement. Re-publish only after explicit source
review; use Seed for an unchanged approved baseline.

## Release evidence boundary

Automated ZIP/runtime/launcher/source gates and manual field gates are separate.
The candidate remains FIELD BLOCKED until the exact two-PC Windows checklist
passes. Docker, macOS/Linux launchers, Authenticode signing, and Unity
6000.3.22f1 rebaseline are explicitly separate results.
