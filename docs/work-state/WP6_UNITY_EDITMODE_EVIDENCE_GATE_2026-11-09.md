# WP6 Unity EditMode source-to-NUnit execution evidence gate — 2026-11-09

## Motivation and real-world evidence

Draft PR #523 continues the live read-only Editor/Server WP6 Project provenance
chain. The GameCI `Unity Tests` workflow runs the unfiltered EditMode suite
on three Editor versions, but the workflow previously considered GameCI
success sufficient even when one particular *new WP6 class* was not
discovered or its tests were skipped. A passing matrix job or syntax
parse does not individually prove every WP6 Scene/Undo/Project gate
ran. This is a high-impact test-evidence false positive.

Retrieved the **actual** GitHub Actions `Unity Realtime Authority E2E`
artifact from run `42582288527` (November 9, 2026). It contained
`clone-editor-evidence/.../source-results/editmode-results.xml`,
with **543 total / 540 passed / 3 skipped** Unity test cases.
The full unfiltered primary XML includes exactly **31 passing WP6
test methods** defined across **6 WP6 NUnit classes** in this branch.
Independently retrieved the other two matrix artifacts from the same
run: Unity **6000.3.28f1** and experimental **6000.6.8f1** each
also ran and passed all **31 WP6 tests**. Their full NUnit XML
reported **539 passed / 4 skipped** (the baseline 6000.3.21f1
reported **540 passed / 3 skipped**).
The intentionally filtered separate Clone Editor probe's result XML
is **not** acceptable evidence for this gate. The GitHub CLI
could not extract this particular artifact by its default action,
so the archive was inspected without extraction and the single
bounded primary XML was selected by its internal path. No ZIP
content was unpacked blindly into a working tree.

## Implemented contract

- New `scripts/verify-wp6-editmode-results.py` receives an explicit
  `--results` path to the current primary GameCI `editmode-results.xml`
  and discovers the exact `TeamForgeWp6*Tests.cs` NUnit source
  classes in `unity-package/com.eunsung.teamforge/Tests/Editor/`.
- Checks each exact source file name matches the one declared class,
  every `[Test]` is attached to a supported test method and class,
  with no unsupported parameterized `[TestCase]` or `[UnityTest]`
  attributes silently lost. On historical main/branches that have
  no WP6 source classes, it prints an explicit skip rather than
  breaking unrelated existing CI.
- The bounded, nonredirected XML must have a `test-run` root,
  coherent total/pass/fail/skipped/inconclusive counts and precisely
  that number of actual `test-case` entries. Duplicate, missing,
  renamed, skipped, inconclusive or failed expected WP6 test cases,
  invalid test identities, malformed or entity-bearing XML are
  rejected. Other explicitly ignored non-WP6 tests do not
  invalidate a successful WP6 scope.
- A new step in the **real** `Unity Realtime Authority E2E` matrix
  reads the same primary source EditMode artifacts path as GameCI
  and the existing upload step. It runs after the actual EditMode
  tests but before accepting/reviewing the remaining E2E evidence.
  Matrix coverage remains baseline Unity 6000.3.21f1, selected
  6000.3.28f1 LTS and experimental 6000.6.8f1.
- The normal Node `Public source contract` workflow separately
  executes eight synthetic, adversarial Python XML tests so the
  verifier itself cannot regress unnoticed. The GitHub Actions
  structural tests pin the source-evidence step and its ordering.
  If a future WP6 test uses UnityTest/parameterized attributes,
  explicitly extend the parser *with tests*, rather than silently
  treating that case as verified.

## Security and limitations

This step checks the completed **runner's actual NUnit XML** against
**this checkout's C# WP6 test declarations**, not merely a GameCI
status badge, static syntax, or recycled artifact. It establishes
CI execution/evidence completeness for these methods **only**.
It does not verify a physical Windows Host+Guest, a real production
Project Transfer chunk-to-Editor value proof, remote Inspector writes,
rollback, undo/redo in a user session or network write privilege.
It never edits Unity Scenes or service state and never merges Draft
PRs or releases product `0.5.1` (still FIELD_BLOCKED).

Only simple `[Test]` signatures are currently supported; the
parser intentionally fails closed if a future source introduces
unsupported NUnit attributes. A hypothetical malicious checkout
that deletes all WP6 tests could be missed on that old historical
branch, but any branch retaining the WP6 suite requires exact
per-test verification. The XML is runner-generated and size-bounded;
this is a provenance *evidence gate*, not a cryptographic attestation
of a remote Editor.

## Executed verification and rollback

- Actual GitHub Unity primary artifacts for run 42582288527:
  **31/31 WP6 source tests PASS** in each of **3 Editor versions**,
  across 6 source files. Baseline 6000.3.21f1 XML reports
  **540 passed, 3 skipped**; 6000.3.28f1 and 6000.6.8f1
  each report **539 passed, 4 skipped**.
- Synthetic parser regressions **8/8 PASS** for exact source
  names, missing/renamed/duplicate/skipped/failed test cases,
  wrong method identity, summary inconsistencies, missing/
  malformed/stale/symlink/XML-entity files, unsupported NUnit
  attributes and historic branches without WP6 sources.
- Workflow structural checks, source/docs/engineering validation,
  exact-head GitHub CI required before accepting this Draft PR.
  Additional post-merge physical two-Editor WP6 tests remain separate.
- Rollback by reverting this source/workflow/testing commit:
  no runtime binary, Server socket, Scene content, persisted
  metadata, private key or user project changes.
