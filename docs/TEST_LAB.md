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
| `all-local` | `source` + `core` + `launcher` | Prepared source checkout; still not Unity/field evidence |
| `authority-chaos` | Multi-seed authority/recovery stress | CI workflow owns server lifecycle/evidence today |
| `unity` | Unity EditMode + real-server E2E | Supported Unity/CI license environment |
| `release` | Staged candidate validation + exact published artifact lane | Fully staged candidate and Windows/exact-artifact environment as applicable |
| `field` | Physical multi-PC Windows validation | Human/physical release-specific run; cannot be replaced by CI |

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
