# Changelog

This file summarizes **notable product-version changes** for TeamForge.

For detailed Unity-package changes and intermediate hotfixes, see **[unity-package/com.eunsung.teamforge/CHANGELOG.md](unity-package/com.eunsung.teamforge/CHANGELOG.md)**.

For repository infrastructure, validation milestones, AI/search work, privacy migration, and other engineering history that does not map cleanly to a product version, see **[docs/history/DEVELOPMENT_HISTORY.md](docs/history/DEVELOPMENT_HISTORY.md)**.

Current implementation and release readiness are tracked separately in **[docs/STATUS.md](docs/STATUS.md)**. A changelog entry describes what changed; it is not proof that the current packaged candidate passed every field gate. Current source can also be newer than the latest immutable packaged candidate; use STATUS and `builds/README.md` for that distinction.

## Unreleased source additions after immutable r10 (2026-11-18 onward)

- **Audited defect fixes (#662, #670, #651, #667, #658, #652, #671, #673, #672, #648, #660, #666; source only, Node host tests):** Host Ready now requires the realtime Scene GUID to match the signed Scene `.meta`; a full durable Session store refuses only the new Session instead of disconnecting unrelated live Sessions; every Guest activation is a monotonic compare-and-swap; a failed Host startup or stop no longer drops ownership of live child processes or reports Idle over them; Editor-bound message budgets cannot exceed the Unity Editor's 1 MiB receive limit; a connection that announced an outdated signed Baseline cannot keep committing realtime edits (Unity Editors do not announce one yet); and a first Hierarchy seed keeps previously confirmed Transform state. Durable mode keeps per-connection request order behind asynchronous admission; locks and empty Scene seeds are admitted only if the resulting snapshot still fits a late joiner; activation and approved-pointer locks are released by the OS when their owner process dies (ambiguous legacy locks still stay busy); an incompatible TeamForge Package is refused before activation; and Host health stops reporting Ready after a required chunk is lost. Unity Editor, Launcher, packaged and physical two-PC checks are NOT RUN.

- **Launcher Runtime file verification (#570, source only):** SHA-256 of pinned Runtime files is now computed by streaming rather than buffering entire files; the fail-closed manifest, inventory, path and trust checks remain. New exact packaged startup and Windows physical checks are NOT RUN.

- **M3 shared built-in primitives (PR #569, source only):** opt-in Cube/Sphere creation/deletion, built-in Mesh/Renderer, exact Collider identities and atomic Hierarchy/Collider revisions; 3-version Editor/Node CI passed. Physical two-Editor and new package NOT RUN. r10 unchanged; release remains FIELD BLOCKED.

- **Unreleased source dependency update:** server and Project Peer now use the same pinned ws 8.23.0; root and workspace lockfiles and the current source Runtime contract share the exact npm registry integrity. The upgrade includes the upstream fix for unbounded automatic Pong buffering from malicious Ping frames. This does **not** change the published r10 ZIP or its source/tag hash, and does not claim a newer packaged or physical two-Editor validation.

These changes are on main source, **not** in the published r10 Windows ZIP. No newer exact Windows package or two-physical-Editor field certification exists; release readiness remains **FIELD BLOCKED**. See [STATUS](docs/STATUS.md) for source/CI/field distinctions.

- **M1 opt-in Collider properties** (PR #533): signed Scene admission, Server Authority, WebSocket, Box/SphereCollider trigger/center/size/radius, conditional own Undo/Redo and explicit recovery review. One real Unity Editor and Node peer passed versioned CI; simultaneous physical Editor tests remain pending.
- **M2 opt-in Collider lifecycle** (PR #559 including late-join fix #565): add/remove exact Box/SphereCollider Components, same-type sibling identities, save/reopen/reconnect and conditional compensation. The merged PR head passed Unity/Node CI; physical two-Editor use and packaged promotion are not yet certified. Structural sync requires explicit server/Editor capability enablement and is off by default.

- **Post-r10 source-only Launcher and field hardening** (PRs #543, #546, #548, #564): bound untrusted status text, refuse overwriting existing diagnostics ZIP files, normalize local Host identity in field control frames, and reject unsafe manifest file path syntax before filesystem access. These changes have CI coverage and are not retroactively present in the published r10 package.

## 0.5.1

Collaboration bootstrap, networking, release-contract, recovery, path-resilience, and security stabilization around the 0.5.0 collaboration foundation.

Notable changes in the 0.5.1 line include:

- guided Host/Guest bootstrap and standalone Windows Guest Launcher work;
- bundled/verified Runtime packaging instead of requiring normal Guests to install system Node/npm;
- stronger Collaboration Invite, Project/Publisher trust, staging, activation, and final Unity-handoff checks;
- diagnostics and recovery UX for common bootstrap/transfer/runtime failures;
- prompt cancellation of sibling transfer requests and cooldown waits after a terminal chunk failure, preserving the original error and verified resume data;
- isolated Coordinator reconnect attempts, source-specific retry budgets even with duplicate peer labels, and Seed listener cleanup after failed endpoint setup;
- cancellation through cached/final verification, file reconstruction and Publisher approval before activation commits, preserving the previous Active revision and verified resume data;
- explicit Launcher verification/progress feedback, finite-number-safe indicators and pause/resume handling that tolerates late runtime events and acknowledgements;
- exact pinned-descriptor recovery despite unrelated damaged metadata, with stricter Project identity and revision checks;
- failed chunk-write cleanup that preserves the original I/O error and shared verified cache entries completed by other transfers;
- receive controls scoped to the current operation, duplicate-request prevention, cancellation priority over delayed pause/resume feedback, and cancellation before transfer or automatic Unity opening;
- a manual Windows Launcher **Save support bundle** path, producing a bounded/redacted local troubleshooting ZIP rather than automatically uploading broad machine/project data;
- Windows path-resilience and managed short execution-path handling;
- collaboration race/reconciliation hardening around Transform, Hierarchy, Lock and late-join state;
- targeted fixes for saved Guest reconnect, receive/shutdown handling, remembered Seed-port collision fallback with narrow Windows firewall onboarding and selectable rule cleanup on Host stop, Transform/Lock contention recovery, and verified execution-alias handoff;
- stronger CI, Unity real-server E2E, transfer-recovery, authority-chaos and release-artifact validation.

The published r5 candidate includes the support-bundle integration and received exact two-PC Windows evidence for the original WP5.1 stabilization scenarios recorded in [docs/STATUS.md](docs/STATUS.md). Current `main` has since added further Windows networking and Project identity recovery hardening that is **not byte- or behavior-equivalent to r5** and requires its own package/evidence boundary if selected for distribution.

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
