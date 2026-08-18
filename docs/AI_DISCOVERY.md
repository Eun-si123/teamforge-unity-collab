# TeamForge AI/search discovery strategy

Date: 2026-08-18

This document records why TeamForge exposes project facts in several forms instead of relying on a single `llms.txt` file or on GitHub's rendered pages.

## Problem being solved

Some AI clients can directly fetch a URL or repository file, while others answer from a search index or a cached retrieval layer. A client that cannot fetch `project.json` directly may still discover the TeamForge homepage through search, but it can miss recently added repository files or infer stale state from an older index.

A second failure mode is repository drift: a new report, source file, test, or guide can be committed without being added to a hand-maintained AI index. The goal is therefore not only to optimize for one model, but also to make discovery coverage mechanically checkable.

A third failure mode is **format-specific retrieval**. Some assistants and crawler-backed products can fetch normal HTML pages reliably while failing on GitHub raw/API endpoints, JSON, or arbitrary plain-text URLs. TeamForge therefore keeps ordinary HTML as a first-class fallback for its most important current documentation instead of assuming that machine-readable formats are universally fetchable.

The design goal is to make the same canonical project facts reachable through several retrieval paths while keeping one source-controlled truth and preserving a complete inventory of the repository.

## Patterns adopted from other agent-readable sites

### Discovery index plus full context

Cloudflare publishes both `llms.txt` as a directory and `llms-full.txt` as a bulk context representation. TeamForge follows the same split: a small routing document for selective retrieval and a curated current-context resource for clients that prefer one fetch.

TeamForge intentionally does **not** put every historical report or source file into `llms-full.txt`. Doing so would increase stale-context and token-noise risk. Instead, exhaustive discovery is provided separately through `repository-manifest.json`.

### Discovery, clean retrieval, structured metadata, and tool access as separate layers

Vercel's agent-readability guidance separates discovery (`llms.txt`, sitemaps), retrieval (clean Markdown/text), metadata, and optional tool access. It also recommends checking that pages are discoverable from at least one index and verifying live HTTP responses.

For the current static GitHub Pages site this means:

- discovery through the human homepage, ordinary HTML documentation, `llms.txt`, `sitemap.xml`, `sitemap.md`, and `repository-manifest.json`;
- clean retrieval through generated HTML documentation plus generated `.txt` resources;
- structured metadata through `project.json`, the complete repository manifest, page-level JSON-LD, and homepage JSON-LD;
- build-time link/inventory validation;
- post-deploy live endpoint smoke tests;
- proactive search-engine change notification through IndexNow after successful `main` deployments;
- future dynamic/tool access through MCP only when a real runtime use case justifies it.

### Visible text remains the search-facing source

Google's guidance for AI features says normal Search/SEO fundamentals still matter: important information should be available as textual page content, pages should be internally discoverable, and structured data should match what users can see. Google does not require a special AI-only file for inclusion in its AI search features.

Because of that, TeamForge does not hide its current version/status/source identity only in JSON. The built homepage contains the same facts as visible HTML, then mirrors them in JSON-LD and `project.json`.

The same principle now applies to the most important current documentation. `/status/`, `/architecture/`, `/source/`, `/changelog/`, and `/security/` are ordinary crawlable HTML pages generated from the same canonical repository documents that also produce the clean plain-text mirrors. This gives normal search crawlers and HTML-only fetchers readable pages without creating a second hand-maintained truth.

### Structured metadata follows visible canonical facts

The homepage uses `SoftwareSourceCode` JSON-LD so generic parsers have explicit fields for the repository, languages, runtime platform, version, lifecycle status, modification time, and related documentation. The JSON-LD is generated from the same `project.json` values shown visibly on the page.

The generated documentation pages use page-specific title/description/canonical metadata and `TechArticle` JSON-LD that points back to TeamForge as the software source project. Their visible body comes from the canonical Markdown/text mirror rather than a separately edited webpage copy.

Package version, Unity compatibility, and license come from the Unity package metadata. The public lifecycle label and summary are parsed from the bold status declaration in `STATUS.md`. This removes the previous duplicate hard-coded Unity/status values from the generated website layer.

### Complete inventory without full-site duplication

`repository-manifest.json` is generated from `git ls-files` for every Pages build. Every tracked path receives:

- the exact path;
- blob SHA;
- byte size;
- a broad category such as current documentation, history, source, test, automation, configuration, or other asset;
- whether the file is a likely text candidate;
- a canonical GitHub URL pinned to the exact `sourceCommit`.

This gives agents and maintainers a complete repository map without publishing a second copy of the entire source tree on Pages. It also gives CI a precise way to detect when a tracked file is missing from discovery coverage.

## Current retrieval paths

### Search-grounded assistant

1. Discover the normal TeamForge homepage through a search index.
2. Read visible current version, status, runtime, source commit, and canonical-evidence guidance.
3. Follow ordinary HTML links to `/status/`, `/architecture/`, `/source/`, `/changelog/`, or `/security/` when the question needs deeper current documentation.
4. Use the linked plain-text/JSON resources when that client supports them.
5. If the search index is stale, compare the site snapshot with `project.json.sourceCommit` when direct JSON retrieval is available.

### HTML-only direct reader

1. Read the homepage.
2. Follow one of the generated documentation pages for current status, architecture, source navigation, history, or security.
3. Use the canonical-source link on that page when GitHub HTML is fetchable.
4. Do not infer that a raw/API/JSON resource is private merely because the client cannot fetch that format.

### Direct URL reader

1. Read `/llms.txt` or `/sitemap.md`.
2. Select the smallest relevant `.txt` resource.
3. Use `/project.json` for current metadata/freshness.
4. Use `/repository-manifest.json` when the needed path is not part of the curated mirrors.
5. If plain text or JSON fails but ordinary HTML works, use the generated HTML documentation rather than treating retrieval failure as repository evidence.

### Repository-aware coding agent

1. Read root `llms.txt`.
2. Use `CODEMAP.md` and `docs/SOURCE.md` to narrow the task.
3. Read the target module README, source, and nearest tests.
4. Load architecture/security/history only when the task requires them.
5. Use the manifest only for exhaustive path discovery, not as a reason to load the entire repository into context.

## Build-time single-source behavior

The website's machine/search-facing layer is generated during the Pages workflow.

The workflow now runs for every pull request and every `main` push rather than only a hand-maintained set of documentation paths. This is required because the repository manifest and `sourceCommit` describe the whole repository; any tracked-file change can affect their correctness.

During the build:

1. canonical repository documents are copied into clean text mirrors;
2. `project.json` is generated from package metadata, `STATUS.md`, the checked-out source commit, and stable project-level metadata;
3. `repository-manifest.json` inventories every tracked file at that commit;
4. `scripts/build-agent-web.py` calls `scripts/render_doc_pages.py` to render the selected current documents into `/status/`, `/architecture/`, `/source/`, `/changelog/`, and `/security/`, adds their routes to `project.json`, and then generates visible homepage project facts, JSON-LD, alternate resource links, and `sitemap.md`;
5. `scripts/build-sitemap.py` generates `sitemap.xml`, includes the five crawlable HTML documentation routes, omits ignored `<priority>` hints, and derives each stable document's `lastmod` from the newest commit that changed its canonical source document(s); snapshot-wide outputs such as the homepage, `project.json`, repository manifest, and semantic sitemap use the current source commit date because their visible/generated identity changes with that snapshot;
6. `scripts/verify-agent-site.py` cross-checks the repository manifest against `git ls-files`, verifies `project.json`/manifest source identity, requires the generated HTML documentation, validates its search-facing markup, checks XML sitemap URL coverage and ISO `lastmod` values, rejects `<priority>` output, and rejects missing generated targets referenced by project metadata, HTML, or the semantic sitemap.

The Pages checkout uses full repository history because source-aware sitemap dates cannot be calculated reliably from a depth-1 checkout. This affects build metadata only; it does not change the public source or runtime package.

The small HTML renderer intentionally avoids adding a network-time package install to the Pages build. It supports the Markdown constructs used by the selected documents and rewrites relative repository links back to canonical GitHub source locations.

After a successful `main` deployment, the workflow performs live HTTP smoke tests against the important Pages endpoints, including the five generated HTML documentation routes, and verifies that the deployed `project.json.sourceCommit` equals the GitHub Actions commit that was just deployed.

This separates two claims that were previously easy to confuse:

- **build correctness:** the generated artifact is internally consistent before deployment;
- **live availability:** the important public URLs actually return content after deployment.

## Proactive search freshness with IndexNow

TeamForge also uses IndexNow as a change-notification layer for search engines that participate in the protocol. This is intentionally separate from the Pages deployment workflow so a failed search notification cannot make an otherwise valid website deployment fail.

The repository hosts an IndexNow verification key inside the TeamForge GitHub Pages project path. IndexNow's `keyLocation` mechanism permits a key hosted below the host root to authorize URLs under the same path prefix, which fits a GitHub Pages project site where TeamForge does not control the host root.

After the `Deploy TeamForge website` workflow completes successfully for a `main` push, `.github/workflows/indexnow.yml`:

1. fetches the deployed key file and verifies its content before submission;
2. submits the homepage, `project.json`, and `repository-manifest.json` to the IndexNow global endpoint;
3. accepts HTTP `200` as successful receipt and HTTP `202` as receipt with key validation pending;
4. rejects other response codes so delivery problems remain visible in GitHub Actions.

Those three URLs are deliberately small in number and are rebuilt with current source identity on every successful Pages deployment. IndexNow is a crawl-prioritization notification, **not** a guarantee that Bing or another participating search engine will crawl, index, rank, or immediately refresh the submitted content.

## Discovery coverage policy

Not every tracked file should be duplicated into `llms-full.txt`, rendered as standalone HTML, or placed directly in the XML sitemap.

Instead:

- the homepage and five generated HTML documentation pages provide ordinary search/HTML-fetch paths for the highest-value current material;
- `llms.txt` and `sitemap.md` contain curated, task-oriented navigation;
- `project.json` contains structured routes for the stable/current HTML, text, and metadata resources;
- `sitemap.xml` exposes important search-facing and agent-facing public resources and uses source-aware `lastmod` dates instead of stamping every URL with every deployment date;
- `repository-manifest.json` guarantees exhaustive tracked-file discovery;
- historical raw notes remain lower-precedence evidence and are only loaded when relevant.

A new tracked file therefore does not have to be hand-added to every index to remain discoverable. The manifest automatically includes it on the next build, while important stable resources should still be added explicitly to the curated indexes when their role justifies it.

## robots.txt limitation on the GitHub Pages project path

The repository includes `site/robots.txt`, which is deployed under the TeamForge project path. Standard crawler rules such as Google's apply `robots.txt` at the host root, not an arbitrary project subdirectory. Therefore `/teamforge-unity-collab/robots.txt` should be treated as a documented project policy/fallback artifact, not as authoritative control for the entire `eun-si123.github.io` host.

TeamForge's intended public posture is crawlable. The homepage and generated HTML documentation declare `index,follow`, and no project-level build logic intentionally blocks ordinary crawling. A future custom domain or user-site root could provide authoritative host-root robot policy if needed.

## What this does not guarantee

No HTML page, markup, manifest, sitemap, IndexNow notification, or CI test can force a third-party AI client to fetch a particular URL, refresh its index immediately, or use a specific retrieval path. Search indexes may lag behind the GitHub default branch. `llms.txt` is an agent-oriented convention, not a universal guarantee that every assistant will discover or obey it.

The design instead reduces failure modes: an HTML-only client gets ordinary crawlable documentation, a direct-fetch client gets clean text/JSON, a coding agent gets repository navigation, a search-grounded client can obtain essential facts from the same human-visible site that search engines index, and maintainers get automated evidence that the generated discovery graph covers every tracked repository path.

## References used for this design

- Cloudflare Style Guide — AI consumability: `llms.txt` plus `llms-full.txt`, including scoped indexes.
- Vercel Knowledge Base — Make your documentation readable by AI agents / Agent Readability specification: discovery, semantic sitemap, structured metadata, live HTTP verification, and coverage checks.
- Google Search Central — AI features and generative-AI optimization guidance: normal crawl/index fundamentals, internal links, visible textual content, and structured-data consistency remain primary.
- IndexNow.org — protocol documentation for key-file ownership verification, `keyLocation`, URL submission, and response semantics.
- Bing Webmaster Tools — IndexNow guidance and submission reporting for search freshness.
- GitHub Docs — custom GitHub Pages workflows: build/upload/deploy separation and deployment URL exposure through the Pages environment/action.
