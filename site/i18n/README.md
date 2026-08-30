# TeamForge website localization

This directory owns the locale publication registry plus reviewed landing-page and interactive-demo translation data. Long-form translated Markdown remains in the repository, while its public HTML routing and metadata are now driven by the same locale registry.

## Single operational registry

`site/i18n/locales.json` is the source of truth for locale operations:

- locale code and native label;
- output path and HTML language tag;
- `hreflang` participation;
- text direction (`ltr` / `rtl`);
- lifecycle, publication, and indexing state;
- homepage manifest path;
- localized document routes and their rendering metadata;
- document chrome such as source labels, freshness notices, and navigation labels;
- interactive-demo runtime translation bundle path;
- language-menu and Language-section UI;
- locale-specific translation-density/forbidden-marker checks;
- shared assets that must remain safe from locale-relative URL breakage.

The homepage builder, documentation renderer, project metadata generation, sitemap generation, and post-deploy smoke test consume this registry. Adding a locale should not require another `if locale == ...` branch in those systems.

## Ownership split

- `site/index.html` owns the product landing-page layout, visual hierarchy, interactive demo, and shared English source copy.
- `scripts/build-agent-web.py` enriches the built English homepage with current project/search/agent facts.
- `site/i18n/locales.json` owns locale lifecycle, routing, document metadata, and runtime-translation bundle discovery.
- `scripts/build_homepage_locales.py` generates every published localized landing page from the finalized English homepage.
- `site/i18n/homepage.<locale>.json` owns reviewed landing-page metadata and exact translation anchors.
- `scripts/render_doc_pages.py` generates default and localized long-form HTML pages by reading `locales.json`; it does not own language-specific mappings.
- `scripts/doc_markdown.py` owns the small dependency-free Markdown-to-HTML renderer shared by documentation pages.
- `README.<locale>.md` and localized files under `docs/` remain the canonical long-form translation sources.
- `site/editor-demo-localize.js` is the locale-agnostic runtime translation engine.
- `site/i18n/editor-demo.<locale>.json` owns locale-specific interactive-demo strings, attribute translations, terminology maps, and pattern templates.

## Why localized homepages are generated from finalized English HTML

All language versions should remain the same product page: same sections, same interactive controls, same IDs, same development capture, and the same current project-facts structure. Language-specific copy, metadata, locale navigation, and links to genuinely localized documents may differ.

The builder compares the complete DOM ID sequence of every published localized homepage with English. A locale cannot quietly turn into a README/document page or drift into a different information architecture.

## Long-form document routing

A locale declares only documents that really exist under its `documents` object. Each translated document records:

- the public locale path;
- the built plain-text mirror used as rendering input;
- the localized repository source;
- the corresponding English source used for freshness comparison;
- localized title, heading, description, and navigation label.

The renderer automatically generates reciprocal `hreflang` only for real equivalent documents. If a locale does not have a translation for the current document, the language switch links to that locale's homepage instead of generating a fake translated URL.

`project.json.localizedDocumentation` is rebuilt from this registry, so adding a maintained translated document automatically exposes the matching machine-readable HTML route.

## Interactive-demo runtime localization

The demo localization engine first resolves the active `<html lang>` through `i18n/locales.json`, then loads the locale's `runtimeTranslation` bundle. Translation content is data, not branching JavaScript.

A runtime bundle can provide:

- exact text replacements;
- translated `aria-label` and `title` values;
- reusable terminology maps;
- named-capture regex patterns with locale templates.

This lets future locales add `editor-demo.<locale>.json` without copying the observer/runtime engine or adding a language-specific JavaScript branch.

## Translation review gate

Each landing-page locale manifest records `reviewedSources` as exact Git blob IDs for English/product sources that were considered during translation review. If one of those translatable sources changes, the Pages build fails until the affected locale is reviewed again.

Validator/build plumbing should not become a false translation dependency merely because its implementation changes. Runtime translation content lives in locale bundles, while the English demo/UI sources that can introduce new translatable copy remain review inputs.

This remains stricter than modification-date checks. A newer translation commit does not prove that every relevant source change was translated.

## Locale lifecycle

Use the registry fields deliberately:

- `lifecycle: maintained`, `publish: true`, `indexable: true` — reviewed public locale suitable for normal discovery.
- `lifecycle: preview`, `publish: true`, `indexable: false` — public preview that must render `noindex,follow`; useful for review without presenting it as a maintained search surface.
- `publish: false` — registered/planned locale that is not generated or offered in the language menu.

Do not publish a locale merely because machine translation exists. A stale or low-quality translation is a trust problem, not an accessibility improvement.

## Adding another locale

1. Register the locale once in `site/i18n/locales.json`.
2. Add `site/i18n/homepage.<locale>.json` with reviewed metadata and landing-page translation anchors.
3. Add `site/i18n/editor-demo.<locale>.json` and point `runtimeTranslation` at the deployed bundle when the interactive demo is translated.
4. Add localized document entries only for maintained Markdown translations that really exist.
5. Translate the complete landing-page experience, including SEO metadata and accessible labels.
6. Set a native language label (`日本語`, `简体中文`, `Español`, etc.); do not use a country flag as the only language identifier.
7. Choose the correct HTML language tag and text direction. RTL locales must use `direction: rtl`.
8. Keep the locale non-indexable or unpublished until review is complete.
9. Let the registry-driven build and live smoke test verify canonical URLs, reciprocal `hreflang`, document routes, DOM parity, runtime bundles, shared assets, and public routes.

## Runtime behavior

Locale pages are static and useful without JavaScript. The language selector uses ordinary links. Browser-language detection may be added later as a convenience, but it must not remove the user's ability to choose another locale and must not be required for search crawlers to discover localized URLs.
