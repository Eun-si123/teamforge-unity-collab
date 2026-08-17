# Phase 4 Hotfix2 state — 2026-08-08

- User field-tested Hotfix1 in Unity `6000.3.21f1`: package compile succeeded and EditMode Test Runner reported **70/70 PASS**.
- Two non-blocking `CS0618` warnings remained because `Resources.InstanceIDToObject(int)` is also obsolete in Unity 6000.3.21f1.
- Hotfix2 migrates the hierarchy identity registry's live cache from legacy `int` Instance IDs to `UnityEngine.EntityId`, using `GameObject.GetEntityId()` and `Resources.EntityIdToObject(EntityId)`.
- Persisted hierarchy identity data is unchanged; EntityIds are not serialized across sessions.
- Hotfix2 working-tree Node/static gates: Server 49/49 PASS, Project Peer 62/62 PASS, validator PASS, smoke PASS, `.mjs` syntax 48/48 PASS, offline audit 0 vulnerabilities.
- Unity Hotfix2 compile/warning-clean/EditMode rerun: **PASS — user reports warning-clean and EditMode 70/70 PASS**.
- Next gate: two-Editor Phase 4 hierarchy E2E; hierarchy behavior is not yet marked complete.
- Phase 5 remains NOT STARTED.

---

# Phase 4 Hotfix1 state — 2026-08-08

- Initial `0.5.0` candidate reached Unity `6000.3.21f1` package compilation in the user's field project.
- Field compile result for the initial candidate: **FAIL** due to `CS0177` at `TeamForgeHierarchySyncService.cs` success paths; two non-blocking `CS0618` warnings also exposed obsolete `EditorUtility.InstanceIDToObject`.
- Hotfix1 applies `error = string.Empty` initialization and replaces the obsolete live lookup with `Resources.InstanceIDToObject(int)`.
- Validator regression guards were added for both findings.
- Hotfix1 post-patch Node/static gates: Server 49/49 PASS, Project Peer 62/62 PASS, validator PASS, smoke PASS, `.mjs` syntax PASS.
- Unity compile/EditMode for Hotfix1 remains **NOT RUN** until the user tests the rebuilt Hotfix1 candidate.
- Do not continue broader Phase 4 field E2E until Hotfix1 compiles cleanly and EditMode `Run All` is green.

---

# Current Phase 4 state — 2026-08-07

## Baseline and scope

- Frozen Phase 3 closure: `Unity-TeamForge-Phase3-v0.4.1-closure.zip`
- Frozen closure SHA-256: `b9c45dba18dbc984804a8fdb7548a78d9f580ae5649d89bd032f37cefd106f5a`
- Current candidate product version: `0.5.0`
- Realtime Protocol: `1` additive capability
- Active scope: Phase 4 Hierarchy Synchronization only
- Phase 5 persistence/recovery: NOT STARTED

## Implemented

- Server-authoritative in-memory hierarchy seed/snapshot/object/tombstone model.
- Additive `supportsHierarchySync` / `hierarchySyncEnabled`.
- Create/delete/rename/reparent/reorder operations on the shared Session revision stream.
- Strict `tf:<32 lowercase hex>` logical IDs for newly-created objects; saved baseline objects retain GlobalObjectId.
- Deterministic sibling order, subtree tombstones, cycle/missing-parent/stale-revision fail-closed handling.
- Target/current-parent/destination-parent/subtree lock conflict enforcement.
- Delete cleanup of retained Transform/Lock and stale Presence selection.
- Authoritative `sceneIds` including empty Scenes.
- Phase 2-only Transform/Lock authority blocked inside authoritative Phase 4 Scenes.
- Unity local generated identity map under `Library/TeamForge/hierarchy-ids-v1.json`; no Scene metadata Component.
- Unity ObjectChangeEvents-based local observation, hierarchyChanged rename fallback, authoritative remote apply and Transform baseline integration.
- Initial clean Scene identity mismatch now fails closed instead of guessing/duplicating logical objects.
- Collaboration UI Hierarchy Sync status and diagnostics.
- Product version bumped to `0.5.0` across workspace/server/peer/Unity package.

## Latest actual evidence

- Current Stage B source root `npm test`: PASS — Server 49/49, Project Peer 62/62, Repository Validator 204 files / 33 C# / protocol v1.
- Current Stage B root smoke: PASS; Project Peer reports `serverRelayUsed=false`.
- Repository-owned `.mjs` syntax: 46/46 PASS.
- Connected `npm audit --omit=dev`: unavailable because the configured internal npm mirror audit endpoint returns HTTP 404. This is not a vulnerability PASS.
- Provisional source-only archive: 204 entries; ZIP integrity PASS; source/ZIP/fresh path sets match and 204/204 per-file SHA-256 match.
- Provisional fresh `npm ci --offline`: PASS; npm install-time audit reports 0 vulnerabilities.
- Provisional fresh root tests: Server 49/49, Project Peer 62/62, validator 204 / 33 C# / protocol v1 PASS.
- Provisional fresh smoke: PASS with `serverRelayUsed=false`; `.mjs` syntax 46/46 PASS; `npm audit --omit=dev --offline` reports 0 vulnerabilities using available offline advisory/cache data.
- Provisional post-test packaged-source integrity: 204/204 hashes unchanged; forbidden generated/secret archive entries: 0.
- Unity Compile/EditMode: NOT RUN in this environment. Do not claim Unity PASS.

## Remaining before candidate delivery

1. Freeze the documentation/work-state cleanup that removes stale current-version/Phase-status contradictions.
2. Rebuild the final `Unity-TeamForge-Phase4-v0.5.0-candidate.zip` + SHA-256 from the frozen 204-file source.
3. Perform one final fresh extraction of that exact archive: path/hash compare, offline `npm ci`, full tests/smoke/validator/syntax/offline audit and forbidden-entry scan.
4. Deliver the candidate plus targeted Unity `6000.3.21f1` manual checklist.

## Known design boundary

Logical `tf:` identity binding is local generated state. A new Project baseline must not be guessed against an older live hierarchy Session. The client fails closed on first-snapshot identity mismatch. The current safe MVP workflow is to keep Project baseline and live hierarchy Session aligned or restart/reseed hierarchy after a new baseline. Durable identity migration/persistent recovery is not hidden inside Phase 4; it remains future explicit work.

---

# Current stabilization state

Last updated: 2026-08-04 (Asia/Seoul)

## Completed

- Preserved and SHA-256 hashed the supplied ZIP and master prompt, then extracted a separate 164-file working copy.
- Confirmed the local environment: Windows 10.0.26200.0, Unity 6000.3.21f1, system Node v24.18.1, and no Docker executable on `PATH`.
- Reproduced both release blockers before changing code. The original abort test failed 8/8 times on the exact official Node v22.16.0 runtime.
- Fixed Unity local-package resolution so `file:` paths resolve from `<ProjectRoot>/Packages`, accept safe internal traversal, and remain bounded by lexical and real-path containment.
- Separated canonical manifest-path validation from native filesystem-path conversion. Canonical remote paths now reject backslashes consistently on every OS.
- Made direct-transfer throttle/drain/read waits cancellable, tracked request contexts and sockets, and made `stop()` idempotent, bounded, and connection-closing.
- Corrected strict `Retry-After` parsing, retry delay precedence/caps, peer ordering, and switch diagnostics.
- Added root npm workspaces and a lockfile; a clean copied-tree root `npm ci` succeeded.
- Added Node 20-compatible replacements for `import.meta.dirname` in repository-owned scripts/tests.
- Expanded security, retry, abort-race, port-reuse, embedded-package, and full-package integration coverage.
- Post-fix direct-transfer plus swarm tests pass 23/23 on Node v22.16.0 and 23/23 on Node v24.18.1.
- A clean copied-tree root run passes server 37/37 and peer 53/53 on Node v24.18.1. Its validator file count is not release evidence because the temporary directory was accidentally placed inside that probe copy.
- Added five real loopback/process transport regressions: actual HTTP 503, TCP RST, stalled-response timeout, Seed A shutdown to Seed B completion, and receiver-process restart with exact three-chunk reuse.
- Reproduced a second cleanup defect: 24 pipelined requests on one keep-alive socket attached 23 per-request socket listeners and emitted `MaxListenersExceededWarning`.
- Replaced per-request socket close/error listeners with one listener pair plus a per-socket request-context set and idempotent cleanup; the same 24-request case is now warning-free.

## In progress

- Code work, source-only packaging, and automated fresh-extract validation are complete.
- Exact final sidecar reports/checksum are being written to `outputs/`.
- Unity was discovered but its required batch launch was blocked by the host approval/usage system before the process started. No Unity result is claimed; the user manual gate remains.

## Current test status

- Node v20.0.0 before the final listener/transport-test additions: server 37/37 PASS; peer core 53/53 PASS. Final source rerun is NOT RUN because required outside-sandbox execution was rejected by the host usage/approval limit.
- Node v22.16.0 final source: server 37/37 PASS; peer 59/59 PASS.
- Node v24.18.1 final source: server 37/37 PASS; peer 59/59 PASS.
- Supplied abort test: Node 22.16.0 final repeat 20/20 PASS; Node 24.18.1 pre-listener repeat 10/10 PASS. Final direct-transfer file is 11/11 PASS on Node 22 and Node 24; queued-abort/port-reuse focus is 1/1 PASS.
- Path-policy file: 9/9 PASS on Node 20/22/24 outside the sandbox. Both intermediate local-package and Embedded Package Windows junction escapes were actually created and rejected on all three runtimes.
- Static/release gates on Node 24: all 42 `.mjs` syntax checks PASS; both smoke tests PASS; repository validator PASS at 173 files/29 C# sources/protocol v1; root audit reports zero vulnerabilities.
- Early Node v24.18.1 clean-copy probe: server 37/37 PASS; peer 53/53 PASS, but its validator count is excluded because temp state was inside that obsolete probe. The later final fresh extraction is the authoritative 37/37 plus 59/59 evidence.
- Docker: NOT RUN because no Docker installation is available.
- Unity batch mode: NOT RUN. The launch request was rejected by the host approval/usage gate before Unity started.
- Source-only release inventory: 173 files, 29 C# sources, 42 `.mjs` files, protocol v1, zero forbidden generated/secret entries.
- Fresh extraction: 173/173 relative paths and SHA-256 file hashes match the packaged candidate; root `npm ci` PASS, root tests server 37/37 plus peer 59/59 PASS, syntax 42/42 PASS, both smoke flows PASS, validator PASS, root audit zero vulnerabilities.

## Next exact work

1. Finish the exact final reports and checksum sidecar in `outputs/`.
2. Recheck deliverable names/hashes and stop any unneeded workers.
3. Report results and wait for the user's Unity/LAN manual gate and explicit Phase 4 decision.

## Blockers and honest limitations

- No source blocker is known.
- Docker compose/build execution cannot be claimed unless Docker becomes available.
- Unity compile/EditMode status is unresolved because the host denied the batch launch before execution; the manual checklist must remain authoritative for this gate.

## Resume-first action

Read all files in `docs/work-state/`, then use the final manual checklist on Unity 6000.3.21f1. Preserve the supplied input and final ZIP; never start Phase 4 without a passing manual gate and explicit user approval.


---

## 2026-08-04 user field hotfix session

- A fresh copy of the user-supplied 173-entry final archive is now the working baseline.
- Confirmed new Unity release blocker: `TeamForgeEditorSurfaceTests.cs` uses ambiguous `PackageInfo` under Unity 6000.3.21f1 when the test assembly is enabled.
- Confirmed UI ambiguity: a retained verified baseline with zero online direct seeds is displayed with the same text as an unpublished baseline.
- Work is restricted to the two scoped Phase 3 fixes, regression tests, documentation, and packaging. Phase 4 remains forbidden.
- Detailed live ledger: `docs/work-state/HOTFIX_SESSION.md`.


## Hotfix implementation status

- H-001 PackageInfo CS0104 source fix: implemented.
- H-002 retained-baseline/no-seed state and UI distinction: implemented.
- Unity EditMode regression source and repository static regression: implemented.
- Validator (176 files), syntax, 38 focused Peer tests, and direct Embedded Package manifest coverage: PASS.
- Full npm gate: blocked by unavailable exact `ws@8.21.1` download in this container; dependency files remain unchanged.
- Unity final compile/EditMode: pending on a Unity 6000.3.21f1 host.
- Source review, Windows validation script, and first source-only fresh-extract verification are complete. Documentation now records that evidence; rebuild the final candidate once and repeat the clean verification before delivery.

## 2026-08-07 Hotfix2 field-test stabilization

Hotfix1 is superseded for Unity EditMode validation because two test-harness defects were reproduced on Unity 6000.3.21f1: additive temporary scene creation collides with the Test Runner's Untitled scene, and one test illegally instantiated a second `ScriptableSingleton`. Hotfix2 uses isolated Single temporary scenes and the actual settings singleton with snapshot/restore. Runtime/transport product code is unchanged. Container Node gates pass; Unity Hotfix2 rerun remains pending.


## 2026-08-07 Hotfix3 field-test stabilization

Hotfix2 reduced Unity 6000.3.21f1 EditMode failures to four. Two failures stopped at unsupported `CloseScene` calls on the last loaded Scene; one dirty-scene test relied on a programmatic edit becoming dirty automatically; one Undo test assumed `Undo.ClearUndo` removes the target's group rather than allowing an empty no-op group. Hotfix3 corrects those test-harness assumptions without changing product runtime code. Unity Hotfix3 rerun remains pending.


Hotfix3 container Node gate: exact unchanged `ws@8.21.1` cache, Server 37/37, Peer 59/59, validator 177 files/29 C#, both smoke flows, and audit 0 vulnerabilities all PASS. Unity 6000.3.21f1 EditMode rerun is the next blocking gate.


## 2026-08-07 Hotfix3 archive status

- The earlier Hotfix3 fresh-extract attempt was incomplete and is discarded as evidence.
- A replacement clean fresh-extract run completed: archive 177/177 integrity, offline `npm ci` PASS, Server 37/37 PASS, Project Peer 59/59 PASS, Validator 177 files / 29 C# / protocol v1 PASS, source `.mjs` 42/42 PASS, both smoke flows PASS, audit 0 vulnerabilities, post-test packaged-source hashes 177/177 unchanged.
- Remaining immediate field gate: Unity 6000.3.21f1 Hotfix3 EditMode `Run All` must report Failed 0.
- Phase 4 remains forbidden.

## 2026-08-07 Phase 3 closure checkpoint

- User field validation is complete for Hotfix3: Unity EditMode Failed 0, Publish/Invite/Sync/Active/Connected, seed offline/online wording, Resume, Seed A/B failover, Abort + 5091 rebind, and Phase 0-2 regression all passed.
- Stage A closure code is implemented in the Project Peer only.
- New automated behavior: identical re-Publish is blocked by default; `--force-new-revision` is required to intentionally advance an unchanged Baseline. `seed` remains the normal re-advertisement command.
- Sync success JSON now reports total/transferred/resumed Chunks and bytes.
- Windows sync emits a non-destructive path-risk preflight warning when the predicted Active + representative Unity PackageCache headroom reaches the field-observed high-risk range. No registry/admin setting is modified.
- `--partial-seed-max-bytes-per-second` is the explicit sync option; legacy `--max-bytes-per-second` remains a compatible alias.
- Root automated suite after these changes: Server 37/37 PASS, Project Peer 62/62 PASS, validator PASS (180 files, 29 C# sources, protocol v1).
- Unity was not executed in this environment. No Unity source changed in Stage A; previous user Hotfix3 field evidence remains previous-field evidence, not a newly executed Stage A Unity run.

## 2026-08-08 Phase 4 v0.5.0 Hotfix3 current state

Hotfix2 passed Unity 6000.3.21f1 Compile/EditMode 70/70, then the first two-Editor hierarchy field test exposed a Phase 4/Phase 2 integration defect: a newly-created object selected by its creator was rejected by Transform tracking before `create_object` acknowledgement and was never re-armed after hierarchy baseline admission. Hotfix3 implements targeted selection re-arm plus pending-local-Transform preservation and adds an EditMode regression. Node/server/peer/static gates pass; Unity Hotfix3 and two-Editor targeted retest remain pending.

## 2026-08-08 Phase 4 v0.5.0 Hotfix4 current state

Hotfix3's new EditMode regression failed in the user's Unity Test Runner before exercising the runtime fix because the test assumed synchronous `Selection.selectionChanged` dispatch. Hotfix4 changes only the regression harness plus validator/docs: it explicitly invokes Transform selection tracking after assigning the active GameObject. Runtime TeamForge code is unchanged from Hotfix3. Static validator/syntax pass; Unity 71/71 and the two-Editor create+move targeted gate remain pending.


## 2026-08-08 Hotfix5
Phase 4 v0.5.0 is in Hotfix5 validation. Create/Transform and symmetric Basic Lock are field PASS. Rename propagation works, but Hotfix4 revealed stale Transform rollback on the observing peer. Hotfix5 fixes Server Hierarchy/Transform coherence and prevents rename/reorder from applying Transform payloads. Automated Node/static gates pass; Unity 72/72 and bidirectional rename-at-nonzero field retest are pending.

## 2026-08-10 UX Pass 2 Hotfix2 field closure / UX Pass 3

- User field validation for UX Pass 2 Hotfix2: Unity `6000.3.21f1` EditMode **91/91 PASS**.
- Quick A/B/C bootstrap: PASS.
- C Late Join convergence: PASS.
- Follow-up screenshot exposed a normal-path UX ambiguity: `Copy Invite` had no visible invite input and `Connect Current` could be mistaken for the invite-consumption action.
- Screenshot evidence showed different Project IDs + different Session IDs + `People: 1 connected` on the two Editors, meaning each Editor was connected to its own saved session rather than one shared invite session.
- UX Pass 3 changes only the Collaboration home UI: explicit invite field, Paste + Join Invite, `Connect Saved Session` naming, Auto/English/한국어 selector, and hover `ⓘ`/control tooltips.
- Project UUID / saved Scene fail-closed validation is unchanged.
- Separate Coordinator warning `A non-empty Project registry requires a Project UUID.` remains under diagnostic investigation; no security validation was weakened.
- Current UX Pass 3 static validator: PASS — 253 files / 43 C# / protocol v1. Unity field compile/retest pending.

## 2026-08-10 UX Pass 4 — Project mismatch recovery and Phase 4 Closure

- UX Pass 3 normal UI checks 1–5 passed in the user's Unity field test.
- First real invite join correctly failed closed because B's local TeamForge Project UUID did not match the host invite, exposing that the safe behavior still had poor recovery UX.
- UX Pass 4 keeps the identity check strict but adds an actionable mismatch assistant: choose an existing matching Project, or open Project Transfer / Project Bootstrap guidance.
- A selected Project folder is validated as a Unity Project and must carry the exact host `ProjectSettings/TeamForgeProject.json` UUID before Unity opens it.
- Unsaved Scenes are protected by Unity's save/cancel prompt before Project switching.
- The secret-free TF1 invite is handed across the Project switch for at most 15 minutes and restored only in the expected Project; connection still requires explicit user confirmation.
- Three EditMode regressions were added after the previous 91/91 field result.
- The user ran exact candidate `Unity-TeamForge-Phase4-v0.5.0-uxpass4-candidate.zip` (`ED27CC23459B15AB90337A7DF181996D469A2DC33F252EE49125814256521AE7`) in Unity `6000.3.21f1`: **94/94 PASS**.
- User-provided field evidence also records **A/B/C Late Join PASS** and **Language / Tooltip / Invite basic UX PASS**.
- WP0 is documentation/static Closure freeze only. It does not rerun Unity, modify product source, refactor Phase 4.5, or start Phase 5.
