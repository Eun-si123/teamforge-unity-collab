# TeamForge Security Policy

TeamForge is experimental software. It is not yet appropriate for use as the only copy of an important Unity project. For the current validation and release-readiness snapshot, see **[STATUS.md](../docs/STATUS.md)**.

## Open source is not the same as safe

TeamForge uses a strong copyleft license partly because source availability makes independent inspection possible.

That does **not** mean that every build, fork, modification, or current source snapshot is safe.

A third-party fork can change the code. A malicious or careless fork could introduce vulnerabilities, data loss, credential theft, unwanted network behavior, or other harmful changes even when its source is available.

When possible:

- obtain TeamForge from the official project repository or a source you trust
- review important changes before running unfamiliar forks
- prefer reproducible or verifiable builds when they become available
- compare source, release notes, commit history, and hashes when practical
- use backups and disposable projects for experimental versions
- never assume that a fork is official just because it uses the TeamForge code or a similar name

The AGPLv3 and TeamForge's attribution/origin notice are intended to make modified source and project origin easier to inspect. They are **not a malware scanner, security audit, signature system, or guarantee of trustworthy behavior**.

## Automated scanning is not an audit

The repository uses automated security tooling such as secret/push protection, dependency alerts, and code scanning. These tools are useful for catching classes of mistakes, but a clean automated scan does **not** prove that TeamForge is free of vulnerabilities.

In particular, static-analysis coverage can vary by language and build environment. The project should continue to improve Unity-aware C# analysis and seek independent review as it matures.

## High-impact areas

Security reports are especially useful for issues involving:

- remote code execution
- arbitrary command execution
- arbitrary file read or write
- path traversal
- malicious archive / project extraction
- authentication or authorization bypass
- P2P trust-boundary failures
- forged or replayed session messages
- integrity-check bypasses
- secret, token, password, or credential exposure
- unsafe handling of untrusted Unity packages or project files
- silent project corruption or destructive overwrite
- denial-of-service or resource-exhaustion vulnerabilities

## Reporting a vulnerability

**Prefer GitHub Private Vulnerability Reporting for sensitive TeamForge security findings.** This lets the maintainer investigate a potentially serious issue without requiring working exploit details to be posted publicly first.

Please avoid publishing working exploit details, secrets, private data, or detailed weaponization steps for a serious vulnerability before there has been a reasonable chance to investigate and fix it.

For ordinary non-sensitive bugs, use a normal GitHub issue.

If Private Vulnerability Reporting is temporarily unavailable, a minimal public issue may state that a potentially sensitive security problem was found **without** posting exploit code, secrets, private data, or detailed weaponization steps. A safer channel can then be arranged.

## Safe research expectations

Only test TeamForge against systems, accounts, projects, networks, and peers that you own or have explicit permission to test.

Do not use security testing as a reason to access somebody else's data, credentials, computer, project, or network without authorization.

## Current maturity

TeamForge has **not** completed a professional independent security audit. Treat early builds as potentially unsafe, keep backups, and prefer disposable projects when evaluating network or project-transfer behavior.
