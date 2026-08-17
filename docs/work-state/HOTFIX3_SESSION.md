# Phase 3 v0.4.1 Hotfix3 Unity EditMode stabilization

Date: 2026-08-07
Scope: Phase 3 stabilization only. Phase 4 remains forbidden.

## User field evidence

Hotfix2 reduced Unity 6000.3.21f1 EditMode failures to four:

1. `SavedSceneObjectIdSurvivesReparentAndReloadWhileDuplicateGetsNewId`
   - failed at `EditorSceneManager.CloseScene(workingScene, true)`
   - Unity logged that unloading the last loaded Scene is unsupported.
2. `CleanSceneBaselineExcludesObjectsCreatedAfterCapture`
   - expected dirty-scene baseline capture rejection, but the programmatic edit had not explicitly marked the Scene dirty.
3. `RemoteApplyClearsOnlyTargetUndoAndCannotResurrectStaleTransform`
   - the target stale transform did not reappear, but Unity 6000.3 preserved the cleared target Undo group as an empty no-op step, so the guard Undo was one step later than the test assumed.
4. `RemoteApplyToPrefabInstanceRecordsOverrideAndSurvivesReload`
   - failed at the same unsupported last-Scene `CloseScene` call before reload assertions executed.

The repeated `Unloading the last loaded scene ... is not supported` messages in otherwise passing scene tests are also test-harness cleanup defects.

The Input Manager deprecation message is unrelated to TeamForge and is not a release failure.

## Research notes

- Unity's `EditorSceneManager` does not support explicitly unloading the final loaded Scene; tests should switch Scenes rather than close the last one.
- `EditorSceneManager.MarkSceneDirty` is the correct explicit way to model a programmatic unsaved Scene modification when no Undo/SerializedProperty operation is used.
- Unity documents `Undo.ClearUndo(Object)` narrowly and Undo groups can retain grouping behavior after an object's history is removed. The invariant we care about is that the authoritative remote transform never resurrects; the test must not assume an empty cleared group is pruned from the stack.
- `PrefabUtility.RecordPrefabInstancePropertyModifications` remains required after direct Prefab-instance property writes so changes survive Scene save/reload.

## Hotfix3 changes

- `TeamForgeGlobalObjectIdProbeTests.cs`
  - reload via `NewSceneMode.Single` switch + `OpenSceneMode.Single`; never explicitly close the last loaded Scene.
  - cleanup switches to a neutral Single Scene before deleting temporary assets.
- `TeamForgePresenceSafetyTests.cs`
  - cleanup switches to a neutral Single Scene.
- `TeamForgeTransformModelTests.cs`
  - all temporary Scene cleanup switches rather than closing the final Scene.
  - Prefab reload switches away and reopens instead of closing the only Scene.
  - dirty-baseline test explicitly calls `EditorSceneManager.MarkSceneDirty`.
  - target-Undo test allows one empty cleared Undo group while asserting after every Undo that the authoritative remote target never changes.
- `scripts/validate-repository.mjs`
  - rejects reintroduction of `CloseScene(workingScene...)` in these fixtures.
  - requires explicit dirty marking in the dirty-baseline regression.
  - requires the guarded no-op Undo handling.

## Product-code impact

No Runtime/Editor product behavior, protocol, crypto, transfer, Project Bootstrap, Presence, Transform implementation, or Lock implementation is changed in Hotfix3. These are EditMode test-harness corrections that allow Unity 6000.3.21f1 to test the existing product behavior accurately.

## Remaining gate

Run Hotfix3 EditMode `Run All` on Unity 6000.3.21f1. Require Failed 0. If a reload/prefab/global-ID assertion now reaches and fails past the former CloseScene point, treat that as new product/test evidence rather than masking it.


## 2026-08-07 Hotfix3 fresh-extract archive validation

The first fresh-extract attempt was interrupted before extraction completed and is not evidence. A new clean directory was created and the Hotfix3 candidate was validated from scratch.

- ZIP integrity test: PASS; 177 file entries, corrupt member: none.
- Fresh extraction: 177 files. ZIP member SHA-256 vs extracted file SHA-256: 177/177 match before install.
- Exact user-supplied `ws@8.21.1` tarball was used only to seed a separate offline npm cache; repository lockfiles and dependency versions were unchanged.
- Fresh root `npm ci --offline`: PASS; 4 packages added, 7 audited, 0 vulnerabilities.
- Fresh root `npm test`: PASS; Server 37/37, Project Peer 59/59, Repository Validator PASS at 177 files / 29 C# sources / protocol v1.
- Fresh source-only `.mjs` syntax: 42/42 PASS.
- Fresh root `npm run smoke`: PASS; Server flow PASS and Project Peer reports `serverRelayUsed=false`.
- Fresh root `npm audit --omit=dev --offline`: 0 vulnerabilities.
- Post-test source integrity: all 177 packaged source files still match the candidate ZIP hashes; generated `node_modules` is excluded.
- Forbidden generated Unity/source entries (`Library`, `Temp`, `Logs`, `UserSettings`) in the packaged source: 0.
- Unity 6000.3.21f1 EditMode `Run All` for Hotfix3 remains the only immediate Hotfix3-specific field gate and is NOT claimed by this container.

Phase 4 remains forbidden until the remaining Unity/manual Phase 3 release gates pass and the user explicitly approves Phase 4.
