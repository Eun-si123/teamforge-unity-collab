# TeamForge Phase 4.5 WP7 — Policy/Profile Resolution Report

Date: 2026-08-11 (Asia/Seoul)

## Scope and baseline

WP7 only introduces immutable resolved value snapshots for the existing Unity, Server and `project-peer` behavior settings. The exact input is `Unity-TeamForge-Phase4.5-WP6-transfer-source-stable-backend.zip`, SHA-256 `1ED6360DE6E99B789CBE19494345974ECAF90982DDBB292BB948687D09E04D0F`.

The user reported that this WP6 baseline passed Unity `6000.3.21f1` EditMode `102/102`, Server `68/68`, Project Peer `70/70`, Direct Transfer smoke and repository validation. Those results are prior user field evidence, not executions performed by WP7. WP8 and later work were not started.

## Internet research before implementation

Official and primary material reviewed before edits:

- Unity `ScriptableSingleton<T>` persistence and assembly-reload lifetime: <https://docs.unity3d.com/6000.3/Documentation/ScriptReference/ScriptableSingleton_1.html>
- Unity `FilePathAttribute` storage scope: <https://docs.unity3d.com/6000.3/Documentation/ScriptReference/FilePathAttribute.html>
- Unity `EditorPrefs` storage behavior: <https://docs.unity3d.com/6000.3/Documentation/ScriptReference/EditorPrefs.html>
- Unity `SettingsProvider` project/user scopes: <https://docs.unity3d.com/6000.3/Documentation/ScriptReference/SettingsProvider.html>
- Microsoft C# `readonly`: <https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/readonly>
- Microsoft C# properties: <https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/properties>
- Microsoft value-object guidance: <https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/implement-value-objects>
- Node.js `process.env`: <https://nodejs.org/api/process.html#processenv>
- Node.js environment-variable semantics: <https://nodejs.org/api/environment_variables.html>
- Node.js `util.parseArgs` option/default model: <https://nodejs.org/api/util.html#utilparseargsconfig>
- POSIX utility argument conventions: <https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap12.html>
- Node.js CLI configuration trust warning: <https://nodejs.org/download/release/v22.16.0/docs/api/cli.html>

Implementation consequences:

- The existing `ScriptableSingleton` and `[FilePath("UserSettings/TeamForgeSettings.asset", ProjectFolder)]` remain the persistence authority. No serialized field, storage path, lifecycle hook or Settings UI field was added.
- Unity policy objects use constructor-assigned, get-only properties. They are transient snapshots and are never serialized.
- Server environment values are still strings at the boundary and pass through the same normalization/range checks. The resolved profile is frozen; `TEAMFORGE_AUTH_TOKEN` remains runtime credential input outside inspectable policy data.
- The existing CLI parser was retained because replacing it with `util.parseArgs` would risk changing accepted ordering, `--name=value`, flags and error behavior. Existing `integerOption`, launch-settings and constructor validation remain the validation boundaries; resolved defaults now come from one frozen legacy profile.
- No policy/profile value is loaded from an untrusted executable configuration file. Existing CLI and environment trust assumptions are unchanged.

## Policy/Profile structure

There is one profile name only: `LegacyPhase4Compatible`.

| Value snapshot | Responsibility |
| --- | --- |
| `ConnectionPolicy` | Current endpoint/path selection, connection/handshake timeout, keepalive, reconnect/backoff and existing realtime cadence/lease values. Server uses the same value type for its validated listener/realtime/authority limits. |
| `TransferPolicy` | Current Direct HTTP/Swarm concurrency, timeout, retry/backoff/jitter/pacing, request/rate limits and unlimited-by-default upload cap. |
| `TrustRequirements` | Descriptive names for the mandatory signed Invite Owner pin, explicit Publisher fingerprint approval and verified-staging/atomic-activation flow. It exposes no boolean bypass. |
| `TeamForgeProfile` | Immutable named composition of the applicable value snapshots. It is not a service, registry, interface hierarchy or user-selectable profile framework. |

The three runtimes keep small language-local value types rather than introducing a cross-package service framework. Unity resolves its transient profile from the existing serialized settings. Server resolves a profile from environment input and then returns the exact historical config object shape. Project Peer constructors and CLI fallbacks read the shared Node profile constants.

## LegacyPhase4Compatible values

### Unity connection/realtime

- Server `http://127.0.0.1:5080`; realtime path `ws`
- connection and Hello timeout `10 s`; keepalive `20 s`
- automatic reconnect enabled; maximum reconnect delay `30 s`; existing exponential sequence unchanged
- Presence `5 Hz`, heartbeat `5 s`; Transform `10 Hz`; Lock renewal `5 s`
- Existing `EnsureDefaults` clamps remain: timeout `1..120`, reconnect max `1..300`, Presence `1..20`, heartbeat `2..60`, Transform `1..30`, Lock renewal `1..30`

### Server

- host `127.0.0.1`, port `5080`, WebSocket `/ws`, health `/health`
- message `1,048,576 B`, connections `32`, rate `60/s`, Lock lease `15,000 ms`
- recent operations `4,096`, retained Transforms `512`
- Hierarchy objects `2,048`, Tombstones `4,096`, snapshot `1,048,576 B`, depth `256`, name `128`
- Locks `8/connection`, `256/session`; snapshot `921,600 B`; buffered `1,048,576 B`
- Hello `10,000 ms`; heartbeat interval/timeout `15,000/45,000 ms`
- Project registries `1,024`; Project Peers/session `32`
- Every existing `TEAMFORGE_*` environment override and range is unchanged.

### Project Peer

- Coordinator `http://127.0.0.1:5080`, realtime path `ws`, timeout `10,000 ms`
- Seed reconnect base/max `1,000/10,000 ms`, exponent limit `4`
- Direct bind `127.0.0.1:0`, base path `/teamforge-transfer/v1`
- Swarm concurrency `4`, timeout `10,000 ms`, retry rounds `3`, retry base/max `100/5,000 ms`, jitter `0.2`, peer interval `10 ms`
- JSON `2,097,152 B`, Chunk `4,194,304 B`, concurrent requests `8`, request rate `120/s`
- upload limit `0` (unlimited); all current CLI options and explicit overrides retain their original validation and precedence.

## Non-configurable safety invariants

No profile option or disable flag was added for:

- Project UUID validation;
- Owner, Publisher, Descriptor and proof/signature validation;
- Manifest, Chunk, File and final SHA-256/size verification;
- path containment/traversal defense;
- symlink/junction and case-collision policy;
- verified Staging before atomic activation;
- non-destructive existing Active/User Project handling;
- authoritative Revision, Lock, Hierarchy and Tombstone rules.

Credentials and private keys are not profile tuning values. Bearer tokens remain on their current runtime path and are not copied into the Server policy snapshot or diagnostics.

## Before/after parity

- Unity keeps the same settings asset schema, Settings UI, public/static API, endpoint construction, Bearer path, lifecycle, reconnect, assembly-reload resume, Presence/Transform pacing and Lock renewal behavior.
- Server `configFromEnv()` returns the same enumerable keys in the same order and applies the same path/range/error semantics; host/HTTP/WebSocket/JSON/timer/authority code is unchanged.
- Project Peer keeps every command, option, alias, precedence rule, constructor parameter, validation/error code, Direct HTTP route, Swarm behavior, trust prompt and activation path.
- Realtime Protocol v1, Project Transfer v1, message/capability/snapshot ordering, payload topology and all hard safety checks are unchanged.

## Verification evidence

| Check | Result | Provenance |
| --- | --- | --- |
| Server tests | **70/70 PASS** | Executed locally after edits; prior 68 plus 2 WP7 profile tests |
| Project Peer tests | **73/73 PASS** | Executed locally after edits; prior 70 plus 3 WP7 profile tests |
| Server syntax/check | **PASS** | Executed locally after edits |
| Project Peer syntax/check | **PASS** | Executed locally after edits |
| Server smoke | **PASS** | Executed locally after edits |
| Project Peer Direct Transfer smoke | **PASS** | Executed locally after edits |
| C# lexical/static validator | **PASS** | Executed locally; this is not Unity compilation |
| Repository validator | **PASS** | Executed locally after WP7 report/validator freeze |
| Unity EditMode in `6000.3.21f1` | **105/105 PASS** | Executed locally after edits; prior 102 plus 3 WP7 tests; result XML reports Passed, 0 failed, 0 skipped |
| A/B/C manual smoke | **NOT RUN** | Prior WP6 field evidence is not restated as a WP7 execution |
| Fresh archive verification | **PASS** | Archive entry comparison, extraction, hash and fresh-copy Node checks performed after packaging |

## Risks and ambiguities

- Unity profile snapshots are resolved on demand so changing an existing Settings UI value retains the historical “next relevant decision” behavior. They are immutable after creation but intentionally not cached across a live settings edit.
- JavaScript immutability is shallow by language convention; all current policy fields are primitives, and the profile and nested snapshots are frozen.
- Server resource ceilings remain environment-overridable because removing those documented inputs would break compatibility. They remain positive bounded limits, not switches that bypass validation.
- `TrustRequirements` is descriptive and deliberately cannot select weaker trust behavior. A future product profile must not turn hard safety floors into tuning knobs.
- Unity compilation and EditMode passed, but a new A/B/C multi-editor smoke was not run. EditMode cannot by itself prove multi-process reconnect or field-network behavior.

## Candidate and boundary

Candidate: `Unity-TeamForge-Phase4.5-WP7-policy-profile-resolution.zip`. Its SHA-256 is recorded in the adjacent `.sha256` sidecar and final handoff because embedding an archive hash inside that same archive is circular.

WP7 is complete. WP8 closure work, new user profiles/UI, tuning changes, new transport/routes, WebRTC/ICE/STUN/TURN/Relay, Phase 5 and Protocol v2 were not started.
