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

## Repository & AI accessibility milestones

These milestones track repository/documentation infrastructure that improves how humans, search engines, coding agents, and LLM-based tools discover and interpret TeamForge. They are intentionally separate from the Unity package version because they do not necessarily represent runtime feature changes.

### 2026-08-18 — Agent-readable repository infrastructure v1

TeamForge added a multi-path AI/search discovery layer so different classes of tools can reach the same canonical project facts without depending on one retrieval mechanism.

- **Development-history access** — added the root development-history entry point and website history navigation so version milestones, phase notes, work-state records, architecture decisions, and archival context are easier to discover. ([PR #16](https://github.com/Eun-si123/teamforge-unity-collab/pull/16), [PR #17](https://github.com/Eun-si123/teamforge-unity-collab/pull/17))
- **Agent-readable endpoints** — added the repository-root `llms.txt` discovery index and generated GitHub Pages representations such as `project.json`, `llms-full.txt`, `status.txt`, `changelog.txt`, phase/work-state indexes, and other plain-text mirrors. ([PR #18](https://github.com/Eun-si123/teamforge-unity-collab/pull/18), [PR #19](https://github.com/Eun-si123/teamforge-unity-collab/pull/19))
- **Question-to-code navigation** — added `CODEMAP.md`, direct module/file routing, canonicality rules, and deeper source/module links for coding agents. ([PR #20](https://github.com/Eun-si123/teamforge-unity-collab/pull/20))
- **Per-file LLM reading guidance** — expanded `docs/SOURCE.md` with file-purpose, caution, and next-read guidance; added `docs/AI_COMMENT_AUDIT.md` and an invariant-focused source-comment policy instead of a numeric comment-density target. ([PR #21](https://github.com/Eun-si123/teamforge-unity-collab/pull/21))
- **Search-grounded AI fallback** — added visible current project facts to the normal website, generated `SoftwareSourceCode` JSON-LD, alternate machine-readable links, semantic `sitemap.md`, source-commit freshness metadata, and documented the multi-path discovery strategy in `docs/AI_DISCOVERY.md`. ([PR #22](https://github.com/Eun-si123/teamforge-unity-collab/pull/22))
- **Automatic propagation** — GitHub Actions now derives machine-readable/search-facing artifacts from canonical repository files, validates them during pull requests, and deploys the generated Pages outputs after changes reach `main`.

The resulting access model intentionally supports several paths in parallel: search-indexed assistants can use the normal visible website and structured metadata; direct-fetch clients can use plain-text/JSON resources; repository-aware coding agents can follow `llms.txt` → `CODEMAP.md` → `docs/SOURCE.md` → source/tests. A future MCP layer can add live runtime resources/tools without replacing these static discovery paths.

This infrastructure milestone does **not** change the Unity package version by itself; the package remains versioned according to runtime/release changes in `unity-package/com.eunsung.teamforge/CHANGELOG.md`.

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
