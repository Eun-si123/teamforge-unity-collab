# TeamForge Phase 4 v0.5.0 — UX Pass 2 Hotfix1 Report

Date: 2026-08-10 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Base: UX Pass 2 / Hotfix6 authority model
Phase 5: NOT STARTED

## Field trigger

Unity compilation of UX Pass 2 stopped at `Editor/UX/TeamForgeBaselineFingerprint.cs` with CS0177: the `out string error` parameter could leave `TryValidateLocalScene` unassigned when `File.Exists(fullPath)` was false. The problematic expression combined a normal boolean check and a method assigning the `out` parameter with short-circuit `||`.

## Root cause

C# definite-assignment rules require every normal return path from a method to assign an `out` parameter. In `if (!File.Exists(fullPath) || !TryHashFile(..., out error))`, a missing file makes the left operand true, so the right operand is not evaluated and `error` is not assigned before `return false`.

## Fix

- Missing file is handled in its own branch and assigns a human-readable synchronization/copy error.
- Hash failure is handled in a second branch which receives `error` from `TryHashFile`.
- Repository validation now rejects reintroducing the short-circuit pattern.
- No protocol/server/project-peer/authority behavior changed.

## `(GetStatus) Cannot get non-existing progress id ...` investigation

The package source contains no call to `UnityEditor.Progress.GetStatus`, `Progress.Start`, `Progress.Report`, `Progress.Remove`, or related lifecycle API. The repository validator also forbids introducing those calls. TeamForge Test Lab uses the older `EditorUtility.DisplayProgressBar` only while an explicit managed-copy fallback is running; it is not invoked just by compiling/importing the package.

Unity's public Issue Tracker contains independent reports of the exact `(GetStatus) Cannot get non-existing progress id ...` Progress Window failure mode after background work/project startup. No official issue specific to `6000.3.21f1` was found during this investigation, so the field message is recorded as likely Unity Editor progress-system noise, not claimed as a TeamForge-owned defect without a TeamForge stack trace/reproducer.

## Required field retest

1. Replace UX Pass 2 with this Hotfix1 package.
2. Reopen/import in Unity `6000.3.21f1`.
3. Confirm TeamForge compile errors are 0.
4. Run EditMode `Run All`; expected source-discovered case count remains 90 and Failed must be 0.
5. Clear Console, wait for background tasks to settle, and note whether `(GetStatus)` reappears without invoking TeamForge. If it reappears with no TeamForge stack trace, keep it classified as Unity Editor noise; if a TeamForge call stack appears, capture that stack for a package fix.
