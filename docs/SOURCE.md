# TeamForge source guide

The experimental TeamForge source is published here for testing, review, security feedback, and contribution.

> [!IMPORTANT]
> Start with **[STATUS.md](../STATUS.md)** before treating anything in this repository as a supported release. The source is public, but a general-user packaged alpha is **not ready or recommended yet**.

## Source tree

- `unity-package/com.eunsung.teamforge/` — Unity Editor package source and Editor tests
- `server/` — coordination/session server source and tests
- `project-peer/` — project bootstrap and P2P tooling/tests
- `launcher/` — launcher source
- `scripts/` — development and validation helpers
- `unity-project/` — minimal Unity project support files used by the source tree

Generated runtime payloads, packaged executables, local credentials, private keys, and machine-specific state are intentionally not committed as canonical source.

## What to read next

- **[STATUS.md](../STATUS.md)** — current capabilities, automated validation, release blockers, and known limitations
- **[ROADMAP.md](../ROADMAP.md)** — development direction rather than current release claims
- **[SECURITY.md](../SECURITY.md)** — security expectations and vulnerability reporting
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** — testing, review, and contribution guidance
- **[architecture.md](architecture.md)** — architecture overview
- **[architecture-decisions.md](architecture-decisions.md)** — important design decisions and tradeoffs

This is an early public preview, not a production-ready release. Use backups or disposable test projects when experimenting with network, realtime-sync, or project-transfer features.
