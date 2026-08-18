# TeamForge source guide

The experimental TeamForge source is published here for testing, review, security feedback, and contribution.

> [!IMPORTANT]
> Start with **[STATUS.md](../STATUS.md)** before treating anything in this repository as a supported release. The source is public, but a general-user packaged alpha is **not ready or recommended yet**.

If you are trying to answer a code question rather than browse the whole tree, start with **[CODEMAP.md](../CODEMAP.md)**. It maps common questions to the relevant module, entry points, source files, and tests.

## Source tree

- `unity-package/com.eunsung.teamforge/` — Unity Editor package source and Editor tests
- `server/` — coordination/session server source and tests
- `project-peer/` — project bootstrap and P2P tooling/tests
- `launcher/` — launcher source
- `scripts/` — development and validation helpers
- `unity-project/` — minimal Unity project support files used by the source tree

Generated runtime payloads, packaged executables, local credentials, private keys, and machine-specific state are intentionally not committed as canonical source.

## Module entry points

- **[Unity package README](../unity-package/com.eunsung.teamforge/README.md)** — Editor-facing realtime collaboration, Host flow, hierarchy/transfer safety and current Unity constraints
- **[Server README](../server/README.md)** — authoritative realtime/session coordinator and signed Project metadata scope
- **[Project Peer README](../project-peer/README.md)** — direct HTTP Project Transfer, Host/Guest orchestration, trust and activation contract
- **[Launcher README](../launcher/README.md)** — Windows Guest Launcher runtime integrity, trust UX and Unity handoff constraints
- **[CODEMAP.md](../CODEMAP.md)** — file-level deep links and question-to-code routing across all four modules

## What to read next

- **[STATUS.md](../STATUS.md)** — current capabilities, automated validation, release blockers, and known limitations
- **[CODEMAP.md](../CODEMAP.md)** — repository responsibilities and direct source entry points
- **[ROADMAP.md](../ROADMAP.md)** — development direction rather than current release claims
- **[SECURITY.md](../SECURITY.md)** — security expectations and vulnerability reporting
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** — testing, review, and contribution guidance
- **[architecture.md](architecture.md)** — architecture overview
- **[architecture-decisions.md](architecture-decisions.md)** — important design decisions and tradeoffs

This is an early public preview, not a production-ready release. Use backups or disposable test projects when experimenting with network, realtime-sync, or project-transfer features.
