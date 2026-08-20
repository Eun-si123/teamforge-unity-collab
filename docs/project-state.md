# Current project state — 0.5.1 WP5.1 Path Resilience

Last reviewed against the public source on 2026-08-20 (Asia/Seoul).

Product version: `0.5.1`  
Release identity: `0.5.1-wp5.1-path-resilience`  
Status: **FIELD BLOCKED**

This file is a compact engineering-state summary. For the public release-readiness source of truth, use [STATUS.md](STATUS.md). For the exact current runtime/tool/candidate identity, use [`../release-contract.json`](../release-contract.json). For packaged-build classification, use [`../builds/README.md`](../builds/README.md).

WP5 added beginner-facing error explanations, stable codes, redacted current-run diagnostics, and state-driven safe recovery actions over the earlier Host/Guest flow. WP5.1 adds path resilience and automatic short-workspace handling for the Windows packaged candidate. These work packages do **not** introduce a new realtime protocol, Project Transfer protocol, Project Manifest schema, authority model, or payload route.

Current invariants:

- Realtime Protocol v1.
- Project Transfer Protocol v1.
- Project Manifest Schema v1.
- TeamForge Server WebSocket is the sole realtime authority route.
- Project payloads use direct HTTP between Project Peers and never traverse the Coordinator.
- Normal packaged Host/Guest paths use the bundled, hash-verified Runtime and do not require system Node/npm.
- Changed Project UUID, changed Owner, and tampered invites fail before stored trust bindings change; changed Publisher requires explicit trust.
- Successful Baseline refresh preserves immutable Active revisions and moves `current.json` only after staging and verification; failure preserves the previous Active.
- Arbitrary Component/`SerializedProperty`, Inspector, Prefab structure, and general Asset synchronization remain unsupported current workflows.
- Safe offline opening of a previous independently verified Active never creates a realtime handoff and never bypasses Scene-baseline validation.
- Diagnostic history is memory-only and bounded; access codes, tokens, private keys, Authorization values, and caller-supplied secrets are redacted.
- WP5.1 path handling must not weaken containment, runtime integrity, trust, activation, or final Unity handoff checks.

## Evidence boundary

Do not infer a current PASS from an older report merely because it exists under `docs/`.

- `release-contract.json` identifies the current product version, release ID, work package, platform, runtime/tool versions, protocol versions, and `FIELD_BLOCKED` state.
- `builds/README.md` identifies which packaged ZIP is the current WP5.1 candidate and which older ZIPs are superseded.
- `docs/STATUS.md` describes what the public repository currently claims is implemented, automated, blocked, or not recommended for general installation.
- GitHub Actions is the current public source-level CI evidence for Server, Project Peer, launcher runtime-loader, and Windows launcher checks.
- Historical Phase/work-package reports and PASS/CLOSED statements apply only to the exact artifact or candidate they record.

Earlier references to release-only audit or executable-smoke evidence that is not present in the public source tree are stale and must not be treated as current evidence locations.

## Remaining release boundary

The current candidate remains **FIELD BLOCKED**. In particular, source-level/automated qualification is not a substitute for the required Unity and two-PC Windows field validation on the exact candidate artifact.

Unity `6000.3.21f1` remains the recorded candidate test Editor. Testing a newer Unity patch, Authenticode signing, Docker, macOS/Linux standalone launchers, and broader internet transport remain separate follow-ups unless and until their own evidence is recorded.
