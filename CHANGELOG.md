# Changelog

This file summarizes **notable product-version changes** for TeamForge.

For detailed Unity-package changes and intermediate hotfixes, see **[unity-package/com.eunsung.teamforge/CHANGELOG.md](unity-package/com.eunsung.teamforge/CHANGELOG.md)**.

For repository infrastructure, validation milestones, AI/search work, privacy migration, and other engineering history that does not map cleanly to a product version, see **[docs/history/DEVELOPMENT_HISTORY.md](docs/history/DEVELOPMENT_HISTORY.md)**.

Current implementation and release readiness are tracked separately in **[docs/STATUS.md](docs/STATUS.md)**. A changelog entry describes what changed; it is not proof that the current packaged candidate passed every field gate.

## 0.5.1

Collaboration bootstrap, networking, release-contract, recovery, path-resilience, and security stabilization around the 0.5.0 collaboration foundation.

Notable changes in the 0.5.1 line include:

- guided Host/Guest bootstrap and standalone Windows Guest Launcher work;
- bundled/verified Runtime packaging instead of requiring normal Guests to install system Node/npm;
- stronger Collaboration Invite, Project/Publisher trust, staging, activation, and final Unity-handoff checks;
- diagnostics and recovery UX for common bootstrap/transfer/runtime failures;
- Windows path-resilience and managed short execution-path handling;
- collaboration race/reconciliation hardening around Transform, Hierarchy, Lock and late-join state;
- targeted fixes for saved Guest reconnect, receive/shutdown handling, stable Seed/firewall onboarding, Transform/Lock contention recovery, and verified execution-alias handoff;
- stronger CI, Unity real-server E2E, transfer-recovery, authority-chaos and release-artifact validation.

The 0.5.1 source line remains subject to the current field-readiness gate described in [docs/STATUS.md](docs/STATUS.md).

## 0.5.0

Introduced the Same-Scene Hierarchy collaboration foundation and related authority/conflict handling.

Notable scope:

- authoritative GameObject create/delete/rename/reparent/sibling-order operations for the supported same-Scene subset;
- shared identity/authority integration between Hierarchy, Transform and Lock paths;
- reconciliation and protection rules for unsupported/ambiguous structural state;
- expanded regression and validation coverage around hierarchy operations and collaboration state.

General Component/Inspector/Prefab/Asset synchronization was not introduced as a supported general workflow by this version.

## 0.4.1

Phase 3 stabilization release line.

Notable work:

- Embedded UPM package transfer coverage;
- Project-transfer retry/resume/failover stabilization;
- regression fixes discovered during manual end-to-end testing;
- safer bootstrap/activation handling and documentation/test updates.

## 0.4.0

Introduced the Project bootstrap / transfer protocol foundation.

Notable scope:

- signed Collaboration/Project bootstrap metadata;
- direct Project Peer transfer foundations;
- deterministic Manifest/File/Chunk integrity checks;
- staging/activation and Publisher trust foundations;
- resume/seed/failover groundwork.

## 0.3.0

Introduced live Transform synchronization, server authority, and basic object locking.

Notable scope:

- position/rotation/scale synchronization;
- server-authoritative revision/lock handling;
- object ownership/lease behavior;
- conflict and reconnect foundations around shared Transform state.

## 0.2.0

Introduced Presence and Editor-awareness collaboration.

Notable scope:

- connected-user identity/presence;
- selection and Scene awareness;
- teammate navigation helpers;
- join/leave and presence lifecycle behavior.

## 0.1.0

Initial Unity Editor collaboration connection foundation.

Notable scope:

- Unity Editor ↔ TeamForge Server connection;
- Hello/Ping/Pong and basic protocol envelope;
- reconnect and diagnostics foundations;
- initial Editor package/server structure.

## Historical engineering detail

TeamForge intentionally retains detailed engineering records that are more granular than a normal changelog:

- [Development history](docs/history/DEVELOPMENT_HISTORY.md)
- [Phase records](docs/phases/)
- [Work-state / debugging records](docs/work-state/)
- [Architecture decisions](docs/architecture-decisions.md)

Those records may describe superseded behavior. For current facts, prefer source/tests and [docs/STATUS.md](docs/STATUS.md).
