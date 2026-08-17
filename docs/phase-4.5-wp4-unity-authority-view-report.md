# TeamForge Phase 4.5 WP4 — Unity Authority View Report

Date: 2026-08-11 (Asia/Seoul)

## Scope and baseline

WP4 moves only shared observed Unity client Authority state out of `TeamForgeTransformSyncService`. The exact input is `Unity-TeamForge-Phase4.5-WP3-project-coordinator-core.zip`, SHA-256 `B20A9C5E4F6B991EADA69232DED1B3FA1A38BDCEB619D746B065470FB7D8FD89`.

The user reported WP3 Server `68/68`, Project Peer `63/63`, all smoke/validator checks and an actual Unity A/B/C smoke as normal. Those are prior user field evidence, not Unity execution performed by WP4. WP5 and all later work were not started.

## Internet research before implementation

Official and primary material reviewed before code changes:

- Unity `ScriptableSingleton<T>`: <https://docs.unity3d.com/6000.0/Documentation/ScriptReference/ScriptableSingleton_1.html>
- Unity `FilePathAttribute`: <https://docs.unity3d.com/6000.0/Documentation/ScriptReference/FilePathAttribute.html>
- Unity `InitializeOnLoadAttribute`: <https://docs.unity3d.com/6000.0/Documentation/ScriptReference/InitializeOnLoadAttribute.html>
- Unity `AssemblyReloadEvents`: <https://docs.unity3d.com/6000.0/Documentation/ScriptReference/AssemblyReloadEvents.html>
- Unity Domain Reloading: <https://docs.unity.cn/6000.1/Documentation/Manual/domain-reloading.html>
- Microsoft C# static constructors: <https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/static-constructors>
- Microsoft C# classes and accessibility specification: <https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/classes>
- Microsoft C# nested types: <https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/nested-types>

Implementation consequences:

- `ScriptableSingleton` can retain serializable state through assembly reload and, with `FilePath`, persist it across Editor sessions. Revision, Locks and connection identity describe only the current live Server connection, so WP4 deliberately keeps them in a transient static view rather than an Editor asset.
- `InitializeOnLoad` is used only to establish event wiring and initialize plain managed state. The static constructor performs no asset load/save and no blocking work.
- Unity reload documentation requires static state and event subscriptions to be treated as reload-scoped. The view rebuilds its subscriptions on initialization and samples the current Connection Service state; it does not claim persistent authority recovery.
- The minimal `IAuthorityView` and implementation stay internal to the existing Editor assembly. This avoids a new asmdef or public API while the existing public Transform facade remains source-compatible.
- Static construction is kept exception-light and synchronous in line with Microsoft's initialization guidance. No timer, thread, socket or Unity object operation was added.

## Authority View responsibilities

`TeamForgeAuthorityView` now owns the Unity client's current observed view of:

- monotonic shared Session Revision;
- the single shared `TeamForgeLockRegistry`;
- connected state and current connection ID;
- negotiated Presence, Transform, Hierarchy and Project Transfer availability;
- reset of Revision/Locks when connection identity changes;
- revision and Lock observation commands used by existing snapshot/live handlers;
- a shared change notification consumed by the existing Transform facade.

It does not own Server approval rules, Revision increments, Lock lease decisions, Transform/Hierarchy application, socket/JSON routing, persistence or recovery.

## Collaboration dependencies after WP4

Transform Sync consumes `IAuthorityView` for shared Revision, Locks, capabilities and connection identity. It still owns local Transform observation, pending operations, lock-request UX, authoritative Transform materialization, dirty Scene protection and baseline/conflict tracking.

Hierarchy Sync consumes the same view directly. It no longer reads `TeamForgeTransformSyncService.CurrentRevision`, `Locks` or its authoritative-revision helper. The remaining calls to `TeamForgeTransformSyncService.ApplyHierarchyAuthoritativeState` preserve the existing Transform-baseline coherence after authoritative Hierarchy materialization; they are a Collaboration apply dependency, not Authority state ownership.

`TeamForgeTransformSyncService.CurrentRevision` and `Locks` remain public static facade aliases to the shared view, preserving current UI and package callers. Existing Connection Service message routing and editor lifecycle wiring remain in place.

## Compatibility and parity

- Protocol v1 and Project Transfer v1 files/fixtures: **UNCHANGED**.
- Server and `project-peer` product sources: **UNCHANGED**.
- Hierarchy/Transform snapshot and live message handlers retain their established order.
- Revision observation remains monotonic, matching the prior `Math.Max` behavior.
- Lock replacement/upsert/remove still uses the same `TeamForgeLockRegistry` validation and events.
- Dirty Scene/Undo protection and remote-apply scopes were not edited.
- No asmdef, public API, transport, Connection Strategy, Policy/Profile, WebRTC or Phase 5 code was introduced.

## Verification performed in WP4

Environment: Node `v24.18.1`; Unity installation `6000.3.21f1` present at the exact Hub path.

- Server suite: **68/68 PASS**.
- WP1 golden/characterization and WP2/WP3 Core coverage: **PASS** within the Server suite.
- Project Peer suite: **63/63 PASS**.
- Server syntax check: **PASS**.
- Project Peer syntax check: **PASS**, 34 modules.
- Server smoke: **PASS** — health, legacy Hello, ping, Presence, Transform, Lock, Project snapshot and Revision 1.
- Project Peer smoke: **PASS** — direct transfer and Descriptor/Manifest hashes; `serverRelayUsed=false`.
- Repository validator: **PASS** after WP4 source changes; the final clean/fresh-archive result is recorded in the release handoff.
- Product C# static compile against installed Unity `6000.3.21f1` managed assemblies: **PASS**, 0 warnings and 0 errors.
- EditMode test-source static compile against the same Unity assemblies and bundled NUnit: **PASS**, 0 errors. It reports 37 pre-existing `CS0649` warnings for JsonUtility-populated golden fixture fields; WP4 adds no such warning.

Unity batch execution was attempted but **NOT COMPLETED**. The Editor could not register `com.unity.test-framework` or `com.eunsung.teamforge` after repeated headless licensing-channel timeouts and reported that the packages were not licensed/registered; no test result XML was produced. Therefore WP4 makes no Unity Test Runner PASS claim. With the WP1 user-verified baseline of 96 tests and three added WP4 tests, the exact expected EditMode count for user field verification is **99**.

## Risks and ambiguities

- Static initialization order is intentionally handled by sampling the current Connection Service state when the Authority View first initializes. A future lifecycle refactor must retain that behavior and avoid duplicate subscriptions when domain reload is disabled.
- Authority View state is transient. Assembly reload or Editor restart requires the existing reconnect/snapshot path to repopulate it; this is not Phase 5 recovery.
- `TeamForgeLockRegistry.Changed` can notify while a connection reset is being composed. Scalar identity/capability fields are updated before clearing Locks so observers see the new connection view.
- The internal interface is a read view, while mutation remains centralized in Authority View commands. Expanding it into a generalized command bus would be abstraction beyond WP4.
- The Hierarchy-to-Transform authoritative apply hook remains. Removing it would require a broader Collaboration Core materialization change and is outside WP4.
- Unity's actual compiler/Test Runner remains the release authority for the Editor assembly. The separate static compile is supporting evidence only, not a Unity execution substitute.

## Candidate and boundary

Candidate: `Unity-TeamForge-Phase4.5-WP4-unity-authority-view.zip`. Its SHA-256 is recorded in the adjacent `.sha256` sidecar and release handoff because embedding an archive hash inside that same archive is circular.

WP4 is complete. WP5 Transport factory/Legacy Connection Strategy, Policy/Profile, Transfer Core changes, WebRTC, Phase 5 and `project-peer` replacement were not started.
