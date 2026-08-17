# TeamForge Security Policy

TeamForge is experimental software. It is not yet appropriate for use as the only copy of an important Unity project.

## Open source is not the same as safe

TeamForge uses a strong copyleft license partly because source availability makes independent inspection possible.

That does **not** mean that every build, fork, or modification is safe.

A third-party fork can change the code. A malicious or careless fork could introduce vulnerabilities, data loss, credential theft, unwanted network behavior, or other harmful changes even when its source is available.

When possible:

- obtain TeamForge from the official project repository or a source you trust
- review important changes before running unfamiliar forks
- prefer reproducible or verifiable builds when they become available
- compare source, release notes, commit history, and hashes when practical
- use backups and disposable projects for experimental versions
- never assume that a fork is official just because it uses the TeamForge code or a similar name

The AGPLv3 and TeamForge's attribution/origin notice are intended to make modified source and project origin easier to inspect. They are **not a malware scanner, security audit, signature system, or guarantee of trustworthy behavior**.

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

Please avoid publishing working exploit details for a serious vulnerability before there is a reasonable chance to investigate and fix it.

If GitHub Private Vulnerability Reporting is available for this repository, prefer that mechanism for sensitive reports.

If no private reporting channel is available, you may open a minimal public issue stating that you found a potentially sensitive security problem **without posting exploit code, secrets, private data, or detailed weaponization steps**. A private contact method can then be arranged before sharing the sensitive details.

For ordinary non-sensitive bugs, use a normal GitHub issue.

## Safe research expectations

Only test TeamForge against systems, accounts, projects, networks, and peers that you own or have explicit permission to test.

Do not use security testing as a reason to access somebody else's data, credentials, computer, project, or network without authorization.

## Current maturity

TeamForge has not been represented as having completed a professional independent security audit. Treat all early builds as potentially unsafe and keep backups.