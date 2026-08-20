# Contributing to TeamForge

Thanks for being interested in helping TeamForge.

TeamForge is still experimental, and help is useful even if you do not consider yourself an expert programmer.

## Ways to help

### Testers

You can help by trying TeamForge in disposable Unity projects and reporting what breaks.

Useful testing areas include:

- connecting two or more Unity Editor instances
- repeated connect / disconnect / reconnect cycles
- transform synchronization in both directions
- object locking and ownership behavior
- conflicting edits
- host disconnects or crashes
- project bootstrap / transfer
- interrupted transfer and resume
- corrupted or mismatched project state
- confusing installation or recovery UX

Please do **not** use irreplaceable projects for experimental testing.

### Unity / C# reviewers

Useful review areas include:

- Unity Editor API usage
- lifecycle and domain reload behavior
- serialization and Scene handling
- concurrency / race conditions
- state recovery
- error handling
- performance and unnecessary Editor work

### Networking reviewers

Useful review areas include:

- WebSocket protocol behavior
- authentication and session handling
- disconnect / retry logic
- P2P transfer behavior
- integrity verification
- trust boundaries between peers
- denial-of-service or resource exhaustion risks

### Security reviewers

Security review is especially welcome around:

- path traversal
- arbitrary file read/write risks
- unsafe archive or project extraction
- authentication bypasses
- remote-code-execution risks
- untrusted peer input
- secret or credential leakage
- malicious project or package contents
- data corruption and silent overwrite scenarios

For potentially exploitable vulnerabilities, please read [SECURITY.md](SECURITY.md) before posting details publicly.

### Documentation / UX / translations

You can also help by:

- following setup instructions as a new user and reporting confusing steps
- improving explanations
- suggesting simpler workflows
- improving Korean or English documentation
- adding useful translations

## Good bug reports

A useful bug report usually includes:

1. What you were trying to do.
2. The steps you took.
3. What you expected to happen.
4. What actually happened.
5. Relevant logs, screenshots, diagnostics, or a minimal reproduction when safe to share.

Please remove private IP addresses, access tokens, passwords, invite secrets, API keys, and other credentials before posting logs publicly.

## Pull requests

Pull requests should:

- explain the problem being solved
- keep the change focused when practical
- include or update tests when the behavior can reasonably be automated
- describe important manual testing that was performed
- avoid unrelated generated files or build output
- avoid committing credentials or private information
- clearly identify behavior changes that could affect compatibility, networking, data integrity, or security

### Comments and source readability

TeamForge does **not** require a target comment percentage. A high comment count can make code harder to maintain when prose merely repeats syntax or drifts away from tested behavior.

Add comments when they preserve information that is difficult to express through names and structure alone, especially:

- authority or state-ownership boundaries
- trust/security invariants and fail-closed reasons
- lifecycle, connection-epoch, concurrency, or shutdown rules
- protocol/serialization compatibility constraints
- path, hash, identity, activation, or environment checks that may look unnecessarily strict without context

Prefer a short durable comment near the relevant boundary plus an automated test. Avoid narrating obvious control flow, duplicating large README sections inside source files, or adding comments only to satisfy a density metric.

For AI/coding-agent readability, keep [CODEMAP.md](../CODEMAP.md) and [docs/SOURCE.md](../docs/SOURCE.md) accurate when a major responsibility moves between files. The current focused comment/readability review is recorded in [docs/AI_COMMENT_AUDIT.md](../docs/AI_COMMENT_AUDIT.md).

## AI-assisted contributions are welcome

**Using AI does not make a contribution less welcome in TeamForge.** AI tools may be used for code, tests, documentation, translations, debugging, review, research, refactoring, or other parts of development.

TeamForge itself has been developed with substantial AI assistance, so contributors are not expected to hide or apologize for using similar tools.

Contributions are judged by their **correctness, safety, maintainability, testing, and usefulness** rather than by whether every line was typed manually.

However, AI assistance does not remove contributor responsibility. If you submit AI-assisted work, please:

- review the output before submitting it
- understand the important behavior and assumptions as far as reasonably possible
- test the change instead of submitting it only because it compiles
- describe meaningful testing in the pull request
- never paste credentials, private user data, private repository contents, or other secrets into an AI service without authorization
- make sure you have the right to contribute any code, text, assets, or other material included in the submission
- do not present unverified AI claims as confirmed technical facts
- expect extra scrutiny for authentication, networking, file-writing, project-transfer, deserialization, update, or other security-sensitive code

For substantial AI-generated changes, mentioning that AI was used in the pull request is encouraged for transparency, especially when it helps reviewers understand how the change was produced or verified. **AI disclosure by itself is not a reason to reject a contribution.**

Automated or agent-generated pull requests are also welcome when a human contributor is willing to own the submission, respond to review, and help verify the result.

Generated code should never be accepted solely because it looks plausible or passes a single happy-path test.

### Low-effort AI-generated submissions are not welcome

AI use is welcome; **unreviewed, low-effort AI output is not**.

TeamForge does not want contributions that are effectively a raw model response pasted into the repository with little or no human review, testing, understanding, or adaptation. This applies to code, tests, documentation, translations, issues, pull requests, security reports, and other project content.

Examples that may be rejected include:

- large generated changes with no clear problem statement or explanation
- code the submitter has not meaningfully reviewed and cannot reasonably explain
- speculative fixes submitted without reproducing or understanding the underlying problem
- generated tests that do not actually verify the behavior they claim to test
- documentation containing invented APIs, features, results, benchmarks, or other unverified claims
- bulk refactors, rewrites, formatting changes, or generated files unrelated to the stated goal
- automatically generated issues or pull requests posted in volume without useful human triage
- security-sensitive changes presented without meaningful validation
- submissions where review feedback is answered only by repeatedly regenerating content without investigating the actual problem

This is **not a requirement to write everything by hand**, and it is not intended to exclude beginners. A small AI-assisted contribution that has been carefully checked and tested is far more valuable than a huge hand-written or AI-generated change that nobody has verified.

What matters is that someone has put real effort into defining the problem, checking the result, testing important behavior, responding thoughtfully to review, and taking responsibility for the contribution.

## Licensing of contributions

By intentionally submitting a contribution for inclusion in TeamForge, you agree that your contribution may be distributed as part of TeamForge under the **GNU Affero General Public License version 3 (AGPLv3)** together with the reasonable attribution/origin terms described in [NOTICE](../NOTICE), to the extent those terms lawfully apply.

You retain credit for your own contribution. TeamForge does not ask contributors to pretend that somebody else wrote their work.

If you do not have the right to submit code or other material under these terms, please do not submit it.

## Project origin and attribution

Forks are welcome. Renaming a fork is allowed. Commercial use is not prohibited by TeamForge's chosen open-source license.

However, please preserve accurate project history. Do not remove the original TeamForge origin information and then present pre-existing TeamForge work as if a later fork author independently created it.

See [AUTHORS.md](../AUTHORS.md), [NOTICE](../NOTICE), and [LICENSE](../LICENSE) for details.

## Be constructive

Technical criticism, negative test results, and disagreement are welcome. Focus criticism on the software, design, evidence, and reproducible behavior rather than attacking contributors or users.
