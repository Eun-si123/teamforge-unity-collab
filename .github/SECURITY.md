# TeamForge Security Policy

TeamForge is experimental software. It is not yet appropriate for use as the only copy of an important Unity project.

For current capability and release-readiness state, see **[STATUS.md](../docs/STATUS.md)**. For exact runtime/protocol/release selections, see [`release-contract.json`](../release-contract.json). For packaged artifact identity, see [`builds/README.md`](../builds/README.md).

## Supported versions / security-fix scope

TeamForge is still in an early pre-alpha stage, so security support follows the **current source and explicitly current packaged candidate lineage**, not every historical build.

| Surface | Security-fix expectation |
| --- | --- |
| Current `main` source | Best-effort fixes and review while the project is actively developed |
| Current explicitly identified pre-alpha candidate | Best-effort investigation; check [STATUS.md](../docs/STATUS.md) before assuming a fix is packaged |
| Superseded / historical TeamForge builds | Not supported as current secure distributions; upgrade/retest against current source/candidate |
| Third-party forks | Maintained and trusted according to their own authors/operators; TeamForge cannot guarantee them |

Because source and packaged candidates can differ during stabilization, do not assume that a source fix is present in an older ZIP. Use the exact artifact filename and SHA-256 when reporting a packaged vulnerability.

## Open source is not the same as safe

Source availability makes independent inspection possible, but it does **not** mean that every build, fork, modification, or source snapshot is safe.

A third-party fork can change the code. A malicious or careless fork could introduce vulnerabilities, data loss, credential theft, unwanted network behavior, or other harmful changes even when its source is available.

When possible:

- obtain TeamForge from the official project repository or another source you trust;
- review important changes before running unfamiliar forks;
- compare source, release notes, commit history and hashes when practical;
- keep backups and prefer disposable projects for experimental versions;
- never assume a fork is official merely because it uses TeamForge code or a similar name.

The AGPLv3 and TeamForge attribution/origin notices help make modified source and project origin inspectable. They are **not** a malware scanner, security audit, signature system, or guarantee of trustworthy behavior.

## Automated scanning is not an audit

Repository security automation such as dependency, secret and code scanning is useful for catching classes of mistakes, but a clean automated result does **not** prove that TeamForge is vulnerability-free.

Static-analysis coverage varies by language and build environment. Unity/C# behavior, networking state machines, filesystem/path handling, packaging, and trust/activation logic still require targeted review and testing.

## High-impact areas

Security reports are especially useful for issues involving:

- remote or arbitrary code/command execution;
- arbitrary file read/write;
- path traversal or unsafe reparse/symlink handling;
- malicious archive / Project extraction;
- authentication or authorization bypass;
- P2P trust-boundary failures;
- forged/replayed session or Project metadata;
- integrity-check bypasses;
- secret/token/password/credential exposure;
- unsafe handling of untrusted Unity packages or project files;
- silent Project corruption or destructive overwrite;
- denial-of-service / resource exhaustion.

## Reporting a vulnerability

**Prefer GitHub Private Vulnerability Reporting for sensitive TeamForge findings when it is available on the repository.** Use the repository's **Security → Report a vulnerability** flow rather than publishing working exploit details first.

When safe to share, include enough identity information to reproduce the affected code/build precisely:

- source testing: Git commit or branch/ref;
- packaged testing: product version, release ID, exact artifact filename and SHA-256 when available;
- Unity Editor and operating-system/environment details that materially affect the issue;
- a minimal reproduction or logs with secrets/private data removed.

Product version alone does not prove that two packaged builds contain identical bytes.

Please do **not** publish credentials, private data, live invite/access secrets, or detailed weaponization for a serious vulnerability before there has been a reasonable chance to investigate and fix it.

For ordinary non-sensitive bugs, use a normal GitHub Issue.

If Private Vulnerability Reporting is unavailable, a minimal public Issue may state that a potentially sensitive security problem was found **without** exploit code, secrets, private data, or detailed weaponization. Arrange a safer channel before sharing sensitive details.

## Safe research expectations

Only test TeamForge against systems, accounts, projects, networks and peers that you own or have explicit permission to test.

Do not use security testing as a reason to access another person's data, credentials, computer, project or network without authorization.

## Current maturity

TeamForge has **not** completed a professional independent security audit. Treat early builds as potentially unsafe, keep backups, prefer disposable projects, and check [STATUS.md](../docs/STATUS.md) before assuming a current source fix has been packaged or field-validated.
