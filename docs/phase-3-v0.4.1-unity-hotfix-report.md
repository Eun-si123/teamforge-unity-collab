# Unity TeamForge Phase 3 v0.4.1 Unity field hotfix report

Last updated: 2026-08-04 21:53:28 UTC+09:00

## Scope and phase boundary

This hotfix remains entirely inside Phase 3 v0.4.1 stabilization.

- Phase 1 Presence: preserved; user manual gate already passed.
- Phase 2 Transform Sync and Basic Locking: preserved; user manual gate already passed.
- Phase 3 P2P Project Bootstrap and Swarm: the only implementation scope.
- Phase 4 Hierarchy Synchronization: not started; no source, test, or documentation claims it is underway.
- Phases 5–6: not started.

## User-reproduced defects

### H-001 — Unity 6000.3.21f1 CS0104 in package EditMode tests

When the TeamForge package test assembly was enabled, Unity compiled `Tests/Editor/TeamForgeEditorSurfaceTests.cs` and reported:

```text
error CS0104: 'PackageInfo' is an ambiguous reference between
'UnityEditor.PackageManager.PackageInfo' and 'UnityEditor.PackageInfo'
```

Root cause: the test imported namespaces that expose two different `PackageInfo` types and used the unqualified name.

Fix:

```csharp
var packageInfo =
    UnityEditor.PackageManager.PackageInfo.FindForAssembly(editorAssembly);
```

The unused `using UnityEditor.PackageManager;` directive was removed. The repository validator now rejects a return to bare `PackageInfo.FindForAssembly` and requires the fully qualified API.

Official references:

- [Unity PackageInfo.FindForAssembly API](https://docs.unity3d.com/kr/2021.3/ScriptReference/PackageManager.PackageInfo.FindForAssembly.html)
- [Microsoft CS0104 guidance](https://learn.microsoft.com/ko-kr/dotnet/csharp/misc/cs0104)
- [Unity package test activation](https://docs.unity3d.com/kr/current/Manual/cus-tests.html)

### H-002 — Bootstrap UI conflated missing baseline and offline seed

Observed behavior:

- Publish/Seed sidecar online: `Identity and baseline metadata match`.
- Same sidecar stopped: `No verified baseline or direct seed is available`.

The second message was inaccurate because the verified baseline remained in coordinator metadata; only the direct seed disappeared.

Fix:

- Added `TeamForgeProjectBootstrapState.BaselineAvailableNoSeed`.
- `BaselineUnavailable` now means no verified baseline has been published.
- `BaselineAvailableNoSeed` means matching baseline/descriptor metadata exists but no selectable direct seed is online.
- `Ready` still requires a matching baseline, matching local descriptor, and an online selectable seed.

New UI text:

```text
No verified baseline has been published
Verified baseline exists · no direct seed is online
Identity and baseline metadata match
```

The download guidance now also says whether it is waiting for both a baseline and seed, or only for a seed while retaining the published baseline.

## Product and security invariants retained

- Product version remains `0.4.1`; Realtime, Transfer, and Manifest protocols remain v1.
- Coordinator remains metadata-only and does not store or relay project payload.
- Direct P2P transfer, hash verification, signatures, publisher approval, staging, resume, failover, and atomic Active creation are unchanged.
- No token, Owner private key, invite secret, machine-local path, Unity generated directory, or project payload field was introduced.
- No Phase 4 hierarchy operation was introduced.

## Source changes

- `unity-package/com.eunsung.teamforge/Tests/Editor/TeamForgeEditorSurfaceTests.cs`
  - Fully qualifies Package Manager `PackageInfo`.
  - Adds regression coverage for the three availability outcomes and exact status text.
- `unity-package/com.eunsung.teamforge/Editor/ProjectTransfer/TeamForgeProjectModel.cs`
  - Adds `BaselineAvailableNoSeed` and a small pure availability policy.
  - Preserves the numeric values of every pre-existing bootstrap enum member; the new state is appended as value 10.
- `unity-package/com.eunsung.teamforge/Editor/ProjectTransfer/TeamForgeProjectService.cs`
  - Uses the availability policy in the actual state machine.
- `unity-package/com.eunsung.teamforge/Editor/UI/TeamForgeWindow.cs`
  - Separates baseline-missing and seed-offline status/download wording.
- `scripts/validate-repository.mjs`
  - Adds static regressions for the Unity API qualification, enum numeric stability, and new state/status wiring.
- `scripts/validate-hotfix-windows.ps1`
  - Runs unchanged-lockfile Node install/test/smoke/audit plus Unity 6000.3.21f1 Batch Compile and EditMode into a separate ignored evidence directory.
- `docs/work-state/*`
  - Records provenance, decisions, evidence, blockers, and resume instructions.

## Verification completed in this environment

- Repository validator: PASS, 176 tracked source files, 29 C# sources, protocol v1.
- JavaScript syntax: PASS, 42/42 `.mjs` files.
- Focused Project Peer suites not requiring the unavailable `ws` package:
  - Manifest/path: 9/9 PASS.
  - Direct transfer: 11/11 PASS.
  - Swarm downloader: 13/13 PASS.
  - Real transport/process E2E: 5/5 PASS.
- Modified Embedded TeamForge package direct manifest scan:
  - Package source file set equals Publish Manifest package file set.
  - 79 package files included, 374,611 package bytes, and 79 package chunks.
  - Fully qualified PackageInfo fix present in the copied Embedded package.

## Fresh-extract candidate verification

A source-only candidate was built with no wrapping directory and without `node_modules`, Unity generated directories, local validation output, secrets, or backup files. A clean extraction was compared file-by-file with the working source.

- Archive source entries: 176.
- Source/fresh SHA-256 file match: 176/176.
- Fresh validator: PASS, 176 files / 29 C# / protocol v1.
- Fresh `.mjs` syntax: 42/42 PASS.
- Fresh focused suites: 38/38 PASS.
- The final archive hash is recorded in the external `.sha256` sidecar and delivery report because an archive cannot safely contain its own final hash.

## Environment limitations and blocked gates

### npm dependency download

Root `npm ci` could not complete in this environment because the configured internal npm mirror returned HTTP 404 for the locked `ws@8.21.1` tarball. A direct public-registry attempt was also unavailable due the container network boundary.

This is recorded as an environment/download blocker, not a product test failure. Full Server/Project Peer root tests, smoke, and audit are therefore not newly claimed for this hotfix candidate. The dependency and lockfiles were not changed.

Required item if local dependency recovery is needed here:

```text
ws-8.21.1.tgz
```

or a working npm registry route capable of serving the exact lockfile artifact.

### Unity

No Unity executable is installed in this execution container. Unity compile and EditMode results are not claimed here. The user's field observation confirms the original CS0104 and confirms that the one-line qualification removes it, but the final hotfix candidate still requires a clean Unity 6000.3.21f1 Batch Compile and EditMode run.

### Docker

Docker was not discovered or executed; no Docker result is claimed.

## Remaining release gate

1. On a Windows host with Node and Unity installed, close the validation Project and run `powershell -ExecutionPolicy Bypass -File .\scripts\validate-hotfix-windows.ps1`. This uses the unchanged lockfile and performs root install/test/smoke/audit plus Unity Batch Compile/EditMode.
2. Run Unity 6000.3.21f1 Batch Compile and EditMode; require exit 0 and Failed 0.
3. Confirm the PackageInfo CS0104 does not recur with the test assembly enabled.
4. Publish a baseline and verify all three Bootstrap messages:
   - before baseline,
   - baseline + online seed,
   - same baseline after the final seed exits.
5. Complete Publish → Invite → Sync → Active → Menu → Connected → RTT plus resume/failover/port release.
6. Do not begin Phase 4 until the user explicitly approves it after every Phase 3 gate passes.

## H-003 — EditMode scene tests collide with Test Runner Untitled Scene

Field reproduction on Unity `6000.3.21f1` showed eight tests failing before their TeamForge assertions with:

```text
InvalidOperationException: Cannot create a new scene additively with an untitled scene unsaved.
```

Saving and reopening a Scene did not change the failure set. The affected fixtures created temporary Editor Scenes with `NewSceneMode.Additive`; Unity 6 can reject additive creation while an unsaved Untitled Scene exists. The tests now use isolated `Single` temporary Scenes (and `OpenSceneMode.Single` for their reload step) so their outcome no longer depends on the Test Runner's host Scene state.

## H-004 — ScriptableSingleton test creates an illegal second instance

`ApplyingInvitationPolicyClearsBearerAndAssemblyReloadResumeIntent` used:

```csharp
ScriptableObject.CreateInstance<TeamForgeConnectionSettings>()
```

but `TeamForgeConnectionSettings` derives from `ScriptableSingleton<TeamForgeConnectionSettings>`. Unity reported `ScriptableSingleton already exists`. The test now uses `TeamForgeConnectionSettings.instance`, snapshots the fields modified by invitation application, and restores them in `finally` without persisting the test values.

Both fixes are test-harness changes only. Product runtime behavior and Phase 1/2/3 wire behavior are unchanged.


## H-005 — Hotfix2 last-Scene lifecycle and Undo assumptions

The Hotfix2 Unity 6000.3.21f1 field rerun reached product assertions but left four failures. The common lifecycle defect was `EditorSceneManager.CloseScene` on the only loaded Scene; Unity rejects unloading the final loaded Scene. Hotfix3 switches to a neutral `NewSceneMode.Single` Scene and reopens saved fixtures with `OpenSceneMode.Single`, so reload tests actually reach their persistence assertions.

The clean-baseline fixture now explicitly calls `EditorSceneManager.MarkSceneDirty` after programmatic Scene edits, rather than assuming raw script-side object creation/reparenting sets `scene.isDirty`.

The target-Undo fixture now permits Unity 6000.3 to retain the cleared target Undo group as an empty no-op step. It still asserts after every Undo that the authoritative remote Transform never returns to the stale local value and that the unrelated guard Undo remains available.

No product runtime behavior changed for H-005.


### H-005 automated regression evidence

After Hotfix3 test-harness changes, the unchanged dependency graph passes Server 37/37, Project Peer 59/59, repository validation (177 files / 29 C# / protocol v1), both smoke flows, and audit with 0 vulnerabilities on Node 22.16.0. Unity EditMode must still be rerun on the user's Unity 6000.3.21f1 host; no Unity PASS is inferred from Node evidence.
