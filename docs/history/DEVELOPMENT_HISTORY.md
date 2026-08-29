# TeamForge development history

This page preserves the detailed engineering and repository-history material that previously lived in the root `CHANGELOG.md`.

For user-facing version changes, see **[../../CHANGELOG.md](../../CHANGELOG.md)**. For the detailed Unity package changelog, see **[../../unity-package/com.eunsung.teamforge/CHANGELOG.md](../../unity-package/com.eunsung.teamforge/CHANGELOG.md)**.

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

The package changelog records intermediate UX passes and hotfixes between these version milestones.

## Engineering validation milestones

### 2026-08-30 — Documentation/engineering workflow and operability integration

PR #103 consolidated a broad repository-quality pass into `main` while keeping physical field evidence separate from automation claims.

- introduced canonical documentation ownership, documentation planning/templates, and automated documentation-governance checks;
- added paired `HOW_IT_WORKS` guides between the product README and low-level architecture/CODEMAP layers;
- added the Engineering Guide, Change Plan, machine-readable quality gates, and path-based change classification;
- added Test Lab as a thin named-scenario orchestration layer over existing tests rather than a duplicate assertion framework;
- added a manual Windows Launcher **Save support bundle** path with bounded/redacted local output and a dedicated .NET privacy/safety contract;
- generalized active release-tool entry points away from work-package-specific names while retaining legacy implementations as compatibility internals;
- expanded release/provenance and repository validation without claiming that CI closes physical two-PC field debt;
- final pre-merge validation passed normal CI, Engineering Quality Gate, Dependency Review, Pages, Authority Chaos Stress, Windows Launcher build/diagnostics tests, and the Unity realtime-authority, lock-contention, transfer-resume, and realtime-authority-chaos E2E lanes.

A post-merge integration audit then found an important maintenance lesson: several discovery surfaces still described the older documentation architecture, and STATUS/build classification initially described post-r4 work as repository-only even though the Launcher support-bundle path was a real behavior change. The audit therefore tightened source-versus-package wording and added explicit canonical-document propagation checks across README language pairs, `llms.txt`, Pages/project metadata, sitemap/search outputs, agent guidance, CODEMAP/SOURCE routes, and documentation validators.

The latest published r4 ZIP remains immutable and continues to represent the exact source snapshot from which it was built. Later source tests and the post-r4 support-bundle behavior do not retroactively become r4 package evidence.

See [PR #103](https://github.com/Eun-si123/teamforge-unity-collab/pull/103) for the integrated change set. Current readiness and source/package identity boundaries remain owned by [STATUS.md](../STATUS.md) and [`../../builds/README.md`](../../builds/README.md).

### 2026-08-21 — GitHub-hosted end-to-end validation expansion

TeamForge expanded its automated qualification beyond isolated source/unit regressions so important collaboration and recovery paths are exercised by real multi-component scenarios in GitHub Actions.

- **Real Unity authority E2E** — GitHub-hosted Unity 6000.3.21f1 connects to a real TeamForge server and a second WebSocket peer, creates and saves a real Unity Scene/GameObject, and exercises production Presence, Hierarchy, Transform Sync, and lock paths rather than only protocol-model helpers.
- **Real lock handoff and conflict proof** — the Unity client acquires the selected object's server lock, publishes a Transform, releases it, observes Peer B take ownership and remotely move the actual GameObject, receives a real server `lock_denied` while B owns it, then reacquires the lock and publishes another Transform after B releases it.
- **Cross-peer evidence artifacts** — the peer writes machine-checkable evidence for Unity presence, the runtime-selected target identity, Unity's Transform before handoff, Peer B's authoritative Transform, and Unity's Transform after reacquisition.
- **Project Transfer recovery E2E** — CI publishes and activates revision 1, interrupts revision 2 transfer after partial verified data is retained, confirms the previous Active revision remains usable, resumes, verifies already-downloaded chunks are reused, activates revision 2, and confirms the older immutable Active revision remains preserved.
- **Harness hardening from real failures** — early iterations exposed CI-only assumptions including lock leases expiring during fresh Unity startup, additive Scene creation from Unity's initial unsaved `Untitled` Scene, and Node top-level-await/event-loop behavior. The harness was corrected with active lock renewal, isolated single-Scene setup, and an explicit live event-loop handle for the peer helper.
- **Final automated result** — PR #56's expanded `Unity Tests` workflow completed with Unity Realtime Authority E2E and Project Transfer Resume E2E passing, including the separate full Unity lock-handoff evidence verification step.

This milestone strengthened repeatable automated evidence but did not replace exact-candidate physical two-PC Windows validation.

See [PR #56](https://github.com/Eun-si123/teamforge-unity-collab/pull/56) for the implementation, debugging trail, CI checks, and generated workflow artifacts.

## Repository & AI accessibility milestones

These milestones track repository/documentation infrastructure that improves how humans, search engines, coding agents, and LLM-based tools discover and interpret TeamForge. They do not necessarily represent runtime feature changes.

### 2026-08-30 — Canonical-document propagation hardening

Following the documentation/operability merge, TeamForge expanded its discovery graph so current canonical guides are propagated intentionally rather than merely existing somewhere in the tree.

- HOW_IT_WORKS, Test Lab, Engineering Guide, and Documentation Guide are routed through the repository map, `llms.txt`, clean Pages mirrors, `project.json`, curated AI context, sitemap generation, and generated HTML where appropriate;
- Korean README navigation was reconciled with the English entry path;
- SOURCE remains the checkout/build/validation guide while CODEMAP owns question-to-code routing;
- documentation governance now classifies user/current, contributor/maintainer, and historical/evidence propagation surfaces;
- CI checks stale role labels, missing canonical-document routes, source/package divergence, and generated discovery targets.

### 2026-08-22 — AGENTS.md coding-agent guidance

Added a concise repository-root `AGENTS.md` that points coding agents to current sources of truth, preserves protocol/security boundaries, defines minimum validation expectations, and avoids duplicating the longer contribution or architecture documents.

### 2026-08-22 — Root layout cleanup

Moved Windows convenience wrappers from the repository root to `scripts/windows/`, updated active agent/release-staging references, and left historical reports unchanged where they document paths used at the time.

### 2026-08-22 — Repository maintainability baseline

Adopted `.editorconfig` and `.gitattributes` for cross-platform text/binary consistency, `docs/README.md` and `scripts/README.md` as focused navigation entry points, grouped weekly Dependabot updates for Server, Project Peer and GitHub Actions, and agent guidance linking to the documentation map.

### 2026-08-22 — GitHub Actions maintenance guardrails

Added a dependency-free workflow policy check and wired it into root tests and CI. It requires explicit top-level workflow permissions, rejects `write-all` and `pull_request_target`, and requires external Actions or Docker actions to use immutable commit SHA/digest references.

### 2026-08-20 — RSS/Atom freshness & syndication infrastructure v1.6

TeamForge added automatically generated RSS 2.0 and Atom 1.0 update feeds so feed readers, crawlers, and retrieval systems have another standards-based path to discover recent project changes without creating a second hand-maintained changelog.

- generated `feed.atom` and `feed.xml` from first-parent Git history;
- limited feed selection to current-facing canonical project/release/status/discovery documents;
- linked every entry to the exact GitHub commit and relevant canonical paths;
- added standard RSS/Atom autodiscovery metadata;
- mechanically validated parity, ordering, timestamps, canonical URLs and source-commit agreement;
- added live post-deploy endpoint checks and IndexNow notification coverage.

See [PR #51](https://github.com/Eun-si123/teamforge-unity-collab/pull/51) for the implementation and final validation record.

### 2026-08-19 — Repository privacy and commit-verification cleanup

TeamForge's public Git history was rewritten to remove machine-local/private metadata while preserving current source contents and project history.

- historical personal commit-email metadata was replaced with a GitHub noreply identity;
- machine-local Windows user-profile paths in test fixtures/artifacts were replaced with generic same-length fixtures where required to preserve path-length semantics;
- affected commits were recreated, changing commit SHAs while preserving authors, source trees, messages and original dates;
- rewritten reachable history was SSH-signed and verified by GitHub;
- TeamForge tags were retargeted to the corresponding privacy-clean Verified commits;
- temporary migration infrastructure was removed after verification.

See [#47](https://github.com/Eun-si123/teamforge-unity-collab/issues/47) for the final migration audit.

### 2026-08-18 — Homepage search-intent infrastructure v1.5

TeamForge tightened the normal homepage so prominent visible text states the project's actual search topic while preserving the project slogan.

- topic-first `Real-time collaboration for the Unity Editor` H1;
- slogan retained in lead copy;
- title/Open Graph wording aligned;
- current-doc links prefer generated HTML documentation routes;
- build-time guardrails verify the search-facing structure.

### 2026-08-18 — Sitemap freshness infrastructure v1.4

TeamForge tightened XML sitemap freshness metadata so it reflects canonical source history rather than treating every deployment as if every document changed.

- generated HTML documentation routes became first-class sitemap entries;
- stable routes derive `lastmod` from source document history;
- ignored priority hints were removed;
- Pages builds use enough Git history to calculate document dates;
- sitemap structure and live routes are mechanically verified.

### 2026-08-18 — Search/HTML documentation infrastructure v1.3

TeamForge added generated human-readable HTML documentation routes so search engines and AI clients that can fetch ordinary webpages have a fallback to repository/API/plain-text access.

- `/status/`, `/architecture/`, `/source/`, `/changelog/`, and `/security/` were the initial generated canonical-document routes;
- generated pages are build outputs, not a second hand-maintained truth;
- pages include search-facing metadata and canonical links;
- homepage/sitemap/project metadata expose the generated routes;
- build verification checks generated outputs and internal links.

The route set later expanded as HOW_IT_WORKS and contributor/maintainer canonical guides became first-class documentation layers.

### 2026-08-18 — Search freshness infrastructure v1.2

TeamForge added IndexNow notification after successful Pages deployment.

- project-path ownership verification through a deployed key;
- deployment-gated notification only after successful `main` Pages deploys;
- live key verification before submission;
- a small freshness set rather than submitting every URL;
- protocol-aware handling of accepted/pending responses;
- explicit acknowledgement that IndexNow does not guarantee crawl, indexing or ranking.

### 2026-08-18 — Agent-readable repository infrastructure v1.1

The first agent-readable layer was hardened so discovery coverage and public deployment freshness can be checked mechanically instead of relying only on hand-maintained indexes.

- generated `repository-manifest.json` inventories every tracked repository path with source-commit identity;
- Pages validation runs broadly enough to catch discovery drift;
- generated manifest/site data are compared with actual Git-tracked paths;
- important deployed endpoints are checked after deployment;
- visible/generated metadata consume canonical project facts rather than maintaining independent copies where possible;
- curated AI/search resources and exhaustive repository inventory remain separate concepts.

### 2026-08-18 — Agent-readable repository infrastructure v1

TeamForge added a multi-path AI/search discovery layer so different classes of tools can reach the same canonical project facts without depending on one retrieval mechanism.

- development-history navigation;
- repository-root `llms.txt` and generated machine-readable/text resources;
- `CODEMAP.md` question-to-code navigation;
- source checkout/build/validation guidance;
- search-visible project facts and structured metadata;
- generated propagation/validation through GitHub Actions.

This infrastructure did not change the Unity package version by itself; runtime/release changes remain versioned through the package/release contracts.

## Earlier development records

The repository keeps more than the version changelog. Useful historical sources include:

- **[Phase notes](../phases/)** — milestone/phase development records;
- **[Work-state notes](../work-state/)** — implementation-session, debugging, hotfix, decision and handoff notes;
- **[Architecture decisions](../architecture-decisions.md)** — design decisions and tradeoffs;
- **[Current status](../STATUS.md)** — current implementation/readiness, not history;
- **[Roadmap](../ROADMAP.md)** — planned direction, not historical fact.

Some `work-state` files were originally internal working notes. They may be rough, highly technical, partially superseded, or describe experiments later changed. They remain visible because they preserve useful design/debugging context.

## Historical source/build snapshots

Older TeamForge source/build snapshots may exist outside the current supported source tree. Old snapshots can be incomplete, obsolete or incompatible with the current workflow and should not be presented as current supported releases merely because they remain historically available.

Exact current readiness and artifact identity belong to [STATUS.md](../STATUS.md), [`../../release-contract.json`](../../release-contract.json), and [`../../builds/README.md`](../../builds/README.md).
