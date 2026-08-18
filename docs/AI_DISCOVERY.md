# TeamForge AI/search discovery strategy

Date: 2026-08-18

This document records why TeamForge exposes project facts in several forms instead of relying on a single `llms.txt` file or on GitHub's rendered pages.

## Problem being solved

Some AI clients can directly fetch a URL or repository file, while others answer from a search index or a cached retrieval layer. A client that cannot fetch `project.json` directly may still discover the TeamForge homepage through search, but it can miss recently added repository files or infer stale state from an older index.

A second failure mode is repository drift: a new report, source file, test, or guide can be committed without being added to a hand-maintained AI index. The goal is therefore not only to optimize for one model, but also to make discovery coverage mechanically checkable.

The design goal is to make the same canonical project facts reachable through several retrieval paths while keeping one source-controlled truth and preserving a complete inventory of the repository.

## Patterns adopted from other agent-readable sites

### Discovery index plus full context

Cloudflare publishes both `llms.txt` as a directory and `llms-full.txt` as a bulk context representation. TeamForge follows the same split: a small routing document for selective retrieval and a curated current-context resource for clients that prefer one fetch.

TeamForge intentionally does **not** put every historical report or source file into `llms-full.txt`. Doing so would increase stale-context and token-noise risk. Instead, exhaustive discovery is provided separately through `repository-manifest.json`.

### Discovery, clean retrieval, structured metadata, and tool access as separate layers

Vercel's agent-readability guidance separates discovery (`llms.txt`, sitemaps), retrieval (clean Markdown/text), metadata, and optional tool access. It also recommends checking that pages are discoverable from at least one index and verifying live HTTP responses.

For the current static GitHub Pages site this means:

- discovery through the human homepage, `llms.txt`, `sitemap.xml`, `sitemap.md`, and `repository-manifest.json`;
- clean retrieval through generated `.txt` resources;
- structured metadata through `project.json`, the complete repository manifest, and JSON-LD;
- build-time link/inventory validation;
- post-deploy live endpoint smoke tests;
- future dynamic/tool access through MCP only when a real runtime use case justifies it.

### Visible text remains the search-facing source

Google's guidance for AI features says normal Search/SEO fundamentals still matter: important information should be available as textual page content, pages should be internally discoverable, and structured data should match what users can see. Google does not require a special AI-only file for inclusion in its AI search features.

Because of that, TeamForge does not hide its current version/status/source identity only in JSON. The built homepage contains the same facts as visible HTML, then mirrors them in JSON-LD and `project.json`.

### Structured metadata follows visible canonical facts

The homepage uses `SoftwareSourceCode` JSON-LD so generic parsers have explicit fields for the repository, languages, runtime platform, version, lifecycle status, modification time, and related documentation. The JSON-LD is generated from the same `project.json` values shown visibly on the page.

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
3. Follow ordinary HTML links when the client supports them.
4. If the search index is stale, compare the site snapshot with `project.json.sourceCommit`.

### Direct URL reader

1. Read `/llms.txt` or `/sitemap.md`.
2. Select the smallest relevant `.txt` resource.
3. Use `/project.json` for current metadata/freshness.
4. Use `/repository-manifest.json` when the needed path is not part of the curated mirrors.

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
4. `scripts/build-agent-web.py` generates visible project facts, JSON-LD, alternate resource links, and `sitemap.md`;
5. `sitemap.xml` is generated with the source commit date as `lastmod`;
6. `scripts/verify-agent-site.py` cross-checks the repository manifest against `git ls-files`, verifies `project.json`/manifest source identity, and rejects missing generated targets referenced by project metadata, HTML, or the semantic sitemap.

After a successful `main` deployment, the workflow performs live HTTP smoke tests against the important Pages endpoints and verifies that the deployed `project.json.sourceCommit` equals the GitHub Actions commit that was just deployed.

This separates two claims that were previously easy to confuse:

- **build correctness:** the generated artifact is internally consistent before deployment;
- **live availability:** the important public URLs actually return content after deployment.

## Discovery coverage policy

Not every tracked file should be duplicated into `llms-full.txt` or the XML sitemap.

Instead:

- `llms.txt` and `sitemap.md` contain curated, task-oriented navigation;
- `project.json` contains structured routes for the stable/current resources;
- `sitemap.xml` exposes important search-facing and agent-facing public resources;
- `repository-manifest.json` guarantees exhaustive tracked-file discovery;
- historical raw notes remain lower-precedence evidence and are only loaded when relevant.

A new tracked file therefore does not have to be hand-added to every index to remain discoverable. The manifest automatically includes it on the next build, while important stable resources should still be added explicitly to the curated indexes when their role justifies it.

## robots.txt limitation on the GitHub Pages project path

The repository includes `site/robots.txt`, which is deployed under the TeamForge project path. Standard crawler rules such as Google's apply `robots.txt` at the host root, not an arbitrary project subdirectory. Therefore `/teamforge-unity-collab/robots.txt` should be treated as a documented project policy/fallback artifact, not as authoritative control for the entire `eun-si123.github.io` host.

TeamForge's intended public posture is crawlable. The homepage also declares `index,follow`, and no project-level build logic intentionally blocks ordinary crawling. A future custom domain or user-site root could provide authoritative host-root robot policy if needed.

## What this does not guarantee

No markup, manifest, sitemap, or CI test can force a third-party AI client to fetch a particular URL, refresh its index immediately, or use a specific retrieval path. Search indexes may lag behind the GitHub default branch. `llms.txt` is an agent-oriented convention, not a universal guarantee that every assistant will discover or obey it.

The design instead reduces failure modes: a direct-fetch client gets clean text/JSON, a coding agent gets repository navigation, a search-grounded client can obtain essential facts from the same human-visible homepage that search engines index, and maintainers get automated evidence that the generated discovery graph covers every tracked repository path.

## References used for this design

- Cloudflare Style Guide — AI consumability: `llms.txt` plus `llms-full.txt`, including scoped indexes.
- Vercel Knowledge Base — Make your documentation readable by AI agents / Agent Readability specification: discovery, semantic sitemap, structured metadata, live HTTP verification, and coverage checks.
- Google Search Central — AI features and generative-AI optimization guidance: normal crawl/index fundamentals, internal links, visible textual content, and structured-data consistency remain primary.
- GitHub Docs — custom GitHub Pages workflows: build/upload/deploy separation and deployment URL exposure through the Pages environment/action.
