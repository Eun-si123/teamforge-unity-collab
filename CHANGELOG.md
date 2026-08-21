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

## Engineering validation milestones

### 2026-08-21 — GitHub-hosted end-to-end validation expansion

TeamForge expanded its automated qualification beyond isolated source/unit regressions so important collaboration and recovery paths are exercised by real multi-component scenarios in GitHub Actions.

- **Real Unity authority E2E** — GitHub-hosted Unity 6000.3.21f1 now connects to a real TeamForge server and a second WebSocket peer, creates and saves a real Unity Scene/GameObject, and exercises the production Presence, Hierarchy, Transform Sync, and lock paths rather than only protocol-model helpers.
- **Real lock handoff and conflict proof** — the Unity client acquires the selected object's server lock, publishes a Transform, releases it, observes Peer B take ownership and remotely move the actual GameObject, receives a real server `lock_denied` while B owns it, then reacquires the lock and publishes another Transform after B releases it.
- **Cross-peer evidence artifacts** — the peer writes machine-checkable evidence for Unity presence, the exact runtime-selected target identity, Unity's Transform before handoff, Peer B's authoritative Transform, and Unity's Transform after reacquisition. The workflow fails if those evidence files are missing.
- **Project Transfer recovery E2E** — CI publishes and activates revision 1, intentionally interrupts revision 2 transfer after partial verified data is retained, confirms the previous Active revision remains usable, resumes the transfer, verifies already-downloaded chunks are reused instead of fetched again, activates revision 2, and confirms the older immutable Active revision is still preserved.
- **Harness hardening from real failures** — early iterations exposed CI-only assumptions including lock leases expiring while a fresh Unity environment starts, additive Scene creation from Unity's initial unsaved `Untitled` Scene, and Node 24's unsettled top-level-await behavior. The harness was corrected with active lock renewal where needed, isolated single-Scene setup, and an explicit live event-loop handle for the peer helper.
- **Final automated result** — PR #56's expanded `Unity Tests` workflow completed with both **Unity Realtime Authority E2E** and **Project Transfer Resume E2E** passing, including the separate full Unity lock-handoff evidence verification step.

This milestone strengthens repeatable automated evidence and reduces the amount of routine collaboration testing that has to be repeated by hand. It does **not** convert TeamForge's current release candidate into a field-validated release or replace the exact-candidate two-PC Windows checks that remain explicitly field-blocked.

See [PR #56](https://github.com/Eun-si123/teamforge-unity-collab/pull/56) for the implementation, debugging trail, CI checks, and generated workflow artifacts.

## Repository & AI accessibility milestones

These milestones track repository/documentation infrastructure that improves how humans, search engines, coding agents, and LLM-based tools discover and interpret TeamForge. They are intentionally separate from the Unity package version because they do not necessarily represent runtime feature changes.

### 2026-08-22 — AGENTS.md coding-agent guidance

Added a concise repository-root `AGENTS.md` that points coding agents to the current sources of truth, preserves TeamForge's protocol/security boundaries, defines the minimum validation expectations, and avoids duplicating the longer contribution or architecture documents.

This is repository/agent guidance only and does **not** change the Unity package version, runtime behavior, protocol, or release-readiness state.

### 2026-08-22 — Root layout cleanup

Moved the four Windows convenience wrappers from the repository root to `scripts/windows/`, updated the active agent and release-staging references, and left historical reports unchanged where they document the paths used at the time.

This is repository organization only and does **not** change the Unity package version, runtime behavior, protocol, or release-readiness state.

### 2026-08-20 — RSS/Atom freshness & syndication infrastructure v1.6

TeamForge added automatically generated RSS 2.0 and Atom 1.0 update feeds so feed readers, crawlers, and retrieval systems have another standards-based path to discover recent project changes without creating a second hand-maintained changelog.

- **Generated update feeds** — `feed.atom` and `feed.xml` are built during GitHub Pages generation from first-parent Git history, with up to 20 newest eligible updates.
- **Current-facing scope** — feed selection is limited to commits that touch canonical current project/release/status/discovery documents such as the README, changelog, `release-contract.json`, STATUS, known issues, roadmap, architecture, AI discovery, security policy, and Unity package changelog. Historical phase/work-state notes are intentionally excluded.
- **Commit-grounded entries** — every item links to the exact GitHub commit and records the relevant canonical source paths changed by that commit.
- **Standard autodiscovery** — the generated homepage advertises Atom and RSS through `<link rel="alternate">` metadata, exposes a visible update-feed link, and the semantic `sitemap.md` lists both feed endpoints.
- **Mechanical feed verification** — Pages validation checks RSS/Atom parity, newest-first ordering, timestamps, canonical commit URLs and SHAs, self links, and agreement with the Git-history selection logic.
- **Live endpoint coverage** — post-deploy Pages smoke tests fetch both public feed endpoints so missing or empty deployed feeds fail visibly.
- **Freshness notification** — successful `main` deployments include both feed URLs in the existing IndexNow submission set.

See [PR #51](https://github.com/Eun-si123/teamforge-unity-collab/pull/51) for the implementation and final validation record.

This is search/discovery/freshness infrastructure work and does **not** change the Unity package version, runtime behavior, protocol, or release-readiness state.

### 2026-08-19 — Repository privacy and commit-verification cleanup

TeamForge's public Git history was rewritten to remove machine-local/private metadata while preserving the current source contents and project history.

- **Commit-email privacy** — historical personal commit-email metadata was replaced with the GitHub noreply identity `267835237+Eun-si123@users.noreply.github.com`.
- **Machine-local path redaction** — Windows user-profile paths embedded in historical test fixtures and published WP5.1 archives were replaced with generic same-length `C:\Users\Dev\...` fixtures where required to preserve path-length test semantics.
- **History rewrite** — affected commits were recreated, which changed their commit SHAs. Commit authors, source trees, messages and original dates were preserved; the signing committer was normalized to the current GitHub noreply identity.
- **SSH commit verification** — the rewritten reachable history was signed with the project's registered SSH signing key and verified by GitHub.
- **Full ref audit** — at migration completion, all 110 commits reachable from `main` and the published TeamForge tags passed GitHub signature verification, with no Gmail metadata remaining in the audited reachable history.
- **Tag migration** — `TeamForge`, `v0.5.1-prealpha-wp5.1`, and `v0.5.1-wp5` were retargeted to their corresponding privacy-clean, Verified commits without changing the source trees represented by those tags.
- **Temporary infrastructure removed** — one-shot signing, auditing, and staging branches/workflows used for the migration were removed after verification.
- **Release status unchanged** — this maintenance operation does not change TeamForge's package version, runtime feature set, or WP5.1 validation status.

Because Git commit IDs include commit metadata and signatures, old commit SHAs from before this migration are no longer the canonical repository-history identifiers.

See [#47](https://github.com/Eun-si123/teamforge-unity-collab/issues/47) for the final migration audit.

### 2026-08-18 — Homepage search-intent infrastructure v1.5

TeamForge tightened the normal homepage so the most prominent visible text states the project's actual search topic while preserving the original project slogan.

- **Topic-first H1** — the built homepage now uses `Real-time collaboration for the Unity Editor` as its single primary heading instead of using the slogan as the H1.
- **Slogan preserved** — `Build together. Stay in sync.` remains visible at the start of the lead copy, so the branding is retained without making crawlers infer the page topic from a generic slogan.
- **Title alignment** — the built HTML title and Open Graph title use consistent `real-time collaboration` / `the Unity Editor` wording.
- **HTML-first current-doc links** — homepage links for current status, development history, and the security policy prefer the generated `/status/`, `/changelog/`, and `/security/` HTML routes, which still point readers back to canonical repository sources.
- **Build-time guardrails** — the site verifier requires exactly one topic-first H1, the visible slogan, the aligned title, and crawlable HTML documentation links so a future copy edit cannot silently undo this search-facing structure.

This is search/discovery/presentation infrastructure work and does **not** change the Unity package version.

### 2026-08-18 — Sitemap freshness infrastructure v1.4

TeamForge tightened the XML sitemap so crawler-facing freshness metadata reflects canonical source history instead of treating every deployment as if every document changed.

- **Generated HTML coverage** — `/status/`, `/architecture/`, `/source/`, `/changelog/`, and `/security/` are now first-class XML sitemap entries alongside the existing text/JSON resources.
- **Source-aware `lastmod`** — stable documentation routes derive their date from the newest Git commit that changed the canonical source document(s); generated snapshot-wide resources such as the homepage, `project.json`, repository manifest, and semantic sitemap use the current source commit date.
- **Ignored priority hints removed** — the sitemap no longer emits `<priority>` values, keeping the file focused on location and trustworthy modification dates.
- **Full-history Pages checkout** — the Pages build checks out repository history so per-document commit dates can be calculated correctly rather than collapsing to a shallow-clone boundary.
- **Mechanical sitemap validation** — CI parses the XML, rejects duplicate/out-of-scope URLs and `<priority>` output, validates ISO dates, requires all five HTML documentation routes, checks generated targets, and confirms HTML/text routes sharing one canonical source also share one `lastmod`.
- **Live HTML smoke coverage** — the post-deploy Pages smoke test now fetches the five generated HTML documentation routes as well as the existing agent/search endpoints.

This is search/discovery/documentation infrastructure work and does **not** change the Unity package version.

### 2026-08-18 — Search/HTML documentation infrastructure v1.3

TeamForge added generated human-readable HTML documentation routes so search engines and AI clients that can fetch ordinary webpages but cannot reliably retrieve GitHub raw/API, JSON, or plain-text resources have a stronger fallback path.

- **Five generated HTML docs** — `/status/`, `/architecture/`, `/source/`, `/changelog/`, and `/security/` are rendered automatically from the same canonical repository documents that already feed the plain-text mirrors.
- **No second hand-maintained truth** — the HTML pages are build outputs, not manually duplicated documentation; current status, architecture, source guidance, history, and security claims remain maintained in their repository source files.
- **Search-facing metadata** — each page carries a distinct title, description, canonical URL, `index,follow`, Open Graph metadata, a plain-text alternate link, and `TechArticle` JSON-LD tied back to the TeamForge source repository.
- **Ordinary internal discovery** — the homepage and semantic sitemap now link the HTML documentation alongside the existing machine-readable resources so HTML-only crawlers and assistants can follow normal links.
- **Structured route discovery** — generated `project.json.documentation` gains HTML routes for the five pages while preserving the existing text/JSON routes.
- **Build verification** — `scripts/verify-agent-site.py` requires the HTML outputs, handles project-site trailing-slash URLs, checks their search markup, and verifies internal TeamForge links.
- **Small renderer, no new package dependency** — `scripts/render_doc_pages.py` handles the Markdown subset used by these documents without adding a network-time package install to the Pages build.

This is search/discovery/documentation infrastructure work and does **not** change the Unity package version.

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
- **Reduced metadata duplication** — visible HTML and JSON-LD now consume status/runtime/license/project facts from generated `project.json`; package version, Unity compatibility and license come from package metadata, while lifecycle status is parsed from `docs/STATUS.md`.
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
- **[Project status](docs/STATUS.md)** — what is currently implemented, validated, limited or field-blocked.
- **[Roadmap](docs/ROADMAP.md)** — planned direction rather than historical fact.

Some files under `docs/work-state/` were originally written as internal working notes. They may be rough, highly technical, partially superseded, or describe experiments that were later changed. They are kept visible because they provide useful context for how bugs, design changes and stabilization work happened over time.

## About historical source/build snapshots

Older TeamForge source/build snapshots from earlier development stages may exist outside the current supported source tree. They are not presented here as supported releases because old snapshots can be incomplete, obsolete, incompatible with the current workflow, or contain bugs that were fixed later.

If there is genuine interest in a particular historical version for comparison, research or project-history purposes, selected snapshots can be reviewed and, where appropriate, published later as clearly marked **unsupported archival releases**.
