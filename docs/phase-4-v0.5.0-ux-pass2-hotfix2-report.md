# TeamForge Phase 4 v0.5.0 — UX Pass 2 Hotfix2 Report

Date: 2026-08-10 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Base: UX Pass 2 Hotfix1 / Hotfix6 authority model
Phase 5: NOT STARTED

## Field trigger

The user field-ran UX Pass 2 Hotfix1 in Unity `6000.3.21f1` and reported **90/90 EditMode PASS**. `Quick A/B/C Lab` then created/launched clone B and connected it to the local Coordinator, but B was still on Unity's unsaved `Untitled` Scene when auto-connect happened. B therefore rejected the authoritative Hierarchy snapshot because the host Scene was not loaded, while Transform/Realtime itself connected.

Observed field symptoms included:

- `Scene '' was not added to the Transform baseline: Scene must be loaded and saved ...`
- `Hierarchy snapshot rejected: Authoritative Scene ... is not loaded.`
- Home UI still said `Collaboration active`, which overstated readiness while Hierarchy had rejected its first snapshot.

A separate Project Coordinator UUID warning was also visible. It remains tracked separately because this field run did not prove its server/client root cause; this hotfix does not weaken Project UUID validation.

## Root cause

UX Pass 2 waited for `EditorApplication.isCompiling == false` and `EditorApplication.isUpdating == false` before clone auto-connect, but it did **not** carry the exact host Scene baseline into the clone bootstrap or ensure that the expected saved Scene was actually loaded before calling `TeamForgeConnectionService.Connect()`.

A freshly-launched cloned Unity Project can therefore be stable from the compiler/AssetDatabase point of view while still having an unsaved `Untitled` Scene active.

## Web/official API references used

The implementation follows Unity Editor APIs rather than guessing Scene state:

- `AssetDatabase.GUIDToAssetPath` resolves the copied Scene GUID to its project-relative asset path.
- `EditorSceneManager.OpenScene(path, OpenSceneMode.Single)` opens the exact Scene in the Editor and replaces the current open Scene set.
- `EditorApplication.isCompiling` and `EditorApplication.isUpdating` remain startup gates before manipulating Editor Scene state.
- `EditorApplication.update` is used for retry/settle sequencing across Editor updates.

## Fix

### Baseline-aware clone bootstrap

`TeamForgeCloneBootstrapData` now carries the source A Scene baseline (`scenePath`, `sceneGuid`, `sha256`). The baseline is copied after the Project clone is created and does not contain Bearer tokens/private keys.

### Exact Scene preparation before connect

B/C startup now:

1. waits for compile/import to be idle;
2. resolves the expected Scene GUID in the clone AssetDatabase;
3. verifies the exact saved `.unity` SHA-256 against A's baseline;
4. refuses to discard any dirty clone Scene;
5. opens the expected Scene with `OpenSceneMode.Single` when needed;
6. verifies that the opened Scene is valid/loaded and matches the expected path;
7. yields one additional Editor update so `sceneOpened`/Hierarchy callbacks can settle;
8. only then auto-connects B.

C performs the same Scene preparation but remains offline for Late Join as designed.

Transient AssetDatabase/hash/open failures are retried until a bounded 120-second startup deadline. Identity/hash mismatches and dirty local state fail closed and leave the clone offline.

### Honest Home readiness

The Hierarchy service now exposes `SnapshotReady`. When realtime is connected but the authoritative Hierarchy snapshot has not been accepted, Home displays `Collaboration partially ready` instead of `Collaboration active`.

## Regression coverage

- Added EditMode source test that verifies clone bootstrap schema serializes the exact host Scene baseline.
- Repository validator now requires baseline capture -> bootstrap wiring, exact GUID resolution, `EditorSceneManager.OpenScene(..., OpenSceneMode.Single)`, dirty-scene fail-closed behavior, one-update settle before connect, and partial-readiness UI.
- Existing Hotfix1 CS0177 guard remains.

## Authority/compatibility boundary

- Coordinator source: unchanged from Hotfix1.
- Project Peer source: unchanged from Hotfix1.
- Realtime protocol: v1 unchanged.
- Hierarchy/Transform/Lock authority semantics unchanged.
- Phase 5 remains not started.

## Required field retest

1. Replace the Unity package with UX Pass 2 Hotfix2.
2. Compile in Unity `6000.3.21f1` and run EditMode. Previous field baseline was 90/90; this hotfix adds one test, so source-discovered expected count is 91 and Failed must be 0.
3. Start the local Coordinator using `Start-TeamForge-Local.cmd` (or reuse a known clean 0.5.0 Coordinator instance).
4. In A, open/save `SampleScene`, Start Collaboration, then click Quick A/B/C Lab.
5. Verify B opens the **same saved SampleScene automatically before connecting**, then becomes connected without `Authoritative Scene ... is not loaded` / `Scene '' was not added...` warnings.
6. Verify C also opens the same SampleScene but stays offline.
7. Make a hierarchy change on A/B, then click `Connect Current` on C and verify Late Join convergence.
