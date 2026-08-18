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

### 2026-08-18 — Search freshness infrastructure v1.2

TeamForge added proactive IndexNow notification so search engines that support the protocol can learn about freshly deployed public project state without waiting only for periodic recrawling.

- **Project-path ownership verification** — a public IndexNow key file is deployed inside the TeamForge GitHub Pages project path and referenced through `keyLocation`, matching IndexNow's supported subpath-verification model for hosts where TeamForge does not control the host root.
- **Deployment-gated notification** — `.github/workflows/indexnow.yml` runs only after the Pages workflow succeeds for a push to `main`, so pull-request validation and failed deployments do not generate search notifications.
- **Live key verification before submission** — the notification workflow fetches the deployed key file and verifies its contents before calling IndexNow.
- **Small freshness set** — the homepage, `project.json`, and `repository-manifest.json` are submitted because they carry current source identity and are rebuilt after each successful Pages deployment.
- **Protocol-aware response handling** — HTTP `200` is treated as accepted; HTTP `202` is treated as received with key validation pending; other response codes fail the notification job so problems remain visible.
- **Non-guarantee kept explicit** — IndexNow can prioritize discovery of changed URLs, but it does not guarantee crawl, indexing, ranking, or immediate refresh in Bing or another participating search engine.

This is search/discovery infrastructure work and does **not** change the Unity package version.

### 2026-08-18 — Agent-readable repository infrastructure v1.1

The first agent-readable layer was hardened so discovery coverage and public deployment freshness can be checked mechanically instead of relying only on hand-maintained indexes.

- **Complete tracked-file inventory** — generated `repository-manifest.json` now lists every git-tracked repository path with exact blob SHA, size, category, text-candidate flag, and source-commit-pinned GitHub URL.
- **Repository-wide freshness** — the Pages validation workflow now runs for every pull request and every `main` push because any tracked-file change can affect the repository manifest and site `sourceCommit`.
- **Discovery drift checks** — `scripts/verify-agent-site.py` compares the generated manifest with `git ls-files`, rejects duplicate/missing paths, checks source-commit agreement, and verifies generated internal targets referenced by project metadata, HTML, and `sitemap.md`.
- **Live post-deploy verification** — important public Pages endpoints are fetched after deployment with retries, and the deployed `project.json.sourceCommit` must equal the commit that GitHub Actions just deployed.
- **Reduced metadata duplication** — visible HTML and JSON-LD now consume status/runtime/license/project facts from generated `project.json`; package version, Unity compatibility and license come from package metadata, while lifecycle status is parsed from `STATUS.md`.
- **Broader clean-text access** — current Korean overview/status/roadmap plus contribution, support, conduct, author and notice documents are included as generated text mirrors.
- **Curated vs exhaustive separation** — `llms-full.txt`, `llms.txt`, and sitemaps remain task-oriented/current-context resources, while the repository manifest provides exhaustive discovery without duplicating the entire source/history tree into the website.

This is repository/search/agent infrastructure work and does **not** change the Unity package version.

### 2026-08-18 — Agent-readable repository infrastructure v1

TeamForge added a multi-path AI/search discovery layer so different classes of tools can reach the same canonical project facts without depending on one retrieval mechanism.

- **Development-history access** — added the root development-history entry point and website history navigation so version milestones, phase notes, work-state records, architecture decisions, and archival context are easier to discover. ([PR #16](https://github.com/Eun-si123/teamforge-unity-collab/pull/16), [PR #17](https://github.com/Eun-si123/teamforge-unity-collab/pull/17))
- **Agent-readable endpoints** — added the repository-root `llms.txt` discovery index and generated GitHub Pages representations such as `project.json`, `llms-full.txt`, `status.txt`, `changelog.txt`, phase/work-state indexes, and other plain-text mirrors. ([PR #18](https://github.com/Eun-si123/teamforge-unity-collab/pull/18), [PR #19](https://github.com/Eun-si123/teamforge-unity-collab/pull/19))
- **Question-to-code navigation** — added `CODEMAP.md`, direct module/file routing, canonicality rules, and deeper source/module links for coding agents. ([PR #20](https://github.com/Eun-si123/teamforge-unity-collab/pull/20))
- **Per-file LLM reading guidance** — expanded `docs/SOURCE.md` with file-purpose, caution, and next-read guidance; added `docs/AI_COMMENT_AUDIT.md` and an invariant-focused source-comment policy instead of a numeric comment-density target. ([PR #21](https://github.com/Eun-si123/teamforge-unity-collab/pull/21))
- **Search-grounded AI fallback** — added visible current project facts to the normal website, generated `SoftwareSourceCode` JSON-LD, alternate machine-readable links, semantic `sitemap.md`, source-commit freshness metadata, and documented the multi-path discovery strategy in `docs/AI_DISCOVERY.md`. ([PR #22](https://github.com/Eun-si123/teamforge-unity-collab/pull/22))
- **Automatic propagation** — GitHub Actions derives machine-readable/search-facing artifacts from canonical repository files, validates them during pull requests, and deploys the generated Pages outputs after changes reach `main`.

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
