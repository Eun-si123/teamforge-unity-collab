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
- language-menu UI;
- locale-specific translation-density/forbidden-marker checks;
- shared assets that must remain safe from locale-relative URL breakage.

The homepage builder, documentation renderer, project metadata generation, sitemap generation, and post-deploy smoke test consume this registry. Adding a locale should not require another `if locale == ...` branch in those systems.

## Ownership split

- `site/index.html` owns the product landing-page layout, visual hierarchy, interactive demo, and shared English source copy.
- `scripts/build-agent-web.py` enriches the built English homepage with a compact canonical status warning and structured project/search/agent facts.
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

The renderer automatically generates reciprocal `hreflang` only for real equivalent documents. If a locale does not have a translation for the current document, the language switch omits that locale for this document instead of sending the reader to an unrelated homepage or generating a fake translated URL.

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

Locale pages are static and useful without JavaScript. The language selector uses ordinary links. The searchable picker recommends from browser languages and remembers only explicit choices. It never redirects automatically; static links remain available without JavaScript.

## Website locale maintenance

The registry publishes `en`, `ko`, `ja`, `zh-Hans`, `es`, `de`, `fr`, `pt-BR`,
`zh-Hant`, `it`, `pl`, `tr`, `id`, `vi`, `ru`, and `ar`.
Codes retain BCP 47 casing; URL paths use the established lowercase directory style
(`zh-hans/`, `pt-br/`). English remains the default. New languages and Simplified
Chinese remain non-indexable previews until the existing maintained-locale gate is met.

All sixteen languages have a landing page, demo UI, documentation hub and compatibility
route. Korean and Simplified Chinese retain their existing STATUS and HOW_IT_WORKS
translations; Japanese, Spanish, German, French and Brazilian Portuguese have these
translations too. Other long-form guides stay in English with an explicit English label;
no localized equivalent is invented.

Arabic selects the existing shared RTL path in the registry. Traditional Chinese uses
the `zh-hant/` route and explicit script/region browser matches. Product identifiers,
GameObject names, Scene/Hierarchy/Inspector, Host/Peer, protocol names and keyboard
shortcuts remain technical terms; surrounding explanations and controls are translated.
This terminology choice applies to the new preview bundles as well.

`documentUi.translationNotice` owns each locale's provenance notice. The homepage and
document generators share its rendering helper and link to the canonical localization
policy. The existing English UI digest covers this copy. Source comparisons are
AI-assisted semantic reviews, not independent native-speaker certification.

`site/docs-hub.json` owns the English docs hub copy previously embedded in the renderer.
`docs-hub.<locale>.json` translates that data directly from English. These are registered
as documents with exact English blob pins; the renderer owns the card layout. The JSON
plain-text mirrors are the exact source data, not a separately maintained copy.
`docs/compatibility.md` owns requirements, with `docs/compatibility.<locale>.md` translations.
All registered document mirrors are copied from their owning sources on every build.

The registry also owns theme labels and documentation chrome. Builders emit locale UI
as inert JSON before the theme control reads it; English is the per-string fallback.
`reviewedEnglishUi` is a SHA-256 digest of the canonical English registry UI plus English
page metadata in `PAGES`. It detects changed headings/descriptions as well as menus.
Use `english_ui_digest` in `scripts/verify_site_locale_data.py` to calculate it **after
comparing the translations**, never as an unconditional build-time refresh.

`reviewedSources` includes both English demo implementations: the lightweight v2 now
contains user-visible copy and is no longer exempt from freshness checks. Blob checks
hash the current working files, so uncommitted English changes also fail the gate.

Run `python3 scripts/verify_site_locale_data.py .`,
`python3 scripts/verify_localized_doc_revisions.py .`, and
`node --test site/locale-picker.test.mjs site/editor-demo.test.mjs site/i18n.test.mjs`.
The Pages build invokes the data check and source-pin checks. Key/template parity,
duplicate keys, language metadata and link checks complement semantic review; none
certifies native-speaker quality. Preserve GameObject names, identifiers, code and
keyboard shortcuts instead of translating them as UI labels.
