# Pull request

Thanks for contributing to TeamForge.

Please keep changes focused and separate **what was planned** from **what was actually verified**. For substantial changes, use `docs/ENGINEERING_GUIDE.md` and `docs/templates/CHANGE_PLAN.md` before implementation.

## Summary

What does this change do?

## Why is this change needed?

What problem, bug, workflow issue, or roadmap area does it address?

## Risk classification

- Risk: Low / Medium / High
- Affected subsystems:
- Why this classification is appropriate:

If useful, run `npm run classify:change -- <changed paths...>` as a routing aid. Semantic risk may be higher than path-based classification.

## Invariants / failure modes

For non-trivial changes, list the important behavior that must remain true and the believable ways this change could fail.

Examples include authority/ownership, replay/revision ordering, path containment, previous-Active preservation, reconnect convergence, shutdown races, malformed input, or trust mismatch.

- Invariants:
- Failure modes considered:
- Recovery / rollback behavior:

## Testing performed

Describe what you **actually** tested. Distinguish automated tests, manual tests, field tests, and static/security analysis.

Examples:

- focused unit/integration tests
- Unity Test Runner / real-server E2E
- A/B or A/B/C synchronization/contention
- disconnect / reconnect
- project transfer / interrupted resume
- malformed / replayed / mismatched input
- chaos / property tests
- Launcher/release validation
- documentation-only validation

## Evidence still missing

What was **not** tested or cannot be claimed from the evidence above?

Examples: physical two-PC rerun, exact packaged ZIP, long-running soak, unsupported Unity patch, independent security review.

## Risk / sensitive areas

Check any areas affected by this change:

- [ ] Authentication / authorization
- [ ] Networking / WebSocket / peer input
- [ ] Project transfer / file writing / extraction
- [ ] Path / identity / signature / hash / trust checks
- [ ] Scene / serialization / asset or GUID handling
- [ ] Locking / ownership / conflict / revision handling
- [ ] Recovery / rollback / data integrity
- [ ] Launcher / Runtime / package installation / update
- [ ] Release workflow / artifact identity
- [ ] None of the above

If a sensitive area is affected, explain how the relevant fail-closed boundary is preserved.

## Documentation impact

Follow `docs/DOCUMENTATION_GUIDE.md`.

- Canonical document(s) updated:
- Documents reviewed but intentionally not changed:
- Historical evidence added or preserved:

## Release / field-gate impact

- [ ] Source-only; no packaged behavior change
- [ ] Changes packaged behavior and needs a new artifact before claiming packaged coverage
- [ ] Changes release tooling or artifact identity
- [ ] Changes compatibility/protocol/schema behavior
- [ ] Opens/closes/changes a manual or physical field gate
- [ ] No release/field-gate impact

Explain when needed:

## AI assistance

AI-assisted contributions are welcome. If substantial AI assistance was used, disclosure is encouraged when it helps reviewers understand how the change was produced or verified.

AI use does not reduce responsibility for the submission. Do not submit generated output that has not been meaningfully reviewed against the problem, invariants, and tests.

Optional notes about AI assistance:

<!-- Example: Used an AI coding assistant for initial implementation/test ideas; manually reviewed the diff and ran X/Y/Z evidence. -->

## Checklist

- [ ] I reviewed the changes I am submitting.
- [ ] For a substantial change, I planned the problem/scope/risk/evidence before treating the implementation as complete.
- [ ] I understand the important behavior and assumptions well enough to respond to review.
- [ ] I tested the change beyond merely checking that it compiles, when practical.
- [ ] I distinguished tests actually run from evidence still missing.
- [ ] I did not include credentials, private user data, private repository contents, or unrelated generated/build files.
- [ ] I added or updated tests when the behavior can reasonably be automated, or explained why not.
- [ ] I documented meaningful compatibility, networking, data-integrity, security, documentation, and release implications.
- [ ] I have the right to contribute the submitted code, text, assets, and other material under the project's contribution terms.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) for more information.
