# TeamForge homepage localization

This directory owns **short-form landing-page localization**, not long-form project documentation.

## Ownership split

- `site/index.html` owns the product landing-page layout, visual hierarchy, interactive demo, and shared English source copy.
- `scripts/build-agent-web.py` enriches the built English homepage with current project/search/agent facts.
- `scripts/build_homepage_locales.py` normalizes shared locale UI and generates localized landing pages from that **finalized English homepage**.
- `site/i18n/homepage.<locale>.json` owns reviewed locale metadata and exact translation anchors.
- `README.<locale>.md` and `docs/*.ko.md` remain long-form documentation sources. They must not be rendered as a replacement for the product landing page.

## Why the localized homepage is generated from finalized English HTML

The English and localized landing pages should remain the same product page: same sections, same interactive controls, same IDs, same development capture, and the same current project-facts block. Only language-specific content, metadata, locale navigation, and links to genuinely localized documents should differ.

The builder checks the complete DOM ID sequence of English and Korean outputs. A locale must not quietly turn into a README/document page or drift to a different information architecture.

## Translation review gate

Each locale manifest records `reviewedSources` as exact Git blob IDs. If a reviewed English homepage source or builder changes, the Pages build fails until the localized homepage is reviewed and its recorded blob is updated.

This is intentionally stricter than comparing modification dates: a newer translation commit does not prove that every source change was translated.

## Adding another locale

Before publishing another locale:

1. create a maintained locale manifest rather than copying generated HTML;
2. translate the complete landing-page experience, including interactive-demo messages and SEO metadata;
3. provide a native language label (`日本語`, `Español`, etc.), not a country flag as the only language identifier;
4. publish localized document URLs only where maintained translations actually exist;
5. add reciprocal `hreflang` coverage and a self-canonical URL;
6. extend structural/content validation and live smoke tests;
7. identify who will keep the locale current.

If the locale cannot be maintained, it should remain experimental or unpublished rather than becoming a permanently stale search page.

## Runtime behavior

Locale pages are static and useful without JavaScript. The language selector uses ordinary links. Browser-language detection may be added later as a convenience, but it must not remove the user's ability to choose another locale and must not be required for search crawlers to discover localized URLs.
