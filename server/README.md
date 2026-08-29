# TeamForge Server

The TeamForge Server is the authoritative realtime/session coordinator and signed Project-metadata coordinator.

This module README describes **server responsibilities and source operation**, not current release readiness. Use [STATUS.md](../docs/STATUS.md) for live readiness and [`release-contract.json`](../release-contract.json) for exact runtime/protocol selections.

## Responsibilities

The server owns:

- HTTP health and WebSocket hosting;
- authentication for configured listeners;
- in-memory Presence/session membership;
- shared Revision ordering;
- Transform and supported Hierarchy authority;
- lock/lease ownership;
- bounded replay/idempotency/tombstone state;
- signed Project/Owner/Publisher/Baseline/Peer metadata coordination.

The server does **not** own:

- Project Manifest/File/Chunk payload storage;
- Project payload relay;
- Unity filesystem activation;
- durable session persistence or restart recovery;
- automatic Internet discovery/NAT traversal/relay.

Project payload bytes move directly between Project Peer processes.

## Developer commands

```powershell
npm.cmd --prefix server ci --ignore-scripts --workspaces=false
npm.cmd --prefix server test
npm.cmd --prefix server run smoke
npm.cmd --prefix server start
```

Use [`../release-contract.json`](../release-contract.json) for the exact supported developer Node range, bundled Runtime selection and production dependency versions rather than copying them into this README.

## Listen and authentication

Direct source execution reads:

- `TEAMFORGE_HOST` — bind host, default `127.0.0.1`;
- `TEAMFORGE_PORT` — listen port, default `5080`;
- `TEAMFORGE_AUTH_TOKEN` — shared Bearer access code;
- `TEAMFORGE_HEALTH_PATH` — default `/health`;
- `TEAMFORGE_WS_PATH` — default `/ws`.

The packaged Host flow keeps the local bind address separate from the concrete Guest-reachable advertised address. Wildcard addresses are bind values, not remote Guest destinations.

A non-loopback listener requires authentication according to current policy. The shared access-code model is intended for a trusted team/LAN/VPN environment, not an untrusted public-Internet identity system.

## Authority / state boundary

- Session authority and Project Coordinator registries are currently memory-resident.
- The Session Authority core owns collaboration transitions; the socket host should execute effects rather than duplicate authority rules.
- The Project Coordinator carries signed metadata and coordination state, not Project payload bytes.
- Server restart persistence and durable old-session recovery are separate future capabilities.

## Networking boundary

Current Project Peer payload transfer requires direct peer reachability. The Server does not imply or provide WebRTC, ICE/STUN/TURN, relay, discovery, NAT traversal or automatic transport fallback.

See [architecture.md](../docs/architecture.md) for the complete topology and authority/trust boundaries.
