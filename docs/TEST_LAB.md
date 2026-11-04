# TeamForge Test Lab

Test Lab is a **thin scenario runner over TeamForge's existing validators and tests**. It does not replace the Server, Project Peer, Launcher, Unity, chaos, release, or physical field test implementations.

Its purpose is to answer a practical question:

> I changed something — what named validation scenario can I run, and which parts still require another environment or manual evidence?

The canonical scenario definitions live in [`../test-lab.json`](../test-lab.json). The runner lives in [`../scripts/test-lab.mjs`](../scripts/test-lab.mjs).

## Design rules

Test Lab follows a few deliberate rules:

- Existing tests remain the source of actual assertions; Test Lab orchestrates them rather than rewriting them.
- Scenarios have stable names such as `source`, `core`, `launcher`, and `all-local`.
- No automatic retry hides a flaky failure.
- Successful command logs are discarded by default; failed-step logs are retained as bounded evidence.
- `--keep-logs` can retain successful command logs during focused debugging.
- External or manual lanes are never converted into a fake PASS.
- Unity, exact Release, and physical field evidence keep their real environment boundaries.
- A scenario result applies only to the exact commands/evidence that ran.

## Commands

List scenarios:

```powershell
npm run testlab -- list
```

See what a scenario would require without running it:

```powershell
npm run testlab -- plan all-local
npm run testlab -- plan unity
npm run testlab -- plan field
```

Run a local scenario:

```powershell
npm run testlab -- run source
npm run testlab -- run core
npm run testlab -- run launcher
npm run testlab -- run all-local
```

Keep logs even for successful command steps:

```powershell
npm run testlab -- run launcher --keep-logs
```

Validate the Test Lab configuration itself:

```powershell
npm run testlab:validate
```

Run the Test Lab runner and environment regression tests with `npm run test:testlab`. The same suite is included in `npm test`, the `source` scenario and CI; configuration validation alone does not execute it.

Check the environment before starting a scenario:

```powershell
npm run testlab -- doctor core
npm run testlab -- doctor unity --json
npm run testlab -- doctor unity --unity-root "D:/Unity/Hub/Editor"
npm run testlab -- doctor unity --editor "/opt/Unity/Hub/Editor/6000.3.21f1/Editor/Unity"
```

`doctor` checks the running Node version against `release-contract.json`, command availability, declared scenario prerequisites, pinned `ws` installation for core tests, and the required .NET SDK major where applicable. Requirements are inherited from included scenarios. It discovers Editor candidates in standard Unity Hub locations or supplied `--unity-root` directories. `--editor` overrides `UNITY_EDITOR`; an invalid or different explicit selection cannot fall back to another baseline candidate. Custom Hub locations require `--unity-root` or an explicit Editor path.

This is **environment preflight**, not test evidence. `READY` (exit 0) describes the checked prerequisites only. `BLOCKED` or `INCOMPLETE` exits 2; invalid commands/configuration exit 1. Unity folder names remain unverified version hints, and Unity license/compilation/EditMode tests remain **NOT RUN** even when an executable is discovered. External/manual and physical field lanes stay incomplete. Field preflight finds local Git/SSH but leaves `TEAMFORGE_FIELD_*` configuration (including `TEAMFORGE_FIELD_UNITY_EDITOR`), trusted remote access and physical topology to the owning field runner. Discovery never launches Editors, creates Projects, starts servers or retries tests. It neither installs missing tools nor validates field credentials, dependency integrity, exact Release artifacts or physical PCs. Other discovered Unity versions do not expand the supported version range.

`--json` returns a structured report with `testsExecuted: false`, individual prerequisite statuses and the remaining external lanes. Doctor writes no test-result artifacts. Reports include local executable paths; review them before sharing.

## In-Unity two-PC Test Lab (no SSH / Node developer setup)

The **same TeamForge pre-release Unity package** now contains a two-PC connection smoke panel under **Window → TeamForge → Test Lab**, alongside the original same-PC A/B/C clone lab. It is **not a separate downloadable Test Lab edition**.

The single-PC clone lab creates fresh `TF-B-<batch>`, `TF-C-<batch>` (and optional `TF-D-<batch>`) folders on every run. Earlier labs, their edits, and existing `TF-B/C/D` folders are preserved. Clone destinations must be direct directory paths without symbolic links or reparse points. Launcher source aliases remain usable; their physical source directory is checked to reject destinations inside that Project. A failed copy keeps partial folders accessible through **Show Last Lab Folder** and does not launch clone Editors; remove unwanted labs manually after closing their Editors. These local path checks do not protect against another process changing filesystem links during a copy.

For a source checkout that references TeamForge outside the Project through a local `file:` dependency, the clone lab checks the loaded package identity and copies a hash-verified snapshot into each clone's `Packages/com.eunsung.teamforge`. If the loaded TeamForge package is already embedded there while the manifest retains an old external reference, it instead verifies the project-copied package's complete effective inventory and hashes without replacing or repairing its files. It changes only that clone manifest's dependency value to `file:com.eunsung.teamforge`; other manifest bytes and the entire existing lock remain unchanged. Unity UPM owns subsequent local-package resolution and lock updates. Other external local packages require manual embedding **and a project-local manifest reference** first; nested local-package dependencies remain unsupported and produce an actionable refusal. Source package files, earlier clones and source manifest/lock are preserved; `.git` directories and worktree pointer files are omitted from new copies. Snapshot checks use bounded reads and reject static links and special files. Source/standalone fixture checks do not establish that a new Editor has resolved or opened the clone.

1. Open the **same saved Host Project/Scene** (or a verified host copy/sync) with the same TeamForge package on both Unity Editors; back up important work first. The Guest must preserve Project UUID and Scene baseline rather than editing IDs to bypass them.
2. PC A: click **Host: Start**, follow existing authenticated LAN, Windows Firewall, and explicit Publish Review prompts, and wait for Host Ready. Click **Copy TF1**, share that with PC B, then **Copy access code** and share it separately in a trusted channel. The session invite intentionally **does not include a password**.
3. PC B: paste the TF1 code and separate access code into the Test Lab Guest fields; click **Guest: Join & check**. A Project or Scene mismatch stops the join; use the existing TeamForge Home/Project Bootstrap verified copy/sync rather than bypassing validation.
4. PC A: click **Run checks** as well. Both Editors report a live check result. A check waits at most 90 seconds for connection, negotiated Presence/Transform/Hierarchy capabilities, server Ping/Pong, authoritative Hierarchy snapshot, and another TeamForge Presence member.

This smoke flow uses the packaged TeamForge Coordinator/Seed and existing Join Code/Host Flow mechanisms. A **smoke PASS** reports only the named observations. It does not prove the peers are physically distinct (two local Editors can also match Presence), mutate or compare Transform/Lock state, perform Launcher install/Project Transfer, inject faults, or close the exact release two-PC field gate. The separate CLI `field-two-pc-automated` suite remains a **developer diagnostic**, not a required install for this Editor smoke flow.

No Test Lab secrets are persisted in the Guest password field by this window; connection credentials are passed to the existing transient Guest settings path. Share the access code separately, and review any logs before sending them to others.

## Scenario map

| Scenario | Purpose | Important prerequisite / boundary |
| --- | --- | --- |
| `source` | Test Lab regressions + repository workflow/docs/engineering/public-source contracts | No Unity or packaged release required |
| `core` | Server + Project Peer automated tests | Locked npm dependencies installed |
| `launcher` | Runtime loader + Launcher Core + diagnostics privacy contract | .NET 10 SDK for C# tests |
| `launcher-ui` | Native WPF input and MainWindow credential-cleanup tests | Windows x64 + .NET 10 SDK; source UI evidence, separate from exact ZIP/physical testing |
| `all-local` | `source` + `core` + `launcher` | Prepared source checkout; still not Unity/field evidence |
| `realtime-transport-recovery` | Abrupt socket loss and TCP blackhole followed by authoritative Node peer rejoin | Own loopback Server/proxy/peers; no NIC/firewall changes; not Unity automatic reconnect or physical Wi-Fi evidence |
| `authority-chaos` | Multi-seed authority/recovery stress | CI workflow owns server lifecycle/evidence today |
| `unity` | Unity EditMode + real-server E2E | Supported Unity/CI license environment |
| `release` | Staged candidate validation + exact published artifact lane | Fully staged candidate and Windows/exact-artifact environment as applicable |
| `field-two-pc-selftest` | Field runner source regression | Automated configuration, fixture and IPC safety (not physical field evidence) |
| `field-two-pc` | Two real Windows PCs: authenticated Project Peer LAN transfer | Host controls Guest over trusted SSH; physical source-level payload, SHA-256 and resume; not Unity/packaged release |
| `field-realtime-selftest` | Cross-platform harness source regressions | No physical PC or Unity execution required |
| `field-realtime-two-pc` | Unity Editor Host on PC A versus Node Peer on PC B | Real LAN authority/Transform/Lock/Hierarchy contention using existing E2E tests; **not** two Unity Editors or packaged Launcher |
| `field-two-pc-automated` | Combined physical LAN batch | Runs the two narrower source-level physical lanes sequentially; full packaged two-Unity-Editor `field` gate remains separate |
| `field` | Physical multi-PC Windows validation | Full packaged Host/Guest + Unity field lane still requires exact evidence |

For two-PC source-level LAN automation (including the Unity Editor vs physical Node Peer extension), setup prerequisites and strict PASS semantics, see [FIELD_TWO_PC_AUTOMATION.md](FIELD_TWO_PC_AUTOMATION.md). The existing `field` manual gate remains deliberately distinct from this narrower automated lane.

For a remotely managed or headless Guest, first exercise scoped transport failure without cutting its management connection:

```powershell
npm run install:all
npm run testlab -- doctor realtime-transport-recovery
npm run testlab -- run realtime-transport-recovery --keep-logs
```

The server-owned `realtime-transport-recovery.test.mjs` fixture creates an authenticated disposable Server and TCP forwarder on OS-assigned loopback ports. It drops or blackholes only its own Guest connection while an unaffected observer keeps the Session alive. It verifies connection-loss lock cleanup before rejoin, fresh authoritative state, replay of an applied but unacknowledged operation without an extra revision, conflicting replay refusal and continued supported mutations. The fixture owns bounded waits and closes its sockets/listeners; no existing Server, NIC, firewall or remote-access setting is changed. Normal Server tests also run these cases. Test Lab retains the ordinary structured command result and optional bounded logs. PASS is automated **Node transport fault evidence**, not Unity automatic retry, disconnected UI, actual Wi-Fi interruption, physical two-PC recovery or packaged Release evidence; those parts of [#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457) remain separate.

The [Unity CI workflow](../.github/workflows/unity-tests.yml) runs the same Realtime Authority and Lock Contention E2E flows against the recorded `6000.3.21f1` baseline, the `6000.3.27f2` LTS patch and the explicitly labelled `6000.6.7f1` experimental Editor. Each matrix job uses an isolated checkout; each flow runs one Editor at a time, keeping the workflow's existing maximum of two concurrent Editors. Baseline check/artifact names are preserved, and each additional Editor has separate names and evidence. A failing matrix cell does not automatically retry or cancel its sibling. A configured matrix is not execution evidence: inspect each exact-commit result and actual Editor version. The [compatibility policy](compatibility.md#unity-compatibility) keeps 6000.6 source admission experimental; this does not change the recorded release Editor, supported minimum, packaged candidate or physical field readiness.

Only baseline Authority CI is configured to export one fresh Test Lab clone and open it in a **second, sequential Editor** after the original Editor finishes and the E2E shutdown step runs. The owning `TeamForgeCloneEditorProbeTests` fixture uses the existing copier and verified package snapshot, without a clone bootstrap, session setup or launch command. Host checks bind source/package/manifest/initial lock hashes and fresh NUnit XML to a unique run/attempt receipt. The pinned baseline Editor may initialize its three observed Linux SDK dependencies at version 1.1.0; a canonical manifest fingerprint still requires every original field to remain unchanged. The exporter checks source bytes before/after copying, and subsequent stages require that exact initialized source manifest. The separate Editor must execute exactly its intended probe and report an actual embedded `PackageInfo` rooted inside that clone. UPM may update its own TeamForge lock record; unrelated lock entries and source files must remain unchanged. This lane proves only the exact clone import/compile/UPM path that ran, not concurrent Editors, physical PCs or a packaged Release. Missing or skipped selected tests, zero-test runs and wrong-test evidence never count as PASS; intentional ignores elsewhere in the source suite do not replace either required test. A license/import failure does not establish that the probe ran. There is no automatic retry or guarantee that a failed license return releases a seat.

The host boundary regressions run before any Editor in that cell. On Linux with Bash and Python 3, run them separately with `python3 -m unittest discover -s scripts -p test_unity_clone_probe.py`; they use synthetic XML and temporary files, not Unity. CI retains logs, XML and bounded receipts under nonce-specific evidence paths, uploads them, then removes only that run's owned clone using a path-checked privileged cleanup command because container output can be root-owned. It does not upload the complete clone or remove earlier labs. Static path checks do not guarantee protection against another process changing filesystem links during execution.

Both Unity flows prepare disk space before pulling the Editor image. `scripts/prepare-unity-runner.sh` runs only on disposable GitHub-hosted Linux runners, removes a fixed allowlist of unused host SDKs (.NET, Android, Haskell, Swift, PowerShell, CodeQL and Azure CLI), and checks for at least 30 GiB free on Docker storage. Node, system Python, the workspace, Docker data and the rest of the toolcache are preserved. It refuses local or self-hosted execution. Docker capacity is printed before and after cleanup, including when insufficient capacity blocks the job before Editor execution; this threshold is a prerequisite check, not a guarantee of successful image extraction. Host tests mock every cleanup command and never remove installed SDKs.

## Result and evidence behavior

Each `run` creates a directory under:

```text
test-results/test-lab/<timestamp>-<scenario>-<unique-suffix>/
```

The suffix is allocated atomically so simultaneous runs (including runs started within the same second) retain separate evidence. Each run writes its own `summary.json`.

A command step that fails retains a bounded log for investigation. A command step that passes removes its log unless `--keep-logs` was requested. This keeps the common success path lightweight while preserving failure evidence.

Individual step logs are capped so a runaway process does not silently create an unbounded diagnostic artifact.

**Test Lab logs are not privacy-redacted support bundles.** They contain whatever stdout/stderr the underlying developer command emitted, are kept only as local ignored test output by default, and must be reviewed before sharing. Do not run tests with real credentials in their output or assume the runner can sanitize arbitrary child-process text. The Launcher **Save support bundle** feature has a separate default-redaction contract and should not be confused with Test Lab logs.

The scenario status is one of:

- `passed` — every required Test Lab command step completed successfully and no external/manual step remained;
- `failed` — at least one command step failed;
- `incomplete` — the local commands may have succeeded, but an external/manual evidence lane is still required.

`incomplete` deliberately uses a non-zero exit status. This prevents a script from treating “Unity/field evidence was not run” as success.

## Suggested one-batch physical validation for the next exact Windows candidate

This is a **preparation/order guide**, not current release readiness or a claim that the listed feature exists in the last published ZIP. The canonical blockers and release identity belong to [STATUS.md](STATUS.md); each GitHub Issue owns its detailed repro. It is reasonable to defer all hands-on work until one **new, immutable, exact-validated candidate** is selected. Do not treat r8 physical observations or green source CI as results for that future artifact.

**Before touching either PC:** record the exact candidate tag/commit, ZIP filename and SHA-256, Unity Editor version, Launcher/Runtime identity, Windows versions and test network topology in a *private/local* field log. Use disposable backed-up Projects and a clean Launcher extraction. Keep real access codes, invitation contents, private machine paths, addresses and unredacted diagnostics out of public issues. Verify the packaged Unity source/Launcher are from that **same candidate**; a mixed-source experiment needs a separate evidence label. Run the ordinary `source`, `core`, `launcher`, `unity` and exact `release` gates where supported **before** the physical batch, not as replacements for it.

| Order | Hands-on scenario | Required observation / failure proof |
| --- | --- | --- |
| 1. Host onboarding | First-run authentication generation, existing-code preservation, mask/reveal/copy/rotation while stopped; correct Host-vs-Guest field; auto route vs manually selected adapter; incomplete IPv4 refusal | Host must not silently change a working secret or infer a missing IP. Record the *error code and stage*, never the secret |
| 2. Host network/security | Authenticated LAN with Private/LocalSubnet firewall rule inspection, expected Coordinator listener and actual Seed port; verify a Public profile is not silently opened | Record allowed/refused connection **from the intended Guest**, not just a Host self-test. Never weaken firewall/auth merely to obtain PASS |
| 3. Fresh Guest bootstrap | Same-version signed Invite preview, Publisher/Project trust confirmation, empty managed root, direct chunk receive/hash/activation, short/long-path handling, Unity launch and realtime join | Verify the published Baseline, verified Active revision and Editor collaboration; a Host Ready label alone is insufficient |
| 4. Retry and recovery | Interrupted transfer and resumable download, same-invite credential retry, changed-invite code clearing, Host Stop/Start, Seed port collision/fallback, process-loss Project identity fence, Existing-Active verified relaunch | Confirm the previous verified Active survives failures and only TeamForge-owned resources are cleaned up |
| 5. Realtime collaboration | Two Editors present, selection/camera, Transform and locks under contention, same-Scene supported Hierarchy actions, late join, reconnect and foreign-lock notification | Compare observed authority/revision, ownership, saved Scene state and recovery; do not assume Component/Inspector/Prefab sync exists |
| 6. Negative boundary & cleanup | Malformed address, mismatched project/invite, absent Seed after apparent Ready, Guest unreachable due to routing/profile, second stop/start and final firewall cleanup | Capture sanitized stable failure codes and whether retries truly recover without bypassing identity/trust/hash checks |

For **each row and each retry**, mark `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`; attach exact candidate identity, steps, expected/actual result, timestamps and sanitized diagnostics/screenshots. A blocked earlier stage leaves dependent later stages **NOT RUN**, not PASS. If a fix requires rebuilding, assign the next distinct artifact identity and rerun the affected end-to-end steps, preserving prior failed evidence. Do not test future WP6 Component synchronization, no-code trusted LAN or one-paste scoped invites as existing features before their own explicit release gates are implemented.

At the end, update [STATUS.md](STATUS.md) with verified capability/readiness changes only, and link detailed evidence from the relevant Issue or dated field record. This document provides **execution order**, not a second current-status table.

## Why Unity and field tests are not hidden behind one local command

A convenient command must not erase an important environment boundary.

For example, `unity` points to the repository's real Unity workflow instead of printing PASS on a machine that never opened Unity. Likewise, `field` describes the required physical evidence but cannot satisfy it.

This is consistent with TeamForge's broader evidence model: **automation proves what it actually executed, not a stronger real-world claim.**

## Relationship to `quality-gates.json`

[`../quality-gates.json`](../quality-gates.json) answers **which validation lanes a changed path should trigger or review**.

Test Lab answers **how a contributor can discover and run named validation scenarios**.

The classifier is advisory about semantic risk, and Test Lab is an executor/planner. Neither may claim an external Unity, exact Release, security, or physical field lane passed without real evidence from that lane.

## Adding or changing a scenario

Treat Test Lab changes as test-infrastructure changes:

1. Start with [ENGINEERING_GUIDE.md](ENGINEERING_GUIDE.md) and a Change Plan for a non-trivial change.
2. Prefer referencing an existing test command/workflow instead of copying its assertions into Test Lab.
3. Give the scenario or step a stable, purpose-oriented name rather than a work-package-specific name.
4. Mark environment-dependent work as `external` or `manual` when the runner cannot execute it faithfully.
5. Do not add automatic retries just to make a flaky scenario green.
6. Run `npm run testlab:validate` and the relevant underlying tests.
7. Keep failure artifacts bounded, avoid real secrets in test output, and review retained logs before sharing.

If Test Lab starts accumulating domain-specific assertion logic, move that logic back into the owning module's test suite and leave Test Lab as orchestration.

## Explicit Windows Host LAN configuration check

In the current source, open **Window > TeamForge > Collaboration > Health > Check LAN configuration** on the Host PC. The action reads local Windows profile and named firewall-rule fields without elevation or changing rules. Ordinary Doctor/UI refresh does not launch this check.

- Before Host starts, the selected canonical IPv4 and Coordinator port can be inspected; the Seed port remains unbound/unverified. DNS/IPv6, ambiguous/nonlocal addresses and malformed or mismatched listeners remain unverified rather than being guessed.
- While Host is Ready, the check retains its exported startup configuration and reported bound Seed port, including a fallback port. Later settings edits are shown as pending; they do not substitute a preferred port for the running Seed.
- The profile must resolve from the exact preferred IPv4 on one connected interface. Rule observations cover one named enabled inbound Allow rule with Private profile, TCP local port, LocalSubnet remote scope and blocked edge traversal; extra/broad values and duplicate matches are rejected. Other Windows policy or application/service filters may still affect connectivity.
- Results show the last attempt time. Recheck after interface, profile or firewall changes; this is a local snapshot, **not proof that a Guest can connect or that a timeout was caused by a firewall**. Stop, target/settings changes, window close and UI rebuild invalidate/cancel obsolete checks. Cancelled/unknown checks are not reported as PASS.
- **Copy Report** includes only bounded observations, ports, codes and timestamp from the current snapshot. The LAN report omits addresses, adapter/SSID names, authentication data and raw PowerShell output.

Developer checks include `TeamForgeHostLanDiagnosticsTests`, the Home view/report tests and `node --test project-peer/test/host-lan-diagnostics.test.mjs`. The latter executes actual generated scripts under mocked Windows cmdlets in the Windows CI lane; default non-Windows runs skip it. Mocked scripts, isolated C# tests and Unity automation remain separate from real Windows policy and the [physical field matrix](#suggested-one-batch-physical-validation-for-the-next-exact-windows-candidate). This source feature does not change the immutable r9 package or current release readiness.
