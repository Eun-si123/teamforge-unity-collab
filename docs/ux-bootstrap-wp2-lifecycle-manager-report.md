# TeamForge UX Bootstrap WP2 — Server / Seed Lifecycle Manager

Date: 2026-08-13 KST  
Baseline: approved UX Bootstrap WP1 candidate  
Scope: WP2 only

## Result

WP2 implements the frozen WP0 process/port ownership contract on top of WP1 unified preflight. `TeamForgeProcessLifecycleManager` can safely start, reuse, inspect, and stop a Coordinator or Direct Seed without adopting a process merely because it owns a requested port.

The lifecycle control plane is authenticated Node parent/child IPC. Every owned child receives a random lifecycle instance UUID and a 256-bit random token. Status and stop messages must match both values. The child then calls the product's existing asynchronous `stop()` implementation, reports `graceful: true`, disconnects IPC, and exits normally. No credential or raw transfer token appears in a public lifecycle handle.

## Ownership and reuse behavior

| Target | Reuse proof | Stop authority | Failure behavior |
| --- | --- | --- | --- |
| Compatible external Coordinator | Bounded `/health` JSON with exact service `unity-teamforge-server`, product `0.5.0`, realtime protocol `1`, configured health/WebSocket paths, and authentication requirement | Never owned; stop is refused | Missing/incompatible identity is `port_conflict`; required but unavailable authentication is `server_authentication_unavailable` |
| Manager-started Coordinator | Exact health identity plus lifecycle instance ID and authenticated child status | Same manager, retained handle, exact instance ID/token, live IPC | Stale/forged handle is refused; cooperative timeout is surfaced unless the caller explicitly permits an owned-child force fallback |
| Manager-started Direct Seed | Exact Project ID, Project UUID, Session, approved baseline revision, manifest hash, bound host/port/endpoint, and SHA-256 transfer-token fingerprint over authenticated child status | Same manager, retained handle, exact instance ID/token, live IPC | Any unknown fixed-port listener is `port_conflict`; PID/port alone is never adopted or killed |

Fixed port inspection still begins with WP1's bounded TCP probe. A listener remains untrusted until the stronger target-specific identity check succeeds. An OS-selected port (`0`) is accepted only from the manager-started child readiness message and is then bound into the retained identity record.

## Graceful and force-stop policy

The primary stop route is the same on Windows, macOS, and Linux:

1. send an authenticated `stop` request over the already-owned child IPC channel;
2. let the Coordinator call `TeamForgeServer.stop()` or the Seed call `ProjectPeerEngine.startSeed(...).stop()`;
3. require an authenticated `stopped` response with the same request and instance IDs and `graceful: true`;
4. require the exact child handle to close; record exit code and signal;
5. forget ownership so a stale handle cannot stop anything later.

Force termination is not automatic. `forceOwnedAfterTimeout` defaults to `false`. If a caller explicitly enables it after cooperative shutdown fails, the manager may force only the exact `ChildProcess` object retained in its private ownership record. It never enumerates or kills by port or unverified PID.

## Platform decisions from official primary sources

| Platform | Official behavior used | WP2 decision |
| --- | --- | --- |
| Windows | [Node process signals](https://nodejs.org/api/process.html#signal-events) states Windows does not support POSIX signals and that sending `SIGINT`, `SIGTERM`, or `SIGKILL` through Node causes unconditional termination. [Node child processes](https://nodejs.org/api/child_process.html#subprocesskillsignal) likewise documents abrupt Windows termination semantics. [GenerateConsoleCtrlEvent](https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent) is console/process-group based, not a private ownership channel. [TerminateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess) is asynchronous and can compromise DLL global data. | Authenticated IPC is the verifiable graceful mechanism. Actual Windows tests require `method=authenticated_ipc`, `graceful=true`, exit code `0`, and `signal=null`. Console-control emulation is not used as proof of graceful shutdown. |
| macOS | Apple's [`kill(2)`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html) delivers a signal to the selected process or group, and [`signal(3)`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/signal.3.html) describes signal disposition. | Authenticated IPC remains primary so ownership proof and shutdown acknowledgement are identical across platforms. Existing SIGINT/SIGTERM handlers remain as manual CLI compatibility paths, not lifecycle ownership proof. |
| Linux | Linux [`signal(7)`](https://man7.org/linux/man-pages/man7/signal.7.html) defines per-process signal disposition and standard signal behavior. | Same IPC-first policy; signals alone do not prove that a port listener is the process this manager started. |

macOS and Linux runtime execution is **NOT RUN** in this Windows candidate. Their entries above are design decisions backed by official platform semantics, not execution claims.

## Preserved invariants

- The existing `teamforge-project-peer` CLI command surface and Publish/trust confirmations remain available.
- Realtime Protocol v1, Project Transfer v1, manifest schema v1, signed metadata, verified staging, immutable activation, Authority ordering, and direct-only payload transfer are unchanged.
- Seed readiness exposes only the SHA-256 fingerprint of its ephemeral transfer token to the manager; the token itself remains inside the existing Seed implementation.
- Compatible external Server reuse does not confer stop ownership.
- Unknown or incompatible processes are never reused, signalled, or killed.

## New execution evidence in the working candidate

- Focused WP0 contract plus WP2 lifecycle tests: **8/8 PASS**.
- Actual Windows owned Coordinator start/reuse/forged-stop refusal/cooperative stop: **PASS**; authenticated IPC, `graceful=true`, `forced=false`, exit code `0`, signal `null`.
- Actual Windows owned Direct Seed exact-identity start/reuse/cooperative stop: **PASS**; authenticated IPC, `graceful=true`, `forced=false`, exit code `0`, signal `null`.
- Unknown and incompatible Coordinator listeners: **PASS**; each returned `port_conflict` and remained alive until test cleanup.
- Unknown Direct Seed listener: **PASS**; returned `port_conflict` and remained alive until test cleanup.
- Compatible authenticated external Coordinator: **PASS**; missing credential availability failed closed, supplied availability permitted non-owned reuse, and stop remained refused.

Full regression, syntax, smoke, repository validation, archive parity, and fresh extraction evidence are recorded after execution in the separate output verification report. They are not pre-claimed here.

## Known limitations and NOT RUN

- Unity 6000.3 EditMode tests: **NOT RUN** in WP2.
- A/B/C multi-Editor field session: **NOT RUN** in WP2.
- macOS lifecycle runtime tests: **NOT RUN**.
- Linux lifecycle runtime tests: **NOT RUN**.
- Abrupt crash recovery and persistent process adoption after the orchestrator exits: **NOT IMPLEMENTED**; that would require a separately frozen persistent ownership protocol.
- Explicit owned-child force fallback is implemented but deliberately not reported as graceful; destructive fallback execution is not part of the normal-path proof.
- WP3/WP4 UI/launcher and one-click Host/Join flows: **NOT IMPLEMENTED**.

## Explicit non-goals retained

WP3/WP4 UI or launcher, Phase 5 persistent recovery, WebRTC, ICE, STUN, TURN, Relay/NAT traversal, Host Migration, Protocol v2, Component Sync, and arbitrary serialized-property sync are outside this candidate.
