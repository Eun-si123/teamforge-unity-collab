# TeamForge Phase 4.5 WP5 — Transport Factory and Legacy Connection Strategy Report

Date: 2026-08-11 (Asia/Seoul)

## Scope and baseline

WP5 removes only the direct concrete ClientWebSocket adapter construction from `TeamForgeConnectionService` and introduces the minimum Strategy/Factory composition required by the approved design. The exact input is `Unity-TeamForge-Phase4.5-WP4-unity-authority-view.zip`, SHA-256 `3A3035B4FA3D8EAB724285F4CF119DABDDB2144A56E73EDADE04FA0BC3F31D7B`.

The user reported the WP4 candidate as Unity `6000.3.21f1` EditMode `99/99 PASS` with a normal actual A/B/C smoke. This is prior user field evidence. WP6 and all later work were not started.

## Internet research before implementation

Official and primary material reviewed before code changes:

- Unity compilation and code reload: <https://docs.unity3d.com/kr/current/Manual/compilation-and-code-reload.html>
- Unity `InitializeOnLoadAttribute`: <https://docs.unity3d.com/6000.0/Documentation/ScriptReference/InitializeOnLoadAttribute.html>
- Unity `AssemblyReloadEvents`: <https://docs.unity3d.com/6000.0/Documentation/ScriptReference/AssemblyReloadEvents.html>
- Microsoft .NET dependency injection guidelines: <https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines>
- Microsoft .NET dependency injection overview: <https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/overview>
- Microsoft `ClientWebSocket`: <https://learn.microsoft.com/en-us/dotnet/api/system.net.websockets.clientwebsocket>
- Microsoft `ClientWebSocketOptions.KeepAliveInterval`: <https://learn.microsoft.com/en-us/dotnet/api/system.net.websockets.clientwebsocketoptions.keepaliveinterval>
- Microsoft `ClientWebSocketOptions.SetRequestHeader`: <https://learn.microsoft.com/en-us/dotnet/api/system.net.websockets.clientwebsocketoptions.setrequestheader>
- RFC 6455, The WebSocket Protocol: <https://www.rfc-editor.org/rfc/rfc6455>
- `ws` official API: <https://github.com/websockets/ws/blob/master/doc/ws.md>
- `ws` official repository protocol/heartbeat guidance: <https://github.com/websockets/ws>
- Node.js EventEmitter ordering: <https://nodejs.org/api/events.html>

Implementation consequences:

- Unity can reload assemblies when the Editor opens, scripts change and according to Play Mode configuration. The existing `InitializeOnLoad`, `beforeAssemblyReload`, delayed resume flag and Editor update/quitting subscriptions remain in Connection Service without reordered callbacks.
- Microsoft guidance identifies direct dependency construction as coupling but does not require a container. WP5 therefore uses two small internal interfaces and an explicit static composition root; no service provider, new package, public injection framework or asmdef was added.
- `ClientWebSocket` supports one send and one receive concurrently but not overlapping sends. The existing send semaphore and single receive loop remain unchanged.
- Endpoint, Bearer and keepalive are captured in the attempt and applied once by the WebSocket factory before connect. The adapter's connect contract now needs only cancellation and therefore does not expose WebSocket-specific setup arguments.
- RFC 6455 defines an opening handshake followed by UTF-8 text/binary messages. TeamForge continues to accept/send only complete UTF-8 Protocol v1 text messages with the same size and fragmentation handling; no subprotocol or binary path was introduced.
- The Node `ws` server backend, upgrade/authentication, heartbeat and message event behavior were not edited. Existing black-box Server tests remain the interoperability oracle.

## Connection Strategy responsibility

`LegacyServerStrategy`:

- consumes only the current Server address, Realtime path, effective Bearer value and fixed keepalive value supplied by composition;
- uses the existing `TeamForgeUriBuilder` validation and http/https to ws/wss conversion;
- returns exactly one ordered `RealtimeConnectionAttempt`;
- performs no socket I/O, DNS/probe, reconnect, fallback, discovery or Protocol handshake;
- adds no route or user-visible setting.

## Transport Factory responsibility

`WebSocketTransportFactory`:

- creates the existing .NET `ClientWebSocket` and existing `ClientWebSocketTransport`;
- applies the same minimum-clamped keepalive interval;
- applies the same optional trimmed `Authorization: Bearer …` request header;
- binds the resolved attempt endpoint to the adapter before connect;
- does not own route choice, reconnect/backoff, Hello, message routing or UI state.

`IRealtimeTransport` remains the focused reliable ordered Protocol v1 text-channel contract: connected/text/closed/fault events, cancellation-only connect, serialized text send, disconnect and disposal.

## Responsibilities remaining in Connection Service

`TeamForgeConnectionService` still owns:

- current public/static state, counters, endpoint and UI notifications;
- connection intent, settings persistence and identity validation;
- connection timeout and reconnect/backoff schedule;
- Hello creation, handshake deadline and capability negotiation;
- Protocol v1 family routing and snapshot/live delivery order;
- main-thread callback queue and overflow guard;
- graceful final-send drain, disconnect and stale-epoch suppression;
- assembly-reload resume intent and Editor quit cleanup.

It now asks the Strategy for the single attempt and the Factory for its adapter. It contains no direct `new ClientWebSocketTransport()`.

## Before/after behavior parity

| Concern | Before WP5 | After WP5 |
| --- | --- | --- |
| Selected route | Configured Server address + Realtime path | Same one resolved endpoint |
| Adapter | `ClientWebSocketTransport` | Same adapter, created by factory |
| Authentication | Optional trimmed Bearer request header | Same header/value handling in factory |
| Keepalive | Fixed 20 seconds, minimum 5 in adapter | Same fixed value, minimum captured by attempt |
| Connect timeout | Connection Service cancellation source | Unchanged |
| Reconnect | Existing exponential schedule and max delay | Unchanged |
| Hello/capabilities | Connection Service after socket-open callback | Unchanged |
| Main-thread dispatch | Bounded Connection Service queue | Unchanged |
| Assembly reload | Persist intent, dispose, delayed `Connect()` | Unchanged |
| Protocol/channel | Ordered UTF-8 Protocol v1 text | Unchanged |

Protocol v1/Project Transfer v1 files and golden fixture JSON were not edited. Server and `project-peer` product sources were not edited.

## Verification

Environment: Unity `6000.3.21f1`, Node `v24.18.1`.

- Unity EditMode Test Runner: **102/102 PASS**, failed 0, skipped 0, actual process exit code 0. This includes the user-verified WP4 baseline of 99 plus three WP5 composition tests.
- Product C# static compile against installed Unity `6000.3.21f1` assemblies: **PASS**, warnings 0, errors 0.
- EditMode test-source static compile: **PASS**, errors 0; 37 pre-existing `CS0649` warnings remain for JsonUtility-populated golden fixture fields.
- Server suite: **68/68 PASS**.
- Project Peer suite: **63/63 PASS**.
- Server and Project Peer smoke: **PASS**, including `serverRelayUsed=false`.
- Server syntax: **PASS**.
- Project Peer syntax: **PASS**, 34 modules.
- Repository validator: **PASS** after WP5 changes; final clean/fresh-archive evidence is recorded in release handoff.

The legacy `scripts/teamforge.ps1 unity-test` invocation starts Unity as a Windows GUI process and returned before `$LASTEXITCODE` was populated, initially printing an empty exit-code failure. Unity itself completed the run and wrote a 102/102 PASS XML with exit code 0. A second invocation used hidden `Start-Process -Wait`; it independently returned process exit code 0 and a 102/102 PASS XML. Only the waited run is treated as the final execution evidence.

## Risks and ambiguities

- The Strategy interface returns an ordered array but WP5 deliberately rejects anything other than the one Legacy attempt. Multi-route fallback semantics are not designed or implied.
- The attempt briefly holds the effective Bearer value in managed memory until factory composition. It is never logged or placed in `CurrentEndpoint`; the factory retains the established request-header behavior.
- `ClientWebSocket` option mutation remains before `ConnectAsync`. Future adapters must not infer that TeamForge now supports binary, unordered or unreliable delivery.
- Connection Service's static composition is recreated on assembly reload. Future injectable composition must preserve the existing reload resume flag and callback order.
- The PowerShell Unity wrapper's GUI-process waiting behavior is an evidence-tooling ambiguity, not a product transport regression. WP5 does not change that script because it is outside the requested connection architecture scope.

## Candidate and boundary

Candidate: `Unity-TeamForge-Phase4.5-WP5-transport-factory-legacy-strategy.zip`. Its SHA-256 is recorded in the adjacent `.sha256` sidecar and release handoff because embedding an archive hash in that same archive is circular.

WP5 is complete. WP6 Transfer Source, WP7 Policy/Profile, WebRTC, ICE/STUN/TURN, relay, LAN discovery, automatic fallback, new routes, Phase 5 and Protocol v2 were not started.
