# Deployment and rollback — TeamForge 0.5.1 WP5.1

Release identity: `0.5.1-wp5.1-path-resilience`  
Current state: **FIELD BLOCKED**

This page describes the intended packaged Windows candidate workflow. It is not a claim that the current candidate has completed the required field-validation gates. See [STATUS.md](STATUS.md) for release readiness, [`../release-contract.json`](../release-contract.json) for exact candidate/runtime identity, and [`../builds/README.md`](../builds/README.md) for artifact classification.

## Normal Windows deployment

Distribute the exact current candidate ZIP together with its exact SHA-256 sidecar/release hash. A ZIP is a byte-level artifact: if it is repacked or sanitized and its bytes change, it is a replacement artifact with a new hash even when it remains in the same `0.5.1` / WP5.1 release lineage.

Do not overlay it on the published 0.5.0 candidate or mix files from another 0.5.1 candidate revision.

1. Confirm the intended filename/release identity and verify the SHA-256 for the exact ZIP bytes received.
2. Extract the one short internal root into a path containing no unusually deep parent hierarchy. Korean and spaces are supported by the current candidate path policy.
3. Host from Unity with the embedded package Runtime.
4. Guest with the packaged `launcher/win-x64/TeamForge.Launcher.exe`.

The generated `launcher/win-x64/` release folder is **not committed to the public source checkout**; it exists in a packaged candidate after the release build step.

Normal packaged Host/Guest operation does not use the repository source tree, system Node/npm, `TEAMFORGE_WORKSPACE_ROOT`, `TEAMFORGE_NODE_PATH`, or caller CWD.

## Host network settings

The Host flow separates:

- **Coordinator listen address**: local bind, default `0.0.0.0` for managed two-PC Host flow;
- **Guest address**: concrete origin reachable from the Guest PC.

A two-PC invite cannot advertise `0.0.0.0`, `::`, `127.0.0.1`, or `localhost`. Any non-loopback listener requires a unique access code shared separately from the Collaboration Invite. Explicit same-PC mode may use loopback for both.

The direct Seed advertises the selected Guest host and its actual runtime port. Firewall and LAN/VPN routing must allow the Coordinator and Seed endpoints. There is no NAT traversal, relay, discovery, or automatic fallback.

## Invite handling

Share the signed `teamforge-bootstrap-invite-v1` **Collaboration Invite** from Host Ready. It contains the signed Project Transfer invite and TF1 realtime session as distinct validated values. It does not contain the access code.

The Advanced TF1-only **Session Invite** is not sufficient for a fresh Guest. A missing realtime session returns `realtime_session_missing` before processes start.

## Developer source execution

Source developers use the versions in `release-contract.json`:

```powershell
npm.cmd --prefix server ci --ignore-scripts --workspaces=false
npm.cmd --prefix project-peer ci --ignore-scripts --workspaces=false
& '<source-root>\scripts\teamforge.ps1' verify
```

The supported Node ranges are `>=22.23.2 <23 || >=24.18.1 <25`; npm `11.19.0` is the lock/release tool. These are build/developer requirements, not end-user installation steps.

Direct Server variables remain `TEAMFORGE_HOST`, `TEAMFORGE_PORT`, `TEAMFORGE_AUTH_TOKEN`, `TEAMFORGE_HEALTH_PATH`, and `TEAMFORGE_WS_PATH`. Do not expose an unauthenticated non-loopback listener or treat the shared access code as public-internet user identity.

## Update and rollback

- Stop collaboration and back up the Unity Project, Scene, and `.meta` files.
- Replace Server, Project Peer, Unity package, Runtime, and Launcher as one verified artifact set.
- Verify the new artifact's exact hash before using it.
- Never mix generated manifests/pins from another candidate or byte-level artifact.
- Preserve Owner keys and immutable Active revisions.
- Roll back only to a complete previously verified artifact set; do not hand-copy individual binaries or manifests.

Protocol versions remain 1, but signed Project descriptors require exact TeamForge product-version agreement. Re-publish only after explicit source review; use Seed for an unchanged approved baseline.

## Release evidence boundary

Automated ZIP/runtime/launcher/source gates and manual field gates are separate. The WP5.1 candidate remains **FIELD BLOCKED** until the exact required Windows/Unity field validation passes. Testing a newer Unity patch, Docker, macOS/Linux launchers, Authenticode signing, and broader internet transport are separate results and must not be inferred from the Windows source/automated gates.
