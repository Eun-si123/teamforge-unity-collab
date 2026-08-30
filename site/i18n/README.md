# TeamForge homepage localization

This directory owns **short-form landing-page localization** and the locale publication registry. Long-form project documentation remains in the Markdown documentation pipeline.

## Single operational registry

`site/i18n/locales.json` is the source of truth for landing-page locale operations:

- locale code and native label;
- output path and HTML language tag;
- `hreflang` participation;
- text direction (`ltr` / `rtl`);
- lifecycle, publication, and indexing state;
- homepage manifest path;
- localized document routes that really exist;
- language-menu and Language-section UI;
- locale-specific translation-density/forbidden-marker checks;
- shared assets that must remain safe from locale-relative URL breakage.

The builder and post-deploy smoke test read this registry. Adding a locale should not require another `if locale == ...` branch in those systems.

## Ownership split

- `site/index.html` owns the product landing-page layout, visual hierarchy, interactive demo, and shared English source copy.
- `scripts/build-agent-web.py` enriches the built English homepage with current project/search/agent facts.
- `site/i18n/locales.json` owns published homepage locale routing and lifecycle.
- `scripts/build_homepage_locales.py` generates every published localized landing page from the **finalized English homepage**.
- `site/i18n/homepage.<locale>.json` owns reviewed locale metadata and exact translation anchors.
- `README.<locale>.md` and localized files under `docs/` remain long-form documentation sources. They must not be rendered as a replacement for the product landing page.
- `site/editor-demo-localize.js` currently owns runtime localization for the interactive demo; a new locale must provide equivalent runtime coverage before it is marked maintained.

## Why localized homepages are generated from finalized English HTML

All language versions should remain the same product page: same sections, same interactive controls, same IDs, same development capture, and the same current project-facts structure. Language-specific copy, metadata, locale navigation, and links to genuinely localized documents may differ.

The builder compares the complete DOM ID sequence of every published localized homepage with English. A locale cannot quietly turn into a README/document page or drift into a different information architecture.

## Translation review gate

Each locale manifest records `reviewedSources` as exact Git blob IDs for English/product sources that were considered during translation review. If one of those sources changes, the Pages build fails until the affected locale is reviewed again.

The locale builder itself is intentionally not treated as translatable source material. Historical manifests may still contain a self-pin for `scripts/build_homepage_locales.py`; the validator ignores that legacy entry so a validator-only refactor does not mark every translation stale.

This is still stricter than modification-date checks. A newer translation commit does not prove that every relevant source change was translated.

## Locale lifecycle

Use the registry fields deliberately:

- `lifecycle: maintained`, `publish: true`, `indexable: true` — reviewed public locale suitable for normal discovery.
- `lifecycle: preview`, `publish: true`, `indexable: false` — public preview that must render `noindex,follow`; useful for review without presenting it as a maintained search surface.
- `publish: false` — registered/planned locale that is not generated or offered in the language menu.

Do not publish a locale merely because machine translation exists. A stale or low-quality translation is an accessibility and trust problem, not an accessibility improvement.

## Adding another locale

1. Register the locale once in `site/i18n/locales.json`.
2. Add `site/i18n/homepage.<locale>.json` with reviewed metadata and translation anchors.
3. Translate the complete landing-page experience, including SEO metadata, accessible labels, and interactive-demo runtime messages.
4. Add localized document routes only when those maintained documents actually exist.
5. Set a native language label (`日本語`, `简体中文`, `Español`, etc.); do not use a country flag as the only language identifier.
6. Choose the correct HTML language tag and text direction. RTL locales must use `direction: rtl`.
7. Keep the locale non-indexable or unpublished until review is complete.
8. Let the registry-driven build and live smoke test verify canonical URLs, reciprocal `hreflang`, DOM parity, shared assets, and the public route.

## Current boundary

The landing-page pipeline is registry-driven. The long-form documentation renderer still has its own localization mapping and should be generalized separately before many translated documentation sets are added. Keeping that work separate makes this refactor easier to validate without silently changing existing documentation URLs.

## Runtime behavior

Locale pages are static and useful without JavaScript. The language selector uses ordinary links. Browser-language detection may be added later as a convenience, but it must not remove the user's ability to choose another locale and must not be required for search crawlers to discover localized URLs.
