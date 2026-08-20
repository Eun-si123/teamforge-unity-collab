# TeamForge Server 0.5.1

Current release lineage: `0.5.1-wp5.1-path-resilience`  
Current release state: **FIELD BLOCKED**

The Server is the authoritative Realtime Protocol v1 Coordinator for health, presence, Transform, lease locks, Hierarchy state, and signed Project registration/peer metadata. It never stores or relays Project payload bytes.

Normal packaged Host operation starts the Server with the bundled Node Runtime. WP5/WP5.1 diagnostics/path-resilience work does not create another realtime authority route or Project payload route. System Node/npm commands below are source-development paths only.

## Developer commands

```powershell
npm.cmd --prefix server ci --ignore-scripts --workspaces=false
npm.cmd --prefix server test
npm.cmd --prefix server run smoke
npm.cmd --prefix server start
```

Supported developer Node range is `>=22.23.2 <23 || >=24.18.1 <25`; the current release contract bundles Node `24.19.0` and uses `ws@8.21.3`.

## Listen and authentication

Direct source execution reads:

- `TEAMFORGE_HOST` — bind host, default `127.0.0.1`;
- `TEAMFORGE_PORT` — listen port, default `5080`;
- `TEAMFORGE_AUTH_TOKEN` — shared Bearer access code;
- `TEAMFORGE_HEALTH_PATH` — default `/health`;
- `TEAMFORGE_WS_PATH` — default `/ws`.

The packaged Host orchestrator keeps bind and advertised Guest origins separate. `0.0.0.0` is a bind value, never a Guest address. Any non-loopback listener requires a separately shared access code. The shared-token design is for a trusted LAN/VPN/team environment, not an untrusted public-internet identity or authorization service.

Health reports product `0.5.1` and Realtime Protocol `1`. Protocol, hierarchy, message-size, rate-limit, lock, and connection safety bounds remain enforced.

## State and payload boundary

- Session authority and Project Coordinator registries are memory-only.
- The Coordinator carries Project/Baseline/Peer metadata, not Manifest/File/Chunk payload bytes.
- Project payloads move directly between Project Peers over Project Transfer v1 Direct HTTP.
- Server restart persistence and durable authority/history recovery are not implemented.
- `P2P` does not imply automatic internet discovery, NAT traversal, or relay.

## Scope

User-specific authorization, WebRTC, ICE/STUN/TURN, relay, NAT traversal, discovery, automatic route fallback, durable Server/Session persistence, and Project payload transport through the Server remain out of scope.

See [`../docs/architecture.md`](../docs/architecture.md) for current topology and [`../release-contract.json`](../release-contract.json) for the exact current runtime/candidate identity.
