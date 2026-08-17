# TeamForge Phase 4 v0.5.0 Test Report

Date: 2026-08-07 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Product: `0.5.0`
Realtime Protocol: `1`

## Evidence boundary

This report distinguishes tests that actually ran in the current environment from Unity tests that exist only as source. **Unity `6000.3.21f1` Compile/EditMode is NOT RUN in this environment.** No Unity PASS is claimed until the user executes the exact packaged candidate.

## Automated server coverage

Current Phase 4 server tests exercise:

- hierarchy capability negotiation and late-join snapshot ordering;
- clean saved hierarchy seed and idempotent seed;
- strict logical object IDs;
- create/delete/rename/reparent/reorder;
- local transform carried by create/reparent;
- deterministic sibling canonicalization and index clamping;
- duplicate GameObject names;
- missing parent and cycle rejection;
- exact revision serialization and stale concurrent edit rejection;
- subtree delete and tombstones;
- logical ID resurrection rejection;
- target, destination/current parent and subtree descendant lock conflicts;
- delete cleanup of stale Presence selection;
- Phase 2-only Transform/Lock rejection in authoritative Phase 4 Scenes;
- hierarchy Scene/object/tombstone safety bounds.

The final actual counts are filled by the release-gate run; do not infer a future PASS from this source report.

## Project Peer regression

Phase 4 does not move Project payload through the Coordinator and does not change the Project Transfer protocol version. The full Phase 3 Project Peer suite remains a required regression gate, including Publish/Seed semantics, Direct P2P transfer, Resume, Retry, failover, path containment and secret exclusion.

## Repository/static validation

The repository validator requires:

- server hierarchy model and pure hierarchy tests;
- Unity hierarchy service/model/identity registry and `.meta` files;
- additive v1 hierarchy protocol DTOs and capability fields;
- Object Change API integration;
- logical identity storage under `Library/TeamForge`;
- Phase 4 UI status;
- Phase 4 reports/checklist/rollback/known-issues documents;
- no Unity Progress lifecycle API introduction;
- no server Project payload disk-write API;
- product version equality across workspace/server/peer/Unity package.

## Unity source tests added

`TeamForgeHierarchyModelTests.cs` covers at least:

- strict `tf:` ID syntax;
- hierarchy record round-trip including initial transform;
- printable GameObject names including leading/trailing spaces;
- registry clone/tombstone isolation;
- Transform baseline create/reparent/delete integration;
- logical identity bind/resolve without Scene metadata Component;
- additive Protocol v1 hierarchy capability/snapshot DTO round-trip;
- authoritative `sceneIds` round-trip.

These are **NOT RUN** until Unity `6000.3.21f1` Test Runner executes them.

## Manual field gate required

Use [Phase 4 v0.5.0 manual checklist](phase-4-v0.5.0-manual-test-checklist.md) against the exact candidate. Required outcomes include two-Editor create/delete/rename/reparent/reorder convergence, late join, lock/revision rejection, delete tombstone behavior, Phase 0–3 regressions and Phase 3 P2P bootstrap regression.

## Honest limitations

- Unity Compile/EditMode: NOT RUN here.
- Docker Compose/Image: NOT RUN unless Docker is actually available during the final gate.
- Linux/macOS Unity behavior: NOT RUN.
- Large-scene hierarchy performance beyond configured safety limits: NOT RUN.
- Server restart hierarchy recovery: intentionally unsupported until Phase 5.

## 2026-08-07 source release-gate run

Actual current-source execution after Phase 4 code and documentation integration:

- Root `npm test`: PASS.
  - Server: **49/49 PASS**.
  - Project Peer: **62/62 PASS**.
  - Repository validator: **204 files / 33 C# sources / protocol v1 PASS**.
- Root `npm run smoke`: PASS.
  - Server Connection/Presence/Transform/Lock/Project smoke PASS.
  - Project Peer Direct P2P smoke PASS with `serverRelayUsed=false`.
- Repository-owned `.mjs` syntax: **46/46 PASS** with `node --check`.
- Standalone `npm audit --omit=dev`: **NOT AVAILABLE** because the configured package mirror returned HTTP 404 for the npm audit endpoint. This is an environment/service limitation, not a vulnerability PASS. Dependency/lockfiles were not changed to bypass it.
- Unity `6000.3.21f1` Compile/EditMode: **NOT RUN** in this environment.

A fresh-extract run is still required before the candidate hash becomes the delivery evidence.


## Provisional fresh-extract gate

A provisional 204-file source-only candidate was built after the source release-gate run. Before documentation freeze:

- ZIP integrity: PASS; 204 entries.
- Source/ZIP/fresh relative path sets: exact match.
- Pre-install per-file SHA-256: 204/204 match.
- Fresh `npm ci --offline`: PASS; 4 packages installed; npm install-time audit reported 0 vulnerabilities.
- Fresh root tests: Server 49/49 PASS, Project Peer 62/62 PASS, validator 204 files / 33 C# / protocol v1 PASS.
- Fresh smoke: PASS; Project Peer `serverRelayUsed=false`.
- Fresh repository-owned `.mjs` syntax: 46/46 PASS.
- Fresh `npm audit --omit=dev --offline`: 0 vulnerabilities from available offline npm advisory/cache data. Connected audit remains unavailable because the configured mirror audit endpoint returns HTTP 404.
- Post-test packaged-source integrity: 204/204 unchanged.
- Forbidden generated/secret archive entries: 0.

A subsequent documentation consistency pass changed source documentation only, so the final delivery archive must be rebuilt and fresh-validated once more. Unity Compile/EditMode remains NOT RUN here.


## 2026-08-08 Unity field compile blocker and Hotfix1

The user opened the packaged Phase 4 candidate in Unity `6000.3.21f1`. Unity reached C# package compilation and reported two blocking `CS0177` errors in `TeamForgeHierarchySyncService.EnsureAndApplyObject`: the `out string error` parameter was not assigned on the two successful return paths. Unity also reported two `CS0618` warnings because `EditorUtility.InstanceIDToObject(int)` is obsolete in this Editor version.

Hotfix1 source changes:

- initialize `error = string.Empty` at the start of `EnsureAndApplyObject`, before any successful return is possible; failure paths continue to overwrite it with their specific message;
- replace the hierarchy registry's two `EditorUtility.InstanceIDToObject(int)` calls with `Resources.InstanceIDToObject(int)`, which is sufficient here because the registry intentionally resolves only currently loaded Scene objects;
- extend `scripts/validate-repository.mjs` so the obsolete Editor API cannot be reintroduced and the `CS0177` initialization pattern is required.

Post-patch non-Unity gates on the exact Hotfix1 working tree:

- root `npm test`: PASS — Server **49/49**, Project Peer **62/62**, validator PASS;
- root `npm run smoke`: PASS with Project Peer `serverRelayUsed=false`;
- repository `.mjs` syntax: PASS.

**Unity Hotfix1 Compile/EditMode: NOT RUN after the patch yet.** The previous Unity run is recorded as a compile FAIL for the superseded initial candidate, not as a Hotfix1 result. The next required field gate is to install/open the Hotfix1 candidate and confirm Console compile errors 0, then run EditMode `Run All`.

## 2026-08-08 Hotfix1 field PASS and Hotfix2 warning cleanup

User field result for Hotfix1 on Unity `6000.3.21f1`: **70/70 EditMode tests PASS**. The earlier `CS0177` compile blocker is resolved. Two non-blocking `CS0618` warnings remained because `Resources.InstanceIDToObject(int)` is itself obsolete in this Editor.

Hotfix2 migrates the hierarchy identity registry's ephemeral live map to `UnityEngine.EntityId` and uses `GetEntityId()` + `Resources.EntityIdToObject(EntityId)`. The persisted logical/GlobalObjectId mapping does not change.

Hotfix2 non-Unity working-tree gates: Server 49/49 PASS, Project Peer 62/62 PASS, validator PASS, smoke PASS, `.mjs` syntax 48/48 PASS, offline audit 0 vulnerabilities. Unity compile/warning-clean/EditMode rerun for Hotfix2 remains pending.
