# r7 field follow-up plan — 2026-10-04

## Problem

The exact-r7 physical Guest run exposed three related correctness/lifecycle gaps after the earlier managed-root fence fix:

1. **Existing verified Active recovery bypasses path resilience.** The normal receive→launch path prepares a short verified Unity execution alias when the canonical Active path is risky, but “Open existing verified project” launches the canonical path directly. On Windows this produced a real Unity `DirectoryNotFoundException` inside a long `Library/PackageCache/...dll` path.
2. **Host Ready can become stale.** A Host can still display `Host Ready · Baseline revision N` after the owned bridge/Seed is no longer proven available, while a Guest observes `baseline_unavailable: Published baseline has no direct Project Peer.`
3. **A project UUID directory can be selected again as the managed root.** The observed path contained `<UUID>\<UUID>\active\...`. TeamForge must not silently create another project root inside an already managed project directory.

## Intended outcome

- Every verified Existing-Active Unity launch uses the same bounded path-strategy policy as a newly received Active.
- Host Ready represents a currently proven owned Direct Seed / Coordinator advertisement, or degrades to NeedsAction instead of remaining stale.
- Selecting an existing TeamForge project directory as the projects root fails closed with a specific recovery message; TeamForge does not silently rewrite the user's destination.

## Scope

### In scope
- Windows Launcher Existing-Active validation/launch path.
- Guest managed-root shape validation for the exact invited Project UUID.
- Project Peer lifecycle health/status surfaced to the Unity Host UX.
- Regression tests and dated/current status evidence updates after validation.

### Out of scope
- Broad redesign of managed-root storage.
- Changing protocol versions.
- Opening firewall rules on Public networks.
- Claiming the physical `baseline_unavailable` root cause is fixed until exact packaged field retest.

## Risk classification

**High**: verified project activation paths, filesystem identity, process lifecycle, and direct-transfer availability are involved.

## Invariants

- A convenience alias must stay bound to the exact verified Project UUID + Baseline revision + manifest hash.
- Existing Active validation must remain fail-closed on path/identity tampering.
- A stale Host process must never be presented as proven Ready.
- Guest destination correction must never silently move or adopt an unrelated directory.
- Access codes/tokens remain memory-only and absent from diagnostics/artifacts.

## Implementation approach

- Extend Existing-Active identity returned by Guest inspection with the exact manifest hash and validate the content-bound Active path before launch.
- Reuse `UnityPathStrategy` for Existing-Active launch; retain canonical path as identity and use a verified execution junction only when needed.
- Reject the specific nested-root case when the selected destination is the invited UUID directory underneath an already valid TeamForge managed root.
- Add authenticated Seed status details to lifecycle IPC and expose a Host health operation that verifies the owned Seed plus its current Coordinator registration.
- Revoke stale Unity Host Ready state on bridge exit or repeated failed Host health checks.

## Required evidence

- Focused Guest orchestrator tests.
- Launcher Core tests, especially Windows junction/path tests in CI.
- Host orchestrator/process-lifecycle tests.
- Unity EditMode Host UX tests.
- Full Project Peer + repository/engineering validators.
- GitHub Windows CI before merge.
- New candidate release + exact release validation before physical retest.
- Physical exact-r7-or-later Host/Guest retest remains separate evidence.

## Release impact

Packaged runtime/Launcher/Unity package behavior changes. Existing r7 ZIP remains immutable historical evidence and will not be replaced. A new candidate is required before field retest.

## Completion evidence before PR

- Focused Guest/Host/lifecycle regression tests: PASS.
- Full Project Peer suite after the changes: 172 PASS / 5 Windows-only SKIP / 0 FAIL.
- Full workspace `npm test`: PASS, including Server 73/73 and repository/workflow/docs/engineering/Test Lab/public-source validators.
- Launcher Core Release build on the S20 development environment: 0 warnings / 0 errors.
- Windows WPF Launcher cross-targeted Release build with `EnableWindowsTargeting=true`: 0 warnings / 0 errors.
- Physical evidence for the source fixes: **not yet available**. A new immutable candidate and exact Windows/Unity field retest are still required.
- Unity EditMode/Windows-specific path tests: delegated to remote Windows/Unity CI before merge; local Linux cannot substitute for that evidence.
