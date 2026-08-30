# llms.txt v2 adoption record — 2026-08-30

This note records the repository/discovery change merged in PR #123 and the documentation follow-up that made the design explicit in `docs/AI_DISCOVERY.md`.

## What changed

TeamForge kept the existing llms.txt structural core readable by older clients while adopting the llms.txt v2 proposal as an additive discovery layer for GitHub Pages.

The deployed design now:

- keeps a small project-path `llms.txt` with one H1, a blockquote summary, H2 resource sections, and Markdown link lists;
- keeps existing `.txt` mirrors and `llms-full.txt` for older/simple direct-fetch clients;
- generates route-local Markdown variants such as `/index.md`, `/status/index.md`, `/how-it-works/index.md`, and maintained Korean equivalents;
- advertises the applicable `llms.txt` from generated HTML using `rel="describedby"`;
- advertises real page Markdown variants using `rel="alternate" type="text/markdown"`;
- keeps `sitemap.md` as related discovery material instead of advertising it as the homepage Markdown representation;
- validates the v2-compatible shape, generated mirrors, internal targets, and HTML discovery relations during the Pages build.

## Compatibility intent

This was deliberately implemented as progressive enhancement rather than a format replacement.

Older llms.txt clients can still consume the familiar H1/summary/H2/link-list structure. v2-aware clients gain explicit descriptor and Markdown-page discovery. Clients that ignore llms.txt entirely still have ordinary HTML, canonical repository Markdown, `.txt` mirrors, JSON metadata, sitemaps, feeds, and the repository manifest.

GitHub Pages does not provide this build with per-resource control of HTTP `Link:` response headers, so the v2 discovery relations are expressed in generated HTML instead.

## Validation

PR #123 passed the repository's normal CI, Pages, Dependency Review, Engineering Quality Gate, and translation-related checks before merge.

The implementation helper `scripts/llms_v2.py` supports both apply and `--check` modes. The Pages post-processing path applies the generated mirrors/discovery and immediately checks them again before deployment.

## Evidence boundary

This is an interoperability/discovery improvement. It is not evidence that search engines or assistants rank TeamForge higher, retrieve it more often, or treat llms.txt as a privileged source. Ordinary crawl/index fundamentals and canonical-source verification remain the primary reliability layer.

See:

- `docs/AI_DISCOVERY.md`
- `llms.txt`
- `scripts/llms_v2.py`
- `scripts/add-update-feed-discovery.py`
- `scripts/README.md`
- PR #123: https://github.com/Eun-si123/teamforge-unity-collab/pull/123
