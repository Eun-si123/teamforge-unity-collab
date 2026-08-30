# TeamForge AI/search discovery strategy

Date: 2026-08-30

This document records why TeamForge exposes current project facts through several retrieval paths while keeping the repository as the canonical source.

## Problem being solved

Different clients see different parts of a public project:

- a repository-aware coding agent may read files directly;
- a search-grounded assistant may only see indexed HTML;
- a direct-fetch tool may prefer plain text, Markdown, or JSON;
- a crawler may discover a page through a sitemap but not understand GitHub's rendered `blob` UI;
- any of those clients may be looking at a stale index while `main` has already changed.

TeamForge also has multiple identities that must not be collapsed into one vague “latest version”:

- product version;
- release/work-package identity;
- exact source commit;
- latest published candidate;
- exact packaged filename + SHA-256.

Current source can be newer than the latest published package. For example, the current `main` source contains post-r4 Launcher support-bundle behavior that the immutable r4 ZIP does not contain. Search/discovery surfaces must preserve that source-versus-package distinction instead of making a newer source claim look like r4 package evidence.

The goal is therefore:

> make the same canonical facts reachable through human, search, agent, and machine-readable paths without creating several independently maintained truths.

## Canonical layers

The discovery system follows the repository documentation architecture instead of inventing a separate AI-only hierarchy.

| Question | Canonical source |
| --- | --- |
| What is TeamForge? | `README.md` / `README.ko.md` |
| What works now / what is blocked? | `docs/STATUS.md` |
| How does it work end to end? | `docs/HOW_IT_WORKS.md` / `.ko.md` |
| What exact runtime/protocol/release selections apply? | `release-contract.json` |
| What exact packaged bytes exist? | `builds/README.md` + GitHub Release filename/SHA-256 |
| How is the system structured? | `docs/architecture.md` |
| Where is the code? | `CODEMAP.md` |
| How do I check out/build/validate source? | `docs/SOURCE.md` |
| How should a substantial change be planned? | `docs/ENGINEERING_GUIDE.md` |
| How should documentation be maintained? | `docs/DOCUMENTATION_GUIDE.md` |
| Which named validation scenario should I run? | `docs/TEST_LAB.md` + `test-lab.json` |
| What is planned? | `docs/ROADMAP.md` |

`llms.txt`, Pages, `project.json`, sitemaps, update feeds, IndexNow, and the repository manifest are **routing/discovery/freshness surfaces** for these canonical sources. They must not silently redefine their roles.

## Retrieval layers

### 1. Ordinary crawlable HTML

The generated GitHub Pages site provides ordinary HTML for high-value current material:

- `/status/`
- `/how-it-works/`
- `/architecture/`
- `/source/`
- `/test-lab/`
- `/engineering/`
- `/documentation/`
- `/changelog/`
- `/security/`

These pages are generated from repository Markdown mirrors rather than hand-maintained separately. `/source/` is specifically the **source checkout/build/validation workflow**, not a substitute for `CODEMAP.md`.

The homepage also exposes current lifecycle/release/source identity in visible text and links users toward the current documentation layers.

### 2. Clean plain-text and Markdown mirrors

Common documents are copied to stable plain-text endpoints such as:

- `status.txt`
- `how-it-works.txt`
- `how-it-works.ko.txt`
- `codemap.txt`
- `source.txt`
- `test-lab.txt`
- `engineering-guide.txt`
- `documentation-guide.txt`
- `architecture-overview.txt`

For pages that have a generated HTML route, the Pages build also emits a clean Markdown page variant using the route-local `index.md` form, for example:

- `/index.md`
- `/status/index.md`
- `/how-it-works/index.md`
- `/architecture/index.md`
- `/ko/index.md`
- `/ko/status/index.md`
- `/ko/how-it-works/index.md`

The plain-text endpoint, HTML page, and Markdown page variant come from the same canonical source. The Markdown variants are generated outputs, not a second hand-maintained documentation tree.

### 3. Structured metadata

`project.json` exposes generated snapshot metadata and routes. It includes:

- product/release identity copied from `release-contract.json`;
- lifecycle/status summary derived from `STATUS.md`;
- exact Pages source commit;
- module roles;
- current documentation and localized-documentation routes.

Adding new documentation-route fields is additive and does not by itself require changing the current `project.json` schema version.

`release-contract.json` remains the source-controlled release/runtime/protocol contract. `project.json` is not allowed to become a second hand-maintained release contract.

### 4. Curated AI context

`llms.txt` is the small task-routing/evidence index.

`llms-full.txt` contains a curated set of current documentation. It deliberately includes HOW_IT_WORKS, architecture, SOURCE, engineering/documentation guides, Test Lab, status, security, and module guides while excluding most raw historical work-state material.

It is not a full repository dump.

### 5. Exhaustive repository inventory

`repository-manifest.json` is generated from `git ls-files` for the exact Pages source commit. It gives every tracked path its blob identity, size/category metadata, and source-commit-pinned GitHub URL.

This prevents “not part of the curated AI mirror” from being mistaken for “not in the repository.”

The manifest is a discovery fallback, not a higher-precedence source of truth.

## llms.txt v2 compatibility layer

TeamForge adopted the llms.txt v2 proposal in PR #123 as an **additive interoperability layer**, not as a replacement for the existing discovery system and not as a search-ranking mechanism.

The compatibility policy is:

- keep the root/project-path `llms.txt` readable by older clients using the long-standing H1, blockquote summary, H2 section, and Markdown-link-list shape;
- keep existing `.txt` mirrors and `llms-full.txt` available for older or simpler direct-fetch clients;
- keep `llms.txt` itself small and route agents to the smallest relevant document instead of inlining the whole repository;
- expose page-level Markdown variants as generated `index.md` files;
- advertise the `llms.txt` that describes a generated HTML page with `rel="describedby"`;
- advertise that page's Markdown representation with `rel="alternate" type="text/markdown"`;
- keep `sitemap.md` discoverable as `rel="related"` rather than incorrectly presenting it as the Markdown representation of the homepage;
- treat the v2 `Optional` heading as a normal secondary-information convention, not as a special machine-execution switch;
- use the project-path `llms.txt` as the descriptor for the GitHub Pages project subtree.

A v1-style reader can therefore continue to read the same structural core, while a v2-aware reader can discover both the descriptor and the page-specific Markdown representation without guessing URL patterns.

GitHub Pages does not currently give this build per-resource control over HTTP `Link:` response headers, so TeamForge expresses v2 discovery through standard HTML `<link>` relations. If the hosting layer changes later, equivalent HTTP `Link:` headers can be considered without removing the HTML relations.

The implementation lives in `scripts/llms_v2.py`. It generates the Markdown page variants, inserts the discovery relations, validates the strict H1/summary/H2-link-list shape, checks internal `llms.txt` targets, and supports a `--check` mode so the generated site can be verified without mutation.

This v2 layer is deliberately not treated as proof of AI/search ranking support. The ordinary crawlable HTML, canonical text, sitemaps, structured metadata, internal links, and repository sources remain independently useful even if a client ignores `llms.txt` entirely.

## Task-based routing examples

### Someone asks “how does TeamForge actually work?”

1. README for orientation.
2. HOW_IT_WORKS for Host → Guest → Project transfer → realtime edit → reconnect/recovery.
3. architecture for exact structural boundaries.
4. CODEMAP for concrete files/tests.

### Someone asks “where is this implemented?”

1. CODEMAP.
2. relevant module README.
3. source + nearest tests.
4. SOURCE only when checkout/build/validation commands are needed.

### A coding agent proposes a substantial change

1. ENGINEERING_GUIDE + CHANGE_PLAN.
2. target module/source/tests.
3. architecture/decisions when crossing authority/trust/persistence/path boundaries.
4. `quality-gates.json` / classifier for routing aid.
5. Test Lab for named validation-lane planning.

### A coding agent changes documentation

1. DOCUMENTATION_GUIDE.
2. determine the canonical owner first.
3. determine propagation class when adding/removing/renaming/reclassifying a current document.
4. review README language pair, docs map, `llms.txt`, Pages/project metadata/sitemap, feeds/IndexNow when the document is current-facing, AGENTS/CONTRIBUTING, and validators as appropriate.

This propagation step was added after the post-merge integration audit found that new canonical documents existed in the repository but several discovery surfaces still described the older documentation architecture.

## Build-time generation

The Pages workflow runs on pull requests and `main` pushes because the generated repository manifest and source commit represent the whole repository snapshot.

The build performs these broad steps:

1. copy canonical documents to clean text mirrors;
2. copy `release-contract.json` byte-for-byte;
3. build `llms-full.txt` from the curated current-document set;
4. generate `project.json` from release contract, STATUS, package metadata, and source commit;
5. generate the complete repository manifest;
6. render selected canonical documents to crawlable HTML;
7. enrich the homepage with visible current facts and structured metadata;
8. generate semantic and XML sitemaps;
9. generate RSS/Atom from a deliberately small set of current-facing canonical sources;
10. generate route-local `index.md` variants and inject `rel="describedby"` / Markdown `rel="alternate"` discovery into generated HTML;
11. apply and immediately re-check the llms.txt v2 compatibility contract;
12. verify generated routes, source identities, documentation propagation, update-feed source coverage, IndexNow freshness routing, and links;
13. on `main`, deploy and smoke-test important live endpoints.

## Validation rules

The discovery system is intentionally tested instead of relying on a checklist that maintainers remember manually.

`scripts/validate-documentation.mjs` checks repository-side propagation, including:

- paired README routing to HOW_IT_WORKS;
- current `llms.txt` routes;
- Pages mirror declarations for current canonical guides;
- current Test Lab wording;
- SOURCE/CODEMAP responsibility separation;
- post-r4 source/package divergence while it remains relevant.

`scripts/llms_v2.py` checks the v2 compatibility layer, including:

- exactly one initial H1 and a blockquote summary near the top of `llms.txt`;
- H2 file-list sections without nested H3+ headings;
- Markdown-link-only entries inside H2 resource sections;
- existence of all internal TeamForge Pages links referenced by `llms.txt`;
- exact content parity between route-local `index.md` variants and their generated source mirrors;
- `rel="describedby"` discovery on generated HTML;
- `rel="alternate" type="text/markdown"` only where a real page Markdown variant exists;
- prevention of the older ambiguous `sitemap.md`-as-page-alternate behavior.

`scripts/verify-agent-site.py` checks the built site, including:

- required HTML/text/JSON outputs;
- current documentation routes in `project.json`;
- sitemap coverage and source-aware `lastmod` consistency;
- internal generated links;
- current release-contract identity;
- exhaustive repository-manifest coverage.

`scripts/verify-update-feeds.py` checks the freshness layer, including:

- RSS/Atom parity with the selected canonical Git-history source set;
- inclusion of the paired README, STATUS, and HOW_IT_WORKS current-facing documents;
- presence of the high-value current IndexNow endpoints, including the homepage, STATUS, HOW_IT_WORKS, sitemap, structured metadata, and update feeds.

This means a newly promoted current-facing canonical guide should not silently become an orphan in retrieval **or** freshness routing again.

## Sitemap and freshness

`sitemap.xml` includes important current HTML and machine-readable resources. Stable document routes derive `lastmod` from the newest commit affecting their canonical source. Snapshot-wide generated resources use the current source commit date.

`sitemap.md` provides a semantic task-oriented map for humans and agents. It is related discovery content, not the Markdown representation of the homepage.

RSS/Atom intentionally does **not** list every documentation edit. Its source set stays small and current-facing so historical-note maintenance does not look like a new product state. The paired HOW_IT_WORKS guides are included because they are now a canonical user-facing explanation of current end-to-end behavior.

After a successful `main` Pages deployment, live smoke tests check important HTML/text/JSON endpoints and verify the deployed `project.json.sourceCommit` against the Actions commit.

## Search change notification

TeamForge uses IndexNow as a best-effort search freshness notification after successful `main` Pages deployment. It intentionally remains separate from the deploy workflow so notification failure does not invalidate an otherwise correct site.

The notification set remains deliberately small, but includes the main search-facing hubs needed to discover current documentation changes directly: the homepage, STATUS, HOW_IT_WORKS, `sitemap.xml`, `project.json`, `release-contract.json`, the repository manifest, and both update feeds. Other current HTML pages remain discoverable through the sitemap and normal internal links rather than every page being submitted on every deployment.

IndexNow is not evidence that a search engine crawled, indexed, ranked, or immediately refreshed a page.

## What this does not guarantee

No `llms.txt`, Markdown mirror, `rel="describedby"`, `rel="alternate"`, sitemap, JSON-LD block, IndexNow submission, manifest, or CI job can force a third-party assistant or search engine to retrieve fresh content.

Search indexes can lag. Clients can ignore optional conventions. HTML, Markdown, plain-text, and JSON fetch capabilities vary.

Likewise:

- green discovery CI does not prove runtime correctness;
- source CI does not prove an older packaged ZIP contains later source behavior;
- consistent release metadata does not close physical field gates;
- exact packaged evidence still requires the exact artifact identity.

The system only reduces avoidable ambiguity by making current facts reachable through several independently useful paths that all lead back to canonical repository sources.

## References used for this design

- llmstxt.org v2 proposal — H1/summary/H2 file-list structure, project/subpath scoping, clean Markdown variants, `rel="alternate"`, and `rel="describedby"` discovery.
- Cloudflare documentation style guidance — `llms.txt` / `llms-full.txt` patterns.
- Vercel guidance on agent-readable documentation — discovery, clean retrieval, metadata, and verification as separate concerns.
- Google Search Central guidance — normal crawl/index fundamentals, visible textual content, internal links, and structured-data consistency remain important for AI/search features.
- IndexNow protocol documentation — change notification, key verification, and response semantics.
- GitHub Pages / Actions documentation — build, artifact, deploy, and live-site workflow separation.

## Adoption record

The llms.txt v2 compatibility layer was merged through [PR #123](https://github.com/Eun-si123/teamforge-unity-collab/pull/123). The PR preserved v1-style readability while adding route-local Markdown variants, explicit HTML discovery relations, and Pages-time validation. The change passed the repository's normal PR checks before merge.
