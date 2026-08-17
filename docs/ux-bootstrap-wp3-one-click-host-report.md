# TeamForge UX Bootstrap WP3 — One-click Host Flow

Date: 2026-08-13 KST  
Baseline: approved UX Bootstrap WP2 candidate  
Scope: WP3 Host flow only

## Coordinator registry re-arm hotfix

The field regression `Publishing Seed failed before review confirmation [coordinator_registry_empty]` occurred when a source already held approved revision 2 but WP3 started a new in-memory Coordinator. The local plan correctly refused to treat an empty registry as permission for revision 3, but the Host orchestration had not first started the existing approved Seed that reconstructs registry state.

The hotfix preserves that guard and composes existing paths:

1. `commitHost` starts/reuses only the WP2-verified Coordinator and reads its Project Transfer snapshot through `CoordinatorClient`.
2. If the registry is empty and the source descriptor has a prior revision, the locally approved pointer, Manifest, signed Descriptor, Project UUID, revision, hashes, and Owner identity must already agree. Every Manifest Chunk must also pass the existing local hash-verified inventory check; incomplete local payloads fail as `baseline_unavailable`.
3. WP2 `ensureSeed` starts the existing `seed` CLI for that exact Manifest. The existing Project Peer core announces the signed Descriptor, inventory, endpoint/token, and Owner proof.
4. The existing Coordinator core verifies compatibility, Descriptor signatures, and Owner proof before its empty-registry `project_peer_announce` recovery path creates registry state. The orchestrator then reads the snapshot again and requires an exact identity match.
5. For changed source, only then does the existing Publish child validate the base, rescan, reproduce the exact review fingerprint, receive authenticated explicit `PUBLISH`, publish the next revision, and become the new Seed. The temporary prior-revision Seed is stopped cooperatively.
6. For unchanged source, the plan is marked `reuseExistingBaseline`; commit rescans before mutation, starts the exact approved Seed, creates a signed invite, and reaches Host Ready without publishing or advancing the revision.

The Unity dialog labels the no-change action `Start Existing Baseline`, not `Publish & Start`. The frozen operation/state surface, exact plan ID/fingerprint confirmation, and normal changed-source Publish confirmation remain intact.

## Result

The Unity Collaboration window now connects the frozen WP0 Host sequence to WP1 preflight and WP2-owned process lifecycle:

```text
Start Collaboration
→ Unified Preflight / explicit dependency repair when required
→ saved Scene and saved Asset boundary
→ explicit current-Project source consent
→ secret-free launch-settings generation
→ Publish Review
→ explicit Publish & Start
→ compatible/owned Coordinator ready
→ approved Baseline
→ exact owned Direct Seed ready
→ signed Project Transfer Invite
→ Host Ready
→ Copy Project Invite / Save Project Invite / Stop Collaboration
```

The existing CLI remains available as the Advanced/debug fallback. WP3 does not implement the Guest standalone launcher or Join bootstrap.

## Review and commit safety

`planHost` creates only the existing local publication draft and returns a review fingerprint. The fingerprint binds:

- exact launch-settings file digest;
- exact source `ProjectSettings/TeamForgeProject.json` digest;
- proposed Baseline revision and manifest hash;
- the full sorted added, changed, and deleted path sets;
- file, byte, and chunk counts.

The Unity dialog shows counts, size, and bounded path previews. Only the `Publish & Start` button sends the literal `PUBLISH` confirmation with the exact plan ID and fingerprint.

The existing Project Peer Publish command then resolves the Coordinator baseline, revalidates Project UUID and Owner state, rescans and signs the source, recomputes the same fingerprint, and pauses on authenticated child IPC. `TeamForgeProcessLifecycleManager.ensurePublishingSeed` confirms only an exact match. Any source, descriptor, launch-settings, baseline, manifest, or review change returns `source_changed`; no Baseline is acknowledged and the user must re-plan and re-review.

Normal CLI confirmation is unchanged: interactive use still types `PUBLISH`, and non-interactive Advanced use still requires the explicit `--confirm-publish` flag.

## Lifecycle reuse

- The Host orchestrator owns one `TeamForgeProcessLifecycleManager`; no Unity PID, port-kill, or parallel lifecycle implementation was added.
- Coordinator start/reuse uses the WP2 verified health identity contract. External compatible reuse stays `owned=false`; unknown/incompatible listeners remain `port_conflict` and are not killed or reused.
- The publishing Seed is an existing CLI child spawned and authenticated by WP2. It becomes manageable only after approved Publish and exact Project/Session/revision/manifest/endpoint/token-fingerprint readiness.
- Stop requests Seed first, then an owned Coordinator. It does not delete approved metadata, chunks, invitations, or Active data.
- Editor reload/quit writes a cooperative stop request and closes bridge stdin. The dependency-free bridge treats EOF as a bounded cooperative shutdown request; it does not call `Process.Kill` or kill by port/PID.

## Unity UI boundary

- Dirty or unsaved Scenes still use `TeamForgeQuickStartUtility.EnsureSavedActiveSceneInteractive`, which delegates to Unity's save/cancel prompt. A remaining dirty active Scene blocks planning.
- `AssetDatabase.SaveAssets()` runs before launch-settings export and review.
- Selecting the current Project as the Host source remains explicit. It does not itself publish anything.
- Existing differing launch settings require explicit replacement consent.
- Basic Host Ready UI displays Server ready, Seed ready, and Baseline revision. UUID, hashes, ports, transfer token, Owner private key, and authentication token are not displayed.
- Copy/Save operates on the signed Project Transfer invite, not the existing TF1 realtime-session code. The invite is generated only after approved Baseline and Seed readiness and contains no credentials/private key.

## Official/primary-source decisions

- Unity [`EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/SceneManagement.EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo.html) provides the explicit save/cancel boundary for modified open Scenes. WP3 preserves that user decision instead of silently saving or publishing dirty state.
- Unity [`AssetDatabase.SaveAssets`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/AssetDatabase.SaveAssets.html) writes unsaved asset changes. WP3 calls it before the source review is constructed.
- Unity [`EditorGUIUtility.systemCopyBuffer`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/EditorGUIUtility-systemCopyBuffer.html) is the Editor clipboard surface used only after a signed invite is ready.
- Unity [`EditorUtility.SaveFilePanel`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/EditorUtility.SaveFilePanel.html) returns the user-selected absolute output path for the explicit Save Invite action.
- Unity [`AssemblyReloadEvents.beforeAssemblyReload`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/AssemblyReloadEvents-beforeAssemblyReload.html) and [`EditorApplication.quitting`](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/EditorApplication-quitting.html) provide Editor teardown notifications. WP3 uses them to request cooperative shutdown without blocking indefinitely.
- Microsoft [`ProcessStartInfo.RedirectStandardInput`](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.redirectstandardinput) documents redirected child stdin with `UseShellExecute=false`; [`Process.BeginOutputReadLine`](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.beginoutputreadline) provides asynchronous redirected output. WP3 uses newline-delimited JSON only as a local UI bridge, not as a wire protocol or Authority identity.

## Executed evidence in the hotfix working candidate

- Focused WP0/WP1/WP2/WP3 Node tests: **PASS 19/19**.
- Project Peer full automated suite: **PASS 92/92**.
- TeamForge Server full automated suite: **PASS 72/72**.
- Exact stopped-revision-2 registry regression: **PASS** — a new empty Coordinator was rebuilt only by the exact revision-2 `seed` path; the unchanged source reached Host Ready with a signed invite and remained revision 2.
- Changed-source recovery regression: **PASS** — the previous signed Baseline re-armed the empty registry before the normal child review match, explicit Publish, next Baseline, and replacement Seed.
- Existing-Baseline source-change-after-review regression: **PASS** — returned `source_changed`, never returned Host Ready, and did not advance the descriptor.
- Actual first Host flow: **PASS** — explicit plan/commit, compatible owned Coordinator, approved revision 1, exact owned Seed, valid Owner-signed invite, Seed-first graceful stop.
- Source changed after review: **PASS** — returned `source_changed`, no Host Ready, source descriptor remained revision 0.
- Dependency-ready bridge inspect over its real newline JSON process boundary: **PASS**, state `idle`.
- Unity Editor assembly static compilation: **PASS**, all `36` Editor C# sources compiled with the installed Unity 6000.3.21f1 Roslyn compiler, NetStandard 2.1 references, and Unity Editor/Engine reference assemblies.
- Server and Project Peer syntax checks: **PASS**, including all `50` Project Peer modules.
- Server and direct Project Transfer smoke: **PASS**; direct transfer reported `serverRelayUsed=false`.
- Unity 6000.3.21f1 batchmode EditMode attempt: **NOT RUN** — no result XML was produced because the Licensing Client channel timed out and could not reconnect. The owned batchmode process was terminated after the bounded attempt; no test result is claimed.

Full Node/Server regression, repository static validation, source comparison, smoke, archive parity, dependency-free bridge bootstrap, and fresh-candidate tests are recorded separately after execution. They are not pre-claimed here.

## NOT RUN / not implemented

- Unity EditMode Test Runner execution: **NOT RUN**, license-blocked as described above.
- Manual interactive Unity window click-through: **NOT RUN**.
- A/B/C multi-Editor field Host/Guest session: **NOT RUN**.
- macOS/Linux Unity UI runtime: **NOT RUN**.
- WP4 Guest standalone launcher, Invite Sync, trust, activation, and Open Project UX: **NOT IMPLEMENTED**.
- Phase 5 persistent recovery: **NOT IMPLEMENTED**.
- WebRTC, ICE, STUN, TURN, Relay/NAT traversal: **NOT IMPLEMENTED**.
- Component Sync and arbitrary serialized-property sync: **NOT IMPLEMENTED**.

## Explicit invariant preservation

Realtime Protocol v1, Project Transfer v1, manifest schema v1, Project UUID/Owner pinning, Ed25519 Descriptor/Invite signatures, file/chunk/final hashes, source-descriptor compare-and-swap, approved-pointer monotonicity, direct-only payload topology, Authority ordering, trust, staging, and atomic activation behavior remain fail-closed and unchanged.
