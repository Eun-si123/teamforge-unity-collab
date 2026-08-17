# TeamForge Server 0.5.1

The Server is the authoritative Realtime Protocol v1 Coordinator for health,
presence, transform, lease locks, hierarchy state, and signed Project
registration metadata. It never stores or relays Project payload bytes.

Normal WP4 Host operation starts the Server with the bundled Node Runtime.
System Node/npm commands below are source-development paths only.

## Developer commands

```powershell
npm.cmd --prefix server ci --ignore-scripts --workspaces=false
npm.cmd --prefix server test
npm.cmd --prefix server run smoke
npm.cmd --prefix server start
```

Supported developer Node range is
`>=22.23.2 <23 || >=24.18.1 <25`; production bundles Node `24.19.0`
and `ws@8.21.3`.

## Listen and authentication

Direct source execution reads:

- `TEAMFORGE_HOST` — bind host, default `127.0.0.1`;
- `TEAMFORGE_PORT` — listen port, default `5080`;
- `TEAMFORGE_AUTH_TOKEN` — shared Bearer access code;
- `TEAMFORGE_HEALTH_PATH` — default `/health`;
- `TEAMFORGE_WS_PATH` — default `/ws`.

The WP4 Host orchestrator keeps bind and advertised Guest origins separate.
`0.0.0.0` is a bind value, never a Guest address. Any non-loopback listener
requires a separately shared access code. The shared-token design is for a
trusted LAN/VPN/team environment, not an untrusted public internet service.

Health reports product `0.5.1` and protocol `1`. Protocol, hierarchy,
message-size, rate-limit, lock, and connection safety bounds remain enforced.

## Scope

Server restart persistence, user-specific authorization, WebRTC, relay, NAT
traversal, discovery, automatic route fallback, and Project payload transport
remain out of scope.
