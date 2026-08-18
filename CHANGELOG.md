# TeamForge development history

This page is the easy entry point for TeamForge's version and engineering history.

For the detailed package changelog, see **[unity-package/com.eunsung.teamforge/CHANGELOG.md](unity-package/com.eunsung.teamforge/CHANGELOG.md)**.

## Version milestones

| Version | Milestone |
| --- | --- |
| `0.1.0` | Initial Unity Editor connection, Hello/Ping/Pong, reconnect and diagnostics foundation |
| `0.2.0` | Presence, identity, selection, Scene awareness and teammate navigation |
| `0.3.0` | Transform synchronization, server authority and basic locking |
| `0.4.0` | Project bootstrap / transfer protocol foundation and signed invite flow |
| `0.4.1` | Phase 3 stabilization, Embedded UPM coverage, transfer retry/failover and regression fixes |
| `0.5.0` | Same-Scene Hierarchy synchronization and related authority/conflict handling |
| `0.5.1` | Collaboration bootstrap, networking, release-contract and security stabilization |

The detailed changelog also records intermediate UX passes and hotfixes that happened between these version milestones.

## Earlier development records

The repository keeps more than the final changelog. If you want to see how the project evolved, including rougher implementation and debugging notes, these are useful starting points:

- **[Phase notes](docs/phases/)** — Phase 0 through Phase 4 development records.
- **[Work-state notes](docs/work-state/)** — implementation-session, debugging, hotfix, decision and handoff notes.
- **[Architecture decisions](docs/architecture-decisions.md)** — design decisions and technical tradeoffs.
- **[Project status](STATUS.md)** — what is currently implemented, validated, limited or field-blocked.
- **[Roadmap](ROADMAP.md)** — planned direction rather than historical fact.

Some files under `docs/work-state/` were originally written as internal working notes. They may be rough, highly technical, partially superseded, or describe experiments that were later changed. They are kept visible because they provide useful context for how bugs, design changes and stabilization work happened over time.

## About historical source/build snapshots

Older TeamForge source/build snapshots from earlier development stages may exist outside the current supported source tree. They are not presented here as supported releases because old snapshots can be incomplete, obsolete, incompatible with the current workflow, or contain bugs that were fixed later.

If there is genuine interest in a particular historical version for comparison, research or project-history purposes, selected snapshots can be reviewed and, where appropriate, published later as clearly marked **unsupported archival releases**.
