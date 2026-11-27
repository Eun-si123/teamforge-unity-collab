# M5 Launcher saved-project transition inspection — 2026-11-27

Draft PR #684, base 7ae840a. No release or merge to main.

## User workflow

With the Coordinator and competing writers stopped, the Host runs the existing offline recovery inspector against the managed root and SQLite database, then exports an exact transition scope:

    node server/scripts/inspect-transition-recovery.mjs <absolute-db> <absolute-managed-root> --guest-request <transition-id>

The export requires a matching pending transition, a recognized Host pointer and independently verified previous/candidate signed content. It contains only the schema version, Project ID/UUID, transition ID and two descriptor hashes. It is an unsigned selector, not authorization.

The Guest saves and closes Unity, stops competing writers, selects the existing Projects folder in the Launcher, and chooses **Inspect saved project recovery…**. No fresh invite or receive is required. Paste the Host's request and acknowledge the offline precondition. The existing verified bundled Guest bridge inspects the local managed root and state directory, verifies local signed Active metadata and trust, compares saved file manifests and rechecks the observation. The Launcher presents a fixed status summary; optional clipboard sharing requires an explicit decision. Local paths, credentials and unexpected response fields cannot be included in the accepted shared report.

This is inspection, not repair. It never changes the Active pointer, overwrites local files, creates a handoff, accepts a signed participant ACK or permits Editor resume. Unsaved in-memory Unity work and the actual stopped-writer precondition are not independently verified. The scan retains the existing bounded hashing budget; a UI timeout abandons the response, not proof that the worker has stopped. The same bridge refuses overlapping receive, identity preparation or transition inspection until its local scan settles. No distributed filesystem ownership guarantee is introduced.

## Validation

- Server full suite: 541 passed, no failures.
- Project Peer full suite: 730 passed, 0 failed, 6 environment skips (736 total).
- New focused bridge tests and extended Host export test passed. Real managed fixtures verify dirty saved files and Active pointer are unchanged, exact scope export, invalid request rejection, forbidden roots and competing receive/identity refusal.
- Launcher Core: 53/58 on Linux using installed .NET SDK 10.0.115 (repository pins 10.0.303). Unmodified 7ae840a baseline: 52/57, same five Windows-specific failures (known folders, Windows path rules, file retirement, path capability and cache root). New parser/presentation test passed.
- WPF Launcher and Windows UI-test project cross-build: both succeeded, zero errors/warnings after normal NuGet reference-pack restoration. Native Windows UI tests were not executed; existing preview UI test now covers inspection button availability without an invite and exclusion during preview.
- Syntax, engineering, documentation, workflow and public-source validation passed. Physical two-PC, Unity runtime, complete signed participant reconciliation and packaged-runtime validation remain separate.
