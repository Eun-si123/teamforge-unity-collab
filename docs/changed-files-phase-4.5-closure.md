# Phase 4.5 Closure Changed-Files Ledger

Comparison baseline: `Unity-TeamForge-Phase4.5-WP7-policy-profile-resolution.zip`  
Baseline SHA-256: `3D203F86B6AB9F3E23905F2BEC25D3FD23C0A3616A232A6B0EFAF40D68035D4B`

WP8 is documentation and validation only. No Server, Project Peer or Unity product/runtime file changed.

## Modified

- `docs/architecture.md` — as-built Phase 4.5 topology, layer map, WP ledger and limitations.
- `docs/architecture-decisions.md` — index entry for the Phase 4.5 ADR.
- `docs/compatibility.md` — Protocol/route/profile compatibility closure note.
- `docs/deployment.md` — current single-route deployment boundary and unchanged defaults.
- `docs/project-state.md` — exact WP7 input, WP8 state and evidence provenance.
- `docs/roadmap.md` — Phase 4.5 closure state and explicit Phase 5/deferred boundary.
- `scripts/validate-repository.mjs` — minimum final layer/dependency, route, profile, forbidden-feature and documentation invariants.

## Added

- `docs/decisions/phase-4.5.md` — accepted Architecture Foundation ADR.
- `docs/phase-4.5-closure-report.md` — final automated/field Closure record.
- `docs/phase-4.5-field-closure-checklist.md` — exact manual A/B/C and Project smoke gate.
- `docs/phase-4.5-rollback-reference.md` — immediate rollback and historical reference hashes.
- `docs/phase-4.5-test-report.md` — current-source and fresh-archive test provenance.
- `docs/changed-files-phase-4.5-closure.md` — this ledger.

## Explicitly unchanged

- `server/src/**`, Server package metadata and lockfile
- `project-peer/src/**`, Project Peer package metadata and lockfile
- `unity-package/com.eunsung.teamforge/**`
- Unity local-package manifest
- `docs/protocol-v1.md`
- `docs/protocol-project-transfer-v1.md`
- Product version `0.5.0`, Realtime Protocol v1, Project Transfer Protocol v1 and Manifest schema v1
