# TeamForge AI/search discovery strategy

Date: 2026-08-18

This document records why TeamForge exposes project facts in several forms instead of relying on a single `llms.txt` file or on GitHub's rendered pages.

## Problem being solved

Some AI clients can directly fetch a URL or repository file, while others answer from a search index or a cached retrieval layer. A client that cannot fetch `project.json` directly may still discover the TeamForge homepage through search, but it can miss recently added repository files or infer stale state from an older index.

The goal is therefore not to optimize for one model. The goal is to make the same canonical project facts reachable through several retrieval paths while keeping one source-controlled truth.

## Patterns adopted from other agent-readable sites

### Discovery index plus full context

Cloudflare publishes both `llms.txt` as a directory and `llms-full.txt` as a bulk context representation. TeamForge follows the same split: a small routing document for selective retrieval and a curated full-context resource for clients that prefer one fetch.

### Discovery, clean retrieval, structured metadata, and tool access as separate layers

Vercel's agent-readability guidance separates discovery (`llms.txt`, sitemaps), retrieval (clean Markdown/text), metadata, and optional tool access. TeamForge mirrors that layered idea instead of assuming one file can serve every client.

For the current static GitHub Pages site this means:

- discovery through the human homepage, `llms.txt`, `sitemap.xml`, and `sitemap.md`;
- clean retrieval through generated `.txt` resources;
- structured metadata through `project.json` and JSON-LD;
- future dynamic/tool access through MCP only when a real runtime use case justifies it.

### Visible text remains the search-facing source

Google's guidance for AI features says normal Search/SEO fundamentals still matter: important information should be available as textual page content, pages should be internally discoverable, and structured data should match what users can see. Google does not require a special AI-only file for inclusion in its AI search features.

Because of that, TeamForge does not hide its current version/status/source identity only in JSON. The built homepage contains the same facts as visible HTML, then mirrors them in JSON-LD and `project.json`.

### Schema.org for explicit software meaning

The homepage uses `SoftwareSourceCode` JSON-LD so generic parsers have explicit fields for the repository, languages, runtime platform, version, lifecycle status, modification time, and related documentation. The JSON-LD is generated from the same build metadata shown visibly on the page.

## Current retrieval paths

### Search-grounded assistant

1. Discover the normal TeamForge homepage through a search index.
2. Read visible current version, status, source commit, and canonical-evidence guidance.
3. Follow ordinary HTML links when the client supports them.
4. If the search index is stale, the page explicitly explains how to compare the current repository with `project.json.sourceCommit`.

### Direct URL reader

1. Read `/llms.txt` or `/sitemap.md`.
2. Select the smallest relevant `.txt` resource.
3. Use `/project.json` for version/source-commit freshness checks.

### Repository-aware coding agent

1. Read root `llms.txt`.
2. Use `CODEMAP.md` and `docs/SOURCE.md` to narrow the task.
3. Read the target module README, source, and nearest tests.
4. Load architecture/security/history only when the task requires them.

## Build-time single-source behavior

The website's machine/search-facing layer is generated after `project.json` is produced during the Pages workflow. `scripts/build-agent-web.py` reads that generated metadata and then:

- replaces the generic homepage JSON-LD with current `SoftwareSourceCode` JSON-LD;
- adds alternate-resource links in `<head>`;
- injects a visible current-project-facts section into the normal homepage;
- generates `sitemap.md` with semantic descriptions and freshness metadata.

This means version, source commit, and generated timestamp do not need to be manually duplicated in the website source.

## What this does not guarantee

No markup can force a third-party AI client to fetch a particular URL, refresh its index immediately, or use a specific retrieval path. Search indexes may lag behind the GitHub default branch. `llms.txt` is an agent-oriented convention, not a universal guarantee that every assistant will discover or obey it.

The design instead reduces failure modes: a direct-fetch client gets clean text/JSON, a coding agent gets repository navigation, and a search-grounded client can obtain the essential facts from the same human-visible homepage that search engines index.
