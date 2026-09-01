# Test evidence

Last updated: 2026-08-04 (Asia/Seoul)

## Environment and input provenance

- Environment: Windows 10.0.26200.0; PowerShell 5.1.26100.8972; system Node v24.18.1; npm 11.16.0; Unity 6000.3.21f1.
- Docker discovery: executable not found; Docker execution remains NOT RUN.
- Input ZIP SHA-256: `F92C3716E70F51D65A920B2AD70D8CFB60C22082E685A3549E1EFFF77BDDD35A`.
- Master prompt SHA-256: `E95F7D9F2F98EB69380D500D35BF7CC62601E6542DDDCACE0764336828FD5B30`.
- Clean input extraction: 164 files; PASS.

## Pre-fix evidence

### Root clean install

- Command: root `npm.cmd ci`.
- Result: FAIL, exit 1, because no root lockfile existed.
- Duration/log: 1.607 s; `../logs/baseline-root-npm-ci.log`.

### Baseline install and tests

- Fallback `npm.cmd run install:all`: PASS; 3.492 s; `../logs/baseline-install-all.log`.
- Validator after adding only six required work-state files: PASS; 170 files, 29 C# sources, protocol v1; `../logs/baseline-validator.log`.
- Root tests with an external writable temp: server 37/37 PASS, peer 46/47 PASS; Windows canonical backslash rejection was the sole product/test failure; 9.189 s; `../logs/baseline-root-test-workspace-temp.log`.
- The earlier default-temp run is retained but is invalid as product evidence because 41 peer cases failed on sandbox `EPERM`; `../logs/baseline-root-test.log`.

### Defect A - Unity local packages

- Focused reproduction: `file:../LocalPackages/com.example.internal` was rejected as external; `file:com.example.internal` resolved from the wrong base; obsolete project-root fixtures were accepted.
- Result: defect reproduced deterministically before patching.

### Defect B - client abort cleanup

- Runtime: official Node v22.16.0 portable archive; verified SHA-256 `21c2d9735c80b8f86dab19305aa6a9f6f59bbc808f68de3eef09d5832e3bfbbd`.
- Command: supplied abort test repeated eight times.
- Result: 0/8 PASS, 8/8 FAIL; every failure reported `Direct server did not close after a throttled client abort.`
- Duration/log: 15.284 s; `../logs/baseline-abort-node22-repeat-8.log` and single-run detail in `../logs/baseline-abort-node22-focused.log`.
- Root cause evidence: abort could leave uncancellable timer/drain work, while Undici on Node 22 could leave a replacement idle connection that `server.close()` did not finish closing.

## Post-fix evidence so far

### Focused path policy

- Runtime: Node v24.18.1.
- Result: 9/9 PASS, including corrected Unity-relative fixtures, separator handling, traversal/absolute/URI rejection, generated/secret exclusions, and package-root validation.
- Limitation: a symlink-specific branch reported `EPERM` in the restricted environment; an elevated or junction-capable rerun is still required before claiming full real-path attack coverage on this machine.

### Direct transfer and retry/failover

- Node v22.16.0: direct-transfer plus swarm tests 23/23 PASS.
- Node v24.18.1: direct-transfer plus swarm tests 23/23 PASS.
- Covered behavior includes the supplied abort case, forced drain-wait abort, 24 queued throttled aborts, listener cleanup, idempotent `stop()`, immediate port reuse, precise/standard `Retry-After`, capped hints, jittered retry waits, deterministic available-before-cooling ordering, and diagnostics.
- Reproducibility: one combined run per runtime so far; repeat/stress matrix still pending.

### Clean-copy root install and suite

- Candidate: disposable copy excluding `node_modules`.
- Root `npm.cmd ci --ignore-scripts`: PASS; four installed packages; audit reported zero vulnerabilities.
- Root tests on Node v24.18.1: server 37/37 PASS; peer 53/53 PASS.
- Log: `../logs/postfix-root-ci-probe.log`.
- Evidence caveat: TEMP/TMP were accidentally placed inside the probe copy. This generated 541 cache files and made the validator report 712 files. Install and test results remain valid; that file count is explicitly invalid and will not be used for release inventory evidence.

### Exact Node v20.0.0 first run

- Runtime: official Node v20.0.0 portable archive; verified ZIP SHA-256 `a76e2221cdd68467add78f0e7d24f2a968c2521f3fcd6f6964fc722bc9a9a9b4`.
- Restricted run: could not load tests because Node v20.0.0 encountered `lstat <USER_HOME>` `EPERM`; this is an environment result, not a product failure.
- Approved outside-sandbox server run: 22/37 PASS and 15/37 FAIL because endpoint-dependent tests observed an undefined shared `endpoint`; `../logs/postfix-node20-full.log`.
- Diagnosis: an exact minimal reproduction proved Node v20.0.0 did not run a top-level `before()` before independent top-level tests, while the same hook inside `describe()` passed. Node v24 top-level control passed.
- Fix: test-only suite wrapper in `server/test/server.test.mjs`.
- Post-fix exact Node 20 server: 37/37 PASS, one suite, zero fail/skip; `../logs/postfix-node20-server.log`.
- Post-fix exact Node 20 peer: 53/53 PASS, zero fail/skip; `../logs/postfix-node20-peer.log`.

### Complete Node runtime matrix

- Node v20.0.0: server 37/37 PASS (`../logs/postfix-node20-server.log`); peer 53/53 PASS (`../logs/postfix-node20-peer.log`).
- Node v22.16.0: server 37/37 PASS (`../logs/postfix-node22-server.log`); peer 53/53 PASS (`../logs/postfix-node22-peer.log`).
- Node v24.18.1: server 37/37 PASS (`../logs/postfix-node24-server.log`); peer 53/53 PASS (`../logs/postfix-node24-peer.log`).
- All runs used writable temp paths outside the source. Node 20 runs required approved outside-sandbox execution because that runtime otherwise failed while resolving the restricted ancestor path.

### Abort cleanup repeat and stress

- Official Node v22.16.0 supplied named abort test: 20/20 PASS; wall duration 4,421.001 ms.
- Node v22.16.0 complete direct-transfer file: 10/10 PASS; runner duration 5,018.7652 ms.
- Node v22.16.0 queued 20+ aborts, recovery, idempotent stop, and immediate port reuse focus: 1/1 PASS; test duration 1,294.8666 ms.
- Node v24.18.1 supplied named abort test: 10/10 PASS; wall duration 2,368.949 ms.
- Logs: `../logs/postfix-stress-node22-abort-repeat20.log`, `../logs/postfix-stress-node22-direct-transfer-full.log`, `../logs/postfix-stress-node22-queued-abort-port-reuse-focused-valid.log`, and `../logs/postfix-stress-node24-abort-repeat10.log`.
- One earlier focused command used an incorrectly escaped `20+` name pattern and is retained only as superseded environment evidence; it is not counted.

### Path and junction security matrix

- Node v20.0.0, v22.16.0, and v24.18.1: 9/9 PASS each outside the sandbox.
- On all three runtimes, a Windows `LocalAlias` junction escape and an Embedded Package directory junction escape were actually created and rejected as `symlink_rejected`.
- Ordinary file symlink creation remained unavailable with `EPERM`; case-only duplicate creation is unavailable on this case-insensitive filesystem. Validator-level collision rejection and all remaining traversal/absolute/drive-relative/UNC/URI/root/missing-package cases executed and passed.
- Logs: `../logs/postfix-path-security-node20.log`, `../logs/postfix-path-security-node22.log`, `../logs/postfix-path-security-node24.log`.

### Static, smoke, validator, and audit gates

- Environment: Node v24.18.1; npm 11.16.0.
- All repository `.mjs` syntax: 40/40 PASS; 1.742 s; `../logs/postfix-node24-all-mjs-syntax.log`.
- Server smoke: PASS; 0.611 s; `../logs/postfix-node24-server-smoke.log`.
- Project-peer smoke: restricted first run failed `mkdtemp EPERM`; identical approved outside-sandbox run PASS in 0.552 s with `serverRelayUsed=false`; passing evidence is `../logs/postfix-node24-project-peer-smoke-escalated.log`.
- Repository validator: PASS; current working tree 171 files, 29 C# sources, protocol v1; 0.161 s; `../logs/postfix-node24-repository-validator.log`.
- Server and peer `npm audit --omit=dev`: zero vulnerabilities in both; package lock hashes unchanged. Logs: `../logs/postfix-node24-server-npm-audit.json.log` and `../logs/postfix-node24-project-peer-npm-audit.json.log`.
- Docker discovery: no CLI, common install, process, or service; `../logs/postfix-docker-discovery.log`. Compose config/image build are NOT RUN.

### Unity batch-mode attempt

- Installed editor: Unity 6000.3.21f1.
- Prepared a disposable full-repository copy so Unity-generated state could not contaminate the source.
- Requested command: batch/nographics compile/import run against the copied `unity-project` with an external log path.
- Result: NOT RUN. The host approval/usage system rejected the application launch before Unity started. No compile, EditMode, assembly-load, menu, Console, or `(GetStatus)` pass/fail is claimed.
- Static source search found no TeamForge use of `UnityEditor.Progress`, `Progress.Start/Report/Finish/Remove/GetStatus`, `SearchService`, or `PackageManager.Events`; the known message remains cause-unconfirmed and non-blocking only based on the supplied manual observation.

## Still pending

- Unity compile/EditMode and second-open `(GetStatus)` observation remain unexecuted because of the host launch block.
- Docker compose/build remains unexecuted because Docker is unavailable.
- Final v0.4.1 Unity/LAN two-machine manual checklist and explicit user approval.

## Final-source transport boundary evidence

- Added real loopback/process cases: HTTP 503 `transfer_busy` plus retry, TCP RST plus retry, 100 ms stalled-response timeout plus retry, actual Seed A stop followed by Seed B completion, and receiver child-process kill/restart with exactly three fsynced/verified chunks reused and no repeat server reads.
- Node v22.16.0: added 5/5 PASS; final full peer 59/59 PASS after the listener fix; `../logs/postfix-final-source-node22-peer.log`.
- Node v24.18.1: added 5/5 PASS; final root run server 37/37 plus peer 59/59 PASS; `../logs/postfix-final-source-node24-root.log`.
- Node v20.0.0: the pre-addition core peer suite passed 53/53. The final added-only and final full rerun did not start because Node 20 requires outside-sandbox path access and the host rejected escalation at the usage/approval limit. Log: `../logs/transport-e2e-node20.0.0.log`. No final 58/59 Node 20 claim is made.

## Pipelined socket-listener cleanup

- Pre-fix reproduction: 20+ requests pipelined over one keep-alive socket reached 20 active requests and 23 close listeners, emitting `MaxListenersExceededWarning` for close and error listeners.
- Fix: one listener pair per socket plus a per-socket context set and idempotent cleanup.
- Focused post-fix: Node 22 1/1 PASS and Node 24 1/1 PASS, warning-free.
- Full direct-transfer: Node 22 11/11 PASS and Node 24 11/11 PASS.
- Final supplied abort repeat after this production change: Node 22 20/20 PASS; `../logs/postfix-final-abort-repeat20-node22.log`.
- Logs: `../logs/prefiX-pipelined-socket-listener-warning.log`, `../logs/postfix-pipelined-listener-focused-node22.log`, `../logs/postfix-pipelined-listener-focused-node24.log`, `../logs/postfix-direct-transfer-full-node22.log`, and `../logs/postfix-direct-transfer-full-node24.log`.

## Final-source static gates

- System Node v24.18.1: all repository `.mjs` files 42/42 syntax PASS.
- Server and Project Peer smoke: both PASS; Project Peer reports `serverRelayUsed=false`.
- Root `npm audit --omit=dev`: zero vulnerabilities at every severity.
- Repository validator: PASS, 173 files, 29 C# sources, protocol v1.
- Logs: `../logs/postfix-final-source-all-mjs-syntax.log`, `../logs/postfix-final-source-server-smoke.log`, `../logs/postfix-final-source-project-peer-smoke.log`, `../logs/postfix-final-source-root-npm-audit.json.log`, and `../logs/postfix-final-source-validator.log`.

## Source-only archive and fresh-extract validation

- Candidate inventory: 173 files, 29 C# sources, 42 `.mjs` files, protocol v1; zero `node_modules`, Unity generated directories, build/crash artifacts, `.env`, dump, or private-certificate entries.
- ZIP integrity: archive opens successfully and contains exactly 173 file entries with no wrapping directory. The exact final ZIP SHA-256 is recorded in the companion `.zip.sha256` and final test report to avoid self-reference inside the archive.
- Fresh extraction before install: 173 files; every relative path and per-file SHA-256 matches the packaged candidate; forbidden entry count zero; validator PASS.
- Fresh root `npm ci`: PASS, four packages installed, seven audited, zero vulnerabilities.
- Fresh root `npm test`: PASS; server 37/37, project peer 59/59, validator 173 files/29 C#/protocol v1.
- Fresh all-file syntax: 42/42 PASS.
- Fresh root smoke: server Phase 0-3 metadata flow PASS; peer direct payload/hash/inventory PASS with `serverRelayUsed=false`.
- Fresh root `npm audit --omit=dev`: zero info/low/moderate/high/critical vulnerabilities.
- Post-test source integrity: excluding newly installed `node_modules`, all 173 extracted source files still match the packaged candidate hashes.
- Logs: `../logs/final-candidate-inventory.log`, `../logs/final-fresh-preinstall-integrity.log`, `../logs/final-fresh-root-npm-ci-confirmed.log`, `../logs/final-fresh-root-npm-test.log`, `../logs/final-fresh-all-mjs-syntax.log`, `../logs/final-fresh-root-smoke.log`, and `../logs/final-fresh-root-npm-audit.json.log`.


## 2026-08-04 Unity field hotfix evidence

### User field evidence

- Unity 6000.3.21f1 with TeamForge package tests enabled reproduced CS0104 between `UnityEditor.PackageManager.PackageInfo` and `UnityEditor.PackageInfo`.
- Fully qualifying the Package Manager type removed the reported compile error; final candidate Batch/EditMode remains pending.
- Publish/Seed online showed `Identity and baseline metadata match`; stopping it changed the old UI to the conflated no-baseline/no-seed message.

### Current environment automated evidence

- Node: v22.16.0; npm: 10.9.2.
- Repository validator: PASS, 176 files, 29 C# sources, protocol v1.
- All repository `.mjs`: 42/42 syntax PASS.
- Focused dependency-independent suites: 38/38 PASS.
  - Manifest/path 9/9.
  - Direct transfer 11/11.
  - Swarm 13/13.
  - Real transport/process E2E 5/5.
- Modified Embedded Package manifest scan: PASS; all 79 package source files appear in the generated Publish Manifest.

### Blocked gates

- Root `npm ci`: environment failure; internal npm mirror returned 404 for the unchanged locked `ws@8.21.1` tarball. Public registry/DNS access was unavailable.
- Full root `npm test`, root smoke, and fresh audit: NOT RUN after the failed install.
- Unity Batch/EditMode: NOT RUN because Unity is not installed in this container.
- Docker: NOT RUN.


### Final hotfix source review rerun

- Existing bootstrap enum numeric values are explicitly preserved (`Ready = 6`, `InvitationMismatch = 9`); `BaselineAvailableNoSeed = 10`.
- Repository validator after the validation-script addition: PASS, 176 files / 29 C# / protocol v1.
- JavaScript syntax after final source review: 42/42 PASS.
- Focused dependency-independent suites rerun after final source review: 38/38 PASS.
- Modified Embedded Package scan rerun: PASS, 79/79 package files, 374,611 bytes, 79 chunks; ephemeral fixture manifest hash `4c3e01acd39c948c0ab41255c519f3e9cf3bb4e927be9db66a81839232c22e99`. This fixture hash is not a release baseline hash.
- `scripts/validate-hotfix-windows.ps1` was added for the remaining unchanged-lockfile Node and Unity 6000.3.21f1 gates. It cannot be executed in this Linux container because neither Windows PowerShell nor Unity is installed.


## 2026-08-07 Hotfix2 field rerun evidence

Unity 6000.3.21f1 Hotfix2 EditMode `Run All` left four failures:

- GlobalObjectId reload probe: `CloseScene` returned false because the test attempted to unload the final loaded Scene.
- Clean baseline probe: the test expected `scene.isDirty`, but its programmatic changes did not explicitly mark the Scene dirty.
- Remote target Undo probe: stale target state did not reappear in the observed steps; the guard Undo was delayed by an empty cleared target Undo group.
- Prefab remote-apply reload probe: `CloseScene` returned false before reload assertions.

The same unsupported final-Scene unload message appeared during cleanup of otherwise passing scene tests. Hotfix3 removes that invalid lifecycle assumption and preserves the actual Transform/Prefab/GlobalObjectId assertions for the next Unity run.


### Hotfix3 container regression

After the four Unity field failures were converted into test-harness fixes:

- Node `v22.16.0`, npm `10.9.2`.
- Exact user-supplied `ws@8.21.1` tarball was used only as an offline npm cache source; lockfiles/dependency versions were unchanged.
- Server: 37/37 PASS.
- Project Peer: 59/59 PASS.
- Repository Validator: PASS, 177 files / 29 C# / protocol v1.
- Repository `.mjs` syntax: 42/42 PASS.
- Server Smoke: PASS.
- Project Peer Smoke: PASS, `serverRelayUsed=false`.
- npm audit: 0 vulnerabilities.
- Unity is not installed in this container, so Hotfix3 EditMode remains a real Windows/Unity gate and is not claimed as passed.


## 2026-08-07 Hotfix3 fresh-extract archive validation

The first fresh-extract attempt was interrupted before extraction completed and is not evidence. A new clean directory was created and the Hotfix3 candidate was validated from scratch.

- ZIP integrity test: PASS; 177 file entries, corrupt member: none.
- Fresh extraction: 177 files. ZIP member SHA-256 vs extracted file SHA-256: 177/177 match before install.
- Exact user-supplied `ws@8.21.1` tarball was used only to seed a separate offline npm cache; repository lockfiles and dependency versions were unchanged.
- Fresh root `npm ci --offline`: PASS; 4 packages added, 7 audited, 0 vulnerabilities.
- Fresh root `npm test`: PASS; Server 37/37, Project Peer 59/59, Repository Validator PASS at 177 files / 29 C# sources / protocol v1.
- Fresh source-only `.mjs` syntax: 42/42 PASS.
- Fresh root `npm run smoke`: PASS; Server flow PASS and Project Peer reports `serverRelayUsed=false`.
- Fresh root `npm audit --omit=dev --offline`: 0 vulnerabilities.
- Post-test source integrity: all 177 packaged source files still match the candidate ZIP hashes; generated `node_modules` is excluded.
- Forbidden generated Unity/source entries (`Library`, `Temp`, `Logs`, `UserSettings`) in the packaged source: 0.
- Unity 6000.3.21f1 EditMode `Run All` for Hotfix3 remains the only immediate Hotfix3-specific field gate and is NOT claimed by this container.

Phase 4 remains forbidden until the remaining Unity/manual Phase 3 release gates pass and the user explicitly approves Phase 4.

## 2026-08-07 user field evidence imported into closure

- Hotfix3 Unity 6000.3.21f1 EditMode Run All: user reported Failed 0 / Console errors 0.
- Direct P2P E2E: 144/144 chunks verified; fingerprint approval; Active created; secret-free pre-open structure confirmed.
- Short-path Active opened in Unity; SampleScene and TeamForge menu present; local token reconnect/RTT passed; `(GetStatus)` did not reproduce.
- Seed offline/online state separation and realtime independence passed.
- Resume interrupted at 25/144 and completed from the same root/invite.
- Seed A 5091 termination switched to Seed B 5092 with `switched=true` and completed.
- Receiver abort followed by Seed shutdown and immediate 5091 rebind passed.
- Phase 0-2 two-Editor regression passed for Presence/selection/camera, bidirectional Transform and Lock behavior.

These are previous Hotfix3 field results. Stage A changes do not touch Unity C# source, but they are not mislabeled as a newly executed Unity run.

## 2026-08-07 Stage A automated evidence

- Root `npm ci --offline`: PASS using the exact user-supplied `ws-8.21.1.tgz` whose integrity matches the unchanged lockfile.
- Server: 37/37 PASS.
- Project Peer: 62/62 PASS, including three new CLI-policy/path tests and expanded resumed transfer statistics assertion.
- Repository validator: PASS, 180 files, 29 C# sources, protocol v1.
- Targeted path preflight: long field root -> high risk; short `<USER_HOME>\TF-R` root -> not high risk.
- Stage A smoke/audit/fresh-extract evidence is recorded later in this file after the frozen candidate is built.

### Dependency audit environment boundary

`npm audit --omit=dev` could not contact either the sandbox npm mirror audit endpoint (404) or public npm registry (`EAI_AGAIN`). This is an environment/network block, not a PASS. Stage A did not change any dependency or lockfile. The exact `ws` dependency remains 8.21.1, the same field/fresh-tested package resolution; current public security records list the 2026 ws fragmentation DoS as affecting versions **before** 8.21.1. A connected environment should rerun `npm audit --omit=dev` before public release.

### Provisional Stage A fresh-extract gate

- Provisional archive: 185 source files; pre-install fresh extraction matched every relative path and per-file SHA-256.
- Fresh `npm ci --offline`: PASS; 4 packages installed, 7 audited, npm reported 0 vulnerabilities during install.
- Fresh root tests: Server 37/37 PASS; Project Peer 62/62 PASS; validator PASS at 185 files / 29 C# / protocol v1.
- Fresh smoke: Server PASS; Project Peer PASS with `serverRelayUsed=false`.
- Fresh `.mjs` syntax: 46/46 PASS.
- Standalone `npm audit --omit=dev` remains network-blocked as recorded above; no dependency/lockfile changed.

## 2026-08-07 Phase 4 assistant takeover evidence
- Phase 4 server hierarchy model + integration suites executed after additional lock/delete hardening: **49/49 PASS**.
- New evidence includes deterministic create/reorder/reparent behavior, duplicate-name acceptance, subtree tombstones and no-resurrection, stale concurrent operation rejection, parent/subtree lock conflict rejection, and Presence selection cleanup after authoritative delete.
- Phase 3 Project Peer regression suite remains **62/62 PASS** from the same Stage B tree before final packaging; it will be rerun in the final full gate.
- Repository validator previously passed with Phase 4 sources; it will be rerun after final docs/validator requirements are updated.
- Unity Editor is not available for actual `6000.3.21f1` Compile/EditMode execution here. Do not mark Phase 4 Unity tests PASS until user field execution.


## 2026-08-07 Phase 4 hierarchy implementation evidence update
- Added authoritative `sceneIds` to hierarchy snapshots so empty authoritative Scenes are distinguishable from never-seeded Scenes.
- Added initial Unity snapshot mismatch guard: a clean local Scene containing objects outside the authoritative Global/logical identity set is rejected instead of guessing identity or duplicating objects.
- Added server pure-model coverage for duplicate names, sibling clamping/canonicalization, create/reparent transform preservation, subtree tombstones, resurrection rejection, missing parent/cycle and same-base stale concurrency.
- Added realtime integration for destination-parent/subtree locks and delete-driven Presence selection cleanup.
- Latest actual server suite before final packaging: 49/49 PASS.
- Latest Project Peer suite before final documentation-only updates: 62/62 PASS.
- Latest repository validator before final documentation additions: 197 files / 33 C# / protocol v1 PASS.
- Unity `6000.3.21f1` Compile/EditMode remains NOT RUN in this execution environment; hierarchy C# tests are source/static evidence only until user field execution.

## 2026-08-07 Phase 4 source release-gate run
- Root `npm test`: PASS — Server 49/49, Project Peer 62/62, validator 204 files / 33 C# / protocol v1.
- Root smoke: PASS; Project Peer reports `serverRelayUsed=false`.
- Repository-owned `.mjs` syntax: 46/46 PASS.
- Standalone `npm audit --omit=dev`: NOT AVAILABLE; configured internal npm mirror audit endpoint returned HTTP 404. Do not claim audit PASS.
- Unity Compile/EditMode: NOT RUN in this environment.
- Fresh-extract candidate validation still pending at this point in the ledger.


## 2026-08-07 Phase 4 provisional fresh-extract candidate gate
- Current Stage B source gate rerun: root `npm test` PASS — Server 49/49, Project Peer 62/62, validator 204 files / 33 C# / protocol v1.
- Source smoke PASS; Project Peer `serverRelayUsed=false`.
- Source-owned `.mjs` syntax 46/46 PASS.
- Connected `npm audit --omit=dev` remains unavailable because the configured internal npm mirror audit endpoint returns HTTP 404; no dependency/lockfile was changed to bypass it.
- Provisional archive `Unity-TeamForge-Phase4-v0.5.0-candidate-provisional.zip`: 204 source entries; ZIP integrity PASS; source/ZIP/fresh relative paths equal; 204/204 pre-install SHA-256 match.
- Provisional fresh `npm ci --offline`: PASS; 4 packages installed and npm install-time audit reports 0 vulnerabilities.
- Provisional fresh root tests: Server 49/49 PASS, Project Peer 62/62 PASS, validator 204 files / 33 C# / protocol v1 PASS.
- Provisional fresh smoke PASS, `serverRelayUsed=false`; `.mjs` syntax 46/46 PASS.
- Provisional fresh `npm audit --omit=dev --offline`: 0 vulnerabilities using the available offline npm advisory/cache data. This does not replace a connected audit before public release.
- Post-test integrity: all 204 packaged source files still match the provisional ZIP; archive contains no `node_modules`, Unity generated directories, `.env`, server-token, bearer-token or Owner private-key entries.
- Documentation review found stale historical/current wording in root/server/peer/deployment/roadmap/compatibility/Unity package docs (including the old 64 KiB message-limit text and Phase 4-not-started wording). Those documents were corrected before the final archive freeze, so this provisional archive is not the final deliverable.
- Unity `6000.3.21f1` Compile/EditMode remains NOT RUN here.


## 2026-08-08 Phase 4 initial candidate Unity compile field result

- Unity: `6000.3.21f1`.
- Initial `0.5.0` candidate C# compile: **FAIL**.
- Blocking diagnostics:
  - `TeamForgeHierarchySyncService.cs(1142,17): CS0177`
  - `TeamForgeHierarchySyncService.cs(1161,13): CS0177`
- Non-blocking diagnostics:
  - `TeamForgeHierarchyIdentityRegistry.cs(138,26): CS0618 EditorUtility.InstanceIDToObject obsolete`
  - `TeamForgeHierarchyIdentityRegistry.cs(182,30): CS0618 EditorUtility.InstanceIDToObject obsolete`
- Hotfix1 source fixes both diagnostic classes.
- Post-patch Node/static evidence: Server 49/49 PASS; Project Peer 62/62 PASS; validator PASS (204 tracked files before this documentation addendum); smoke PASS; `.mjs` syntax PASS.
- Hotfix1 Unity compile/EditMode: NOT RUN yet; user rerun required.


## 2026-08-08 Phase 4 Hotfix1 Unity PASS + Hotfix2 warning cleanup

- User field result on Hotfix1 / Unity 6000.3.21f1: EditMode Test Runner **70/70 PASS**.
- Remaining warnings: two `CS0618` diagnostics for `Resources.InstanceIDToObject(int)` in `TeamForgeHierarchyIdentityRegistry.cs` lines 138 and 182.
- Hotfix2 changes registry live keys to `EntityId`, obtains them with `GetEntityId()`, and resolves with `Resources.EntityIdToObject(EntityId)`.
- Hotfix2 non-Unity working-tree evidence after `npm ci --offline`: Server 49/49 PASS; Project Peer 62/62 PASS; validator PASS; smoke PASS; `.mjs` syntax 48/48 PASS; offline audit 0 vulnerabilities.
- Hotfix2 Unity compile/warning-clean/EditMode result remains pending user rerun; do not infer C# compile success from static validation.

## 2026-08-08 Phase 4 Hotfix2 Unity field gate PASS
- Target Editor: Unity `6000.3.21f1`.
- Previous `Resources.InstanceIDToObject(int)` CS0618 warnings are no longer reported after EntityId migration.
- User field Test Runner EditMode result: **70/70 PASS**.
- No new blocking TeamForge compile error was reported.
- Phase 4 Hotfix2 is accepted as the manual hierarchy-E2E baseline; hierarchy behavior itself is not yet marked PASS until two-Editor field tests complete.

## 2026-08-08 Phase 4 Hotfix3 create-to-Transform integration fix

- Two-Editor Hotfix2 field screenshot: Connection/RTT/Presence PASS; hierarchy create visible on both Editors; rename synchronized at revision 2 with 0 hierarchy conflicts.
- Field failure: newly-created selected object remained outside creator Transform tracking; creator showed `Object is not in the clean Scene baseline...` while the peer could own the lock, and the object Transform diverged.
- Source root cause confirmed in `ApplyHierarchyAuthoritativeState`: hierarchy baseline upsert did not retry the earlier failed selection tracking.
- Hotfix3 re-arms the exact selected logical object after authoritative baseline admission and preserves the authoritative create Transform when a newer local delta exists.
- Added EditMode regression `AuthoritativeHierarchyCreateRearmsSelectedTransformTrackingAndPreservesPendingDelta`.
- Hotfix3 working-tree root `npm test`: Server 49/49 PASS; Project Peer 62/62 PASS; repository validator PASS at 208 files / 33 C# / protocol v1 before Hotfix3 documentation packaging additions.
- Unity Hotfix3 compile/EditMode is NOT RUN in this environment. Expected field test count is 71; do not claim the targeted bug fixed until the user rerun and two-Editor create+move convergence pass.

## 2026-08-08 Phase 4 Hotfix3 regression-harness field failure / Hotfix4 correction

- User Hotfix3 EditMode result: targeted regression `AuthoritativeHierarchyCreateRearmsSelectedTransformTrackingAndPreservesPendingDelta` FAIL at the initial status assertion; expected `clean Scene baseline`, actual `No GameObject selected.`
- The failure occurred before `ApplyHierarchyAuthoritativeState(...)`, so it did not execute the Hotfix3 runtime re-arm path.
- Source review identified a brittle test assumption: `Selection.activeGameObject` assignment was expected to synchronously dispatch `Selection.selectionChanged` during the same Test Runner frame.
- Hotfix4 explicitly invokes `BeginTrackingSelection(false)` after assigning the target, then performs the original authoritative-create/pending-delta assertions.
- Product runtime source is unchanged from Hotfix3.
- Hotfix4 validator and `.mjs` syntax PASS. Full npm rerun is not claimed because offline install is currently blocked by an absent cached `ws@8.21.1` tarball.
- Unity Hotfix4 71/71 and targeted two-Editor create+move convergence remain pending.


## 2026-08-08 Phase 4 Hotfix5
- Field: bidirectional rename propagated but observing peer temporarily reset Transform to stale zero until next owner movement.
- Root cause: stale Server Hierarchy transform record + Unity full-state apply for rename/reorder.
- Hotfix5 working-tree automated result: Server 50/50 PASS; Project Peer 62/62 PASS; validator PASS; smoke PASS with `serverRelayUsed=false`; offline audit 0 vulnerabilities.
- Unity Hotfix5 field gate pending; expected EditMode total is 72.

## 2026-08-10 Phase 4 UX Pass 4 Closure field evidence

- Evidence source: user-reported field execution; it was not executed by the WP0 documentation environment.
- Exact candidate: `Unity-TeamForge-Phase4-v0.5.0-uxpass4-candidate.zip`.
- Candidate SHA-256: `ED27CC23459B15AB90337A7DF181996D469A2DC33F252EE49125814256521AE7`.
- Unity Editor: `6000.3.21f1`.
- Unity EditMode Test Runner: **94/94 PASS**.
- A/B/C Late Join: **PASS**.
- UX Pass 4 Language / Tooltip / Invite basic UX: **PASS**.
- Earlier stage-specific pending/NOT RUN entries above remain historical records for those earlier candidates. This entry supplies the later exact-candidate Closure evidence and does not claim a WP0 Unity rerun.
