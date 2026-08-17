# Phase 3 v0.4.1 Unity hotfix session

Last updated: 2026-08-04 21:58:00 UTC+09:00

## Input and working copy

- Input archive: `Unity-TeamForge-Phase3-v0.4.1-final(3).zip`
- Input SHA-256: `F780C825A87321E81130B21DBDDBAAA260C70FE9278FDF9B3AA544D6C289E41F`
- Archive entries: 173
- Working copy: `<WORK_ROOT>/src`
- The input archive is preserved unchanged. All edits occur only in the working copy.

## User-approved scope

- Stay entirely within Phase 3 v0.4.1 stabilization.
- Preserve the manually passed Phase 1 Presence and Phase 2 Transform/Lock behavior.
- Do not implement, scaffold, test, or document Phase 4 Hierarchy Synchronization as started.
- Fix the Unity 6000.3.21f1 `PackageInfo` CS0104 compile failure.
- Improve the Bootstrap UI so a published baseline with no online direct seed is distinguishable from no published baseline.
- Add regression tests and update release/work-state documentation.
- Preserve coordinator metadata-only behavior, direct P2P payload transfer, hashes, signatures, publisher approval, resume, failover, atomic Active activation, and secret exclusion.

## Confirmed field evidence from user testing

- Unity 6000.3.21f1 exposes an ambiguous `PackageInfo` reference when the package test assembly is enabled.
- Fully qualifying `UnityEditor.PackageManager.PackageInfo` removes the compile error.
- With the publish/seed sidecar online, the UI reports `Identity and baseline metadata match`.
- When that sidecar exits, the same project reports `No verified baseline or direct seed is available`, even though the baseline metadata remains published; this wording conflates two different states.

## External references reviewed

- Unity package test documentation: Embedded package tests are available directly; other dependency types use `testables` in the project manifest.
- Unity Package Manager API: `PackageInfo.FindForAssembly` belongs to `UnityEditor.PackageManager.PackageInfo`.
- Microsoft C# CS0104 guidance: resolve ambiguous type names with a fully qualified name or alias.

## Planned implementation

1. Apply the fully qualified `UnityEditor.PackageManager.PackageInfo` reference.
2. Add a distinct `BaselineAvailableNoSeed` bootstrap state.
3. Return the new state only when baseline and matching local descriptor exist but no selectable direct seed is online.
4. Keep `BaselineUnavailable` for the actual absence of a verified baseline.
5. Add Unity EditMode regression coverage for the fixed API reference and state/status separation.
6. Run repository install, Node test, smoke, validator, syntax and audit gates.
7. Package a new candidate only after source and documentation review.

## Honesty boundaries

- Unity batch/EditMode execution will be reported only if a Unity executable is actually available and runs successfully in this environment.
- Docker results will be reported only if Docker is available.
- Any unavailable download or dependency will be reported to the user immediately with the exact required item.


## Implementation and evidence completed

- H-001 fixed with `UnityEditor.PackageManager.PackageInfo.FindForAssembly`; unused namespace import removed.
- H-002 fixed with a distinct retained-baseline/no-seed state and precise Bootstrap/Download text.
- Existing enum numeric values are preserved; the new state is appended as value 10.
- Unity EditMode regression source covers availability policy, enum stability, and exact Bootstrap text.
- Repository validator rejects a bare PackageInfo call and verifies enum/state/UI wiring.
- Validator PASS: 176 files, 29 C# sources, protocol v1.
- JavaScript syntax PASS: 42/42.
- Focused dependency-independent Node suites PASS: 38/38.
- Modified Embedded Package manifest scan PASS: 79/79 files, 374,611 bytes, 79 chunks.
- Added `scripts/validate-hotfix-windows.ps1` for the remaining Node and Unity host gates.

## Remaining blockers

- Exact locked dependency `ws@8.21.1` could not be downloaded through this execution environment's npm route, so a new full root install/test/smoke/audit is not claimed here.
- Unity 6000.3.21f1 and Windows PowerShell are unavailable in this container, so Batch Compile/EditMode and the Windows validation script are not claimed here.
- The candidate may be packaged and fresh-extract statically verified, but it remains a release candidate until the user host gates pass.


## Candidate packaging status

- Source-only candidate inventory: 176 files.
- Excluded: `node_modules`, `validation-output`, Unity generated directories, local tokens/keys, backups, and temporary test trees.
- First clean extraction matched source hashes 176/176 and passed validator, 42/42 `.mjs` syntax, and 38/38 focused suites.
- Documentation was then updated with this evidence, so the archive must be rebuilt once more and receive a final fresh-extract check before delivery.

## 2026-08-07 Unity EditMode field failures — Hotfix2

User reran Unity 6000.3.21f1 EditMode tests after saving/reopening the Scene. The same failures reproduced, proving the failures were not caused by the user leaving a Scene unsaved.

Confirmed test-harness defects:

- Eight scene tests called `EditorSceneManager.NewScene(..., NewSceneMode.Additive)` while Unity Test Runner can own an unsaved `Untitled` Scene. Unity throws `InvalidOperationException: Cannot create a new scene additively with an untitled scene unsaved` before TeamForge assertions execute.
- `ApplyingInvitationPolicyClearsBearerAndAssemblyReloadResumeIntent` called `ScriptableObject.CreateInstance<TeamForgeConnectionSettings>()` even though `TeamForgeConnectionSettings` derives from `ScriptableSingleton<TeamForgeConnectionSettings>`. Unity reports `ScriptableSingleton already exists`.

Hotfix2 source changes:

- Scene-isolation tests now create/open their temporary working Scene with `Single`, avoiding dependency on the Test Runner host Scene and preserving the actual TeamForge assertions inside the temporary Scene.
- The invitation-policy test now uses `TeamForgeConnectionSettings.instance`, snapshots every field touched by the policy, and restores those fields in `finally`. It does not call `SaveSettings`, so the test does not intentionally persist the temporary values.
- Repository validation now rejects reintroduction of additive scene creation in the affected EditMode fixtures and rejects `CreateInstance<TeamForgeConnectionSettings>` in package tests.

This remains Phase 3 test stabilization only. No Phase 4 source or behavior is introduced.

## Hotfix2 automated evidence in container

- Exact user-supplied `ws-8.21.1.tgz` SHA-512 matches the unchanged lockfile integrity value.
- Fresh root `npm ci --offline`: PASS; 4 packages added, 7 audited, 0 vulnerabilities.
- Server suite: 37/37 PASS.
- Project Peer suite: 59/59 PASS.
- Repository validator: PASS, 176 tracked files / 29 C# sources / protocol v1.
- Smoke: PASS; direct transfer enabled and `serverRelayUsed=false`.
- Audit: 0 vulnerabilities.
- Unity 6000.3.21f1 EditMode rerun for Hotfix2 is still required on the user's Windows host; do not claim Unity PASS until that rerun succeeds.
