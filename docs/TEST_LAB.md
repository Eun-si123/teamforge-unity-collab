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

## Scenario map

| Scenario | Purpose | Important prerequisite / boundary |
| --- | --- | --- |
| `source` | Repository workflow/docs/engineering/public-source contracts | No Unity or packaged release required |
| `core` | Server + Project Peer automated tests | Locked npm dependencies installed |
| `launcher` | Runtime loader + Launcher Core + diagnostics privacy contract | .NET 10 SDK for C# tests |
| `launcher-ui` | Native WPF input and MainWindow credential-cleanup tests | Windows x64 + .NET 10 SDK; source UI evidence, separate from exact ZIP/physical testing |
| `all-local` | `source` + `core` + `launcher` | Prepared source checkout; still not Unity/field evidence |
| `authority-chaos` | Multi-seed authority/recovery stress | CI workflow owns server lifecycle/evidence today |
| `unity` | Unity EditMode + real-server E2E | Supported Unity/CI license environment |
| `release` | Staged candidate validation + exact published artifact lane | Fully staged candidate and Windows/exact-artifact environment as applicable |
| `field-two-pc-selftest` | Field runner source regression | Automated configuration, fixture and IPC safety (not physical field evidence) |
| `field-two-pc` | Two real Windows PCs: authenticated Project Peer LAN transfer | Host controls Guest over trusted SSH; physical source-level payload, SHA-256 and resume; not Unity/packaged release |
| `field` | Physical multi-PC Windows validation | Full packaged Host/Guest + Unity field lane still requires exact evidence |

For two-PC source-level LAN automation, setup prerequisites and strict PASS semantics, see [FIELD_TWO_PC_AUTOMATION.md](FIELD_TWO_PC_AUTOMATION.md). The existing `field` manual gate remains deliberately distinct from this narrower automated lane.

## Result and evidence behavior

Each `run` creates a directory under:

```text
test-results/test-lab/<timestamp>-<scenario>/
```

and always writes `summary.json`.

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
