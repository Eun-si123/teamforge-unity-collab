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

When source contributions become available publicly, pull requests should:

- explain the problem being solved
- keep the change focused when practical
- include or update tests when the behavior can reasonably be automated
- describe important manual testing that was performed
- avoid unrelated generated files or build output
- avoid committing credentials or private information
- clearly identify behavior changes that could affect compatibility, networking, data integrity, or security

AI-assisted contributions are allowed, but **the contributor is still responsible for reviewing, understanding as far as reasonably possible, and testing what they submit**. Do not submit generated code solely because it compiles.

## Licensing of contributions

By intentionally submitting a contribution for inclusion in TeamForge, you agree that your contribution may be distributed as part of TeamForge under the **GNU Affero General Public License version 3 (AGPLv3)** together with the reasonable attribution/origin terms described in [NOTICE](NOTICE), to the extent those terms lawfully apply.

You retain credit for your own contribution. TeamForge does not ask contributors to pretend that somebody else wrote their work.

If you do not have the right to submit code or other material under these terms, please do not submit it.

## Project origin and attribution

Forks are welcome. Renaming a fork is allowed. Commercial use is not prohibited by TeamForge's chosen open-source license.

However, please preserve accurate project history. Do not remove the original TeamForge origin information and then present pre-existing TeamForge work as if a later fork author independently created it.

See [AUTHORS.md](AUTHORS.md), [NOTICE](NOTICE), and [LICENSE](LICENSE) for details.

## Be constructive

Technical criticism, negative test results, and disagreement are welcome. Focus criticism on the software, design, evidence, and reproducible behavior rather than attacking contributors or users.