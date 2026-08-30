# TeamForge website localization policy

This document defines the quality bar for adding and maintaining localized TeamForge website pages.

The goal is **useful multilingual access**, not maximizing the number of generated URLs. A locale should be published only when it helps a reader understand the current project without creating a misleading, stale, or search-only copy of the English site.

## 1. Core principles

1. **English is the source-of-truth language for project claims.**
   - Current implementation and release-readiness claims ultimately trace back to the maintained English canonical documents and source/tests.
   - A translation must not silently introduce stronger claims than the English source.
2. **Localized pages use separate static URLs.**
   - Default English: `/`, `/status/`, `/how-it-works/`, ...
   - Korean: `/ko/`, `/ko/status/`, `/ko/how-it-works/`, ...
   - Simplified Chinese preview: `/zh-hans/`, with long-form routes added only when reviewed translations exist.
   - Future locales follow the same directory model.
3. **Do not publish fake localized pages.**
   - If a document has no maintained translation, do not copy the English body into a locale URL just to create another indexed page.
   - Link the reader to the locale landing page and make the English fallback explicit.
4. **Machine translation may assist drafting, but it is not the publication standard.**
   - Product claims, limitations, security language, release state, and technical terminology require review before a localized page is treated as maintained.
5. **No locale is allowed to weaken safety or evidence boundaries.**
   - Warnings, experimental status, unsupported features, release blockers, and source-versus-package distinctions must survive translation.
6. **Locale behavior is data-driven.**
   - `site/i18n/locales.json` owns locale lifecycle, routing, document equivalents, language-picker metadata, and runtime translation bundle discovery.
   - A new language should add locale data and reviewed translations, not another language-specific branch in the builders.

## 2. Publication gates

Publication and search indexing are deliberately separate decisions. A useful translation can be exposed for real-world review before it is treated as a maintained search surface.

### Preview publication gate

A locale may appear in the public language picker with `lifecycle: preview`, `publish: true`, and `indexable: false` when it has at least:

- a reviewed localized landing page on its final static locale URL;
- localized title, description, navigation, important accessible labels, and language-picker UI needed by that landing page;
- a reviewed interactive-demo translation bundle when the demo exposes user-facing runtime text;
- an explicit terminology/glossary decision for recurring TeamForge and Unity terms;
- preserved product, safety, networking, and evidence boundaries from the English canonical source;
- clear English fallback behavior for long-form documents that are not translated yet;
- passing build checks for `lang`, self-canonical URL, local links, runtime bundle integrity, preview `noindex`, and deployed assets.

A preview locale is useful for browser/device QA and human language review, but it is **not yet a maintained SEO locale**. It must not be added to the indexable `hreflang` graph or locale sitemap entries until the maintained/indexable gate is met.

### Maintained and indexable gate

Before a locale moves to `lifecycle: maintained` and `indexable: true`, it should additionally have:

- a maintained localized current-status page;
- a maintained localized “How it works” page or equivalent product-flow explanation;
- reviewed localized metadata and navigation for those long-form pages;
- a named maintainer/reviewer or explicit review owner with reasonable capacity to keep the locale current;
- terminology review appropriate to the target audience, including established Unity/networking terms;
- browser/mobile/accessibility QA for the language picker and core localized pages;
- passing reciprocal `hreflang`, canonical, sitemap, localized-route, runtime-bundle, and freshness checks;
- no known product-claim drift or release-readiness ambiguity relative to the English source.

A locale can start small. It is better to expose one useful non-indexable preview for review and later maintain three trustworthy indexed pages than to publish thirty stale or search-only translations.

## 3. URL, canonical, and language metadata

For every localized page that has a real equivalent:

- use one stable locale URL;
- set `<html lang="...">` to the page language;
- use a **self-referencing canonical URL**;
- list the English and localized equivalents with reciprocal `hreflang` links only when those variants are indexable equivalents;
- use `x-default` for the default English fallback unless the site later gains a dedicated language chooser URL;
- use normal crawlable `<a href>` language links;
- display language names in their own language (`English`, `한국어`, `简体中文`, `日本語`, ...), not flags alone;
- add `dir="rtl"` when a future locale requires right-to-left page layout.

TeamForge currently uses HTML `<link rel="alternate" hreflang="...">` annotations as the single hreflang mechanism. The XML sitemap lists real deployed **indexable** URLs and source-aware `lastmod` values, but should not duplicate the hreflang graph unless there is a concrete reason to change that design.

For long-form documentation, `hreflang` is emitted **only for real indexable equivalents declared in the locale registry**. An untranslated English document must not gain an invented `/locale/...` counterpart.

## 4. Language switching behavior

- Never force a visitor to another locale only because of IP address, browser language, or geography.
- The explicit user-selected language always wins.
- Browser language is used only as a **local recommendation signal**, never as an automatic redirect trigger.
- The searchable language picker reads `navigator.languages` in the browser and does not send that language preference to a TeamForge server.
- When a visitor explicitly chooses another locale, the picker may remember only that explicit locale choice in `localStorage`; the remembered choice takes precedence over later browser-language recommendations.
- A visible language control must always remain available so the visitor can choose another locale again.
- When the current page has an equivalent translation, switch to that same page.
- When it does not, link to the locale landing page and clearly say that the document itself is not translated yet.
- The server-rendered/static language links remain the no-JavaScript and enhancement-failure fallback.

## 5. Translation freshness

A translation can become misleading even when its prose is high quality.

Long-form localized documents use **two different freshness signals with different purposes**:

1. The rendered page still compares the most recent Git change date of the English source and localized source. If the localized document is older, the page shows a visible warning and links to the English source. This remains a useful reader-facing heuristic.
2. Every published localized long-form document also declares `reviewedSourceBlob` beside `sourceRepoSource` in `site/i18n/locales.json`. The value is the exact Git blob SHA of the canonical English file that was semantically reviewed. CI and the Pages build compare that pin with the current English blob and fail if the English source bytes change.

The date comparison alone is **not proof of semantic parity**. A newer translation commit could still omit an earlier English change. The exact blob pin closes that specific gap: a translation cannot continue to pass as reviewed after its canonical English source changes unless a reviewer compares the translation again and deliberately advances the pin.

The exact blob contract is content-based rather than commit-based. Unrelated repository commits do not stale a translation when the reviewed English file bytes are unchanged.

Landing pages use a similar reviewed-source contract: locale manifests record exact Git blob IDs for English/product sources that were considered during translation review. Changes to those translatable sources make the build fail until the locale is reviewed again.

Rendering and loading implementation files are not translation freshness boundaries merely because their code changes. Runtime translation content is separated into locale bundles, while actual English product/UI copy remains the review boundary.

When updating a localized STATUS, HOW_IT_WORKS, or another declared long-form document:

- compare the full current English source against the localized document;
- preserve product, safety, evidence, release, and networking boundaries;
- update the localized text as needed;
- only then set `reviewedSourceBlob` to the current Git blob SHA of `sourceRepoSource`;
- let CI and the Pages build reject accidental stale pins.

The lifecycle label still carries additional meaning beyond byte freshness. An exact pin proves that a specific English source version was reviewed; it does not by itself prove native-language quality, accessibility, or that a preview locale is ready for indexing.

## 6. Terminology policy

Translate for comprehension, not for maximum word substitution.

Technical names that are normally used as identifiers or established Unity/networking terms may remain in English where translating them would create ambiguity. Examples include:

- TeamForge
- Unity Editor
- Scene
- Hierarchy
- Transform
- Prefab
- Host / Guest
- Project Peer
- P2P
- WebSocket
- authority
- lock / ownership
- bootstrap
- Seed
- relay
- ICE / STUN / TURN

A locale may explain a term in its own language on first use while preserving the canonical technical term. Search copy should include natural phrases that speakers of that language actually use, but must not keyword-stuff synonyms.

Interactive-demo terminology should be defined in the locale runtime bundle rather than duplicated in JavaScript conditions. Repeated dynamic terms can use locale-owned term maps and pattern templates.

## 7. SEO and indexing quality gate

Before a localized URL is indexable, verify:

- the primary body content is genuinely in that locale;
- title and meta description are localized and accurately describe the page;
- canonical points to the localized page itself;
- all real indexable equivalent pages link back to one another with matching `hreflang` values;
- `x-default` is deliberate;
- the page is reachable through normal links, not JavaScript-only navigation;
- the page is included in `sitemap.xml` only if it actually exists and the locale is indexable;
- important links resolve and do not accidentally cross into a wrong locale without explanation;
- locale runtime assets referenced by the page actually deploy and match the declared locale;
- no mass-generated thin pages were created only to catch translated keywords;
- preview/review-needed pages remain `noindex,follow` until the maintained gate is met.

More locales do not automatically increase ranking. They expand the set of languages and queries TeamForge can serve **only when the localized page is useful enough to deserve indexing**.

## 8. Translation review checklist

For every substantial localized update, review at least:

- product version and release ID;
- release-readiness state and blockers;
- warnings and backup/safety language;
- implemented versus planned feature boundaries;
- protocol/network claims;
- source versus packaged-artifact distinctions;
- links, issue numbers, filenames, hashes, and commands;
- terminology consistency;
- headings and search description;
- interactive-demo runtime text and accessible labels;
- mobile language-switch behavior;
- English fallback behavior for untranslated material.

Commands, hashes, identifiers, filenames, URLs, code symbols, and protocol names should normally be copied exactly rather than translated.

## 9. Locale lifecycle

A locale can have three maintenance states:

- **Maintained** — the maintained/indexable gate is met and translations are actively reviewed. Normally `publish: true` and `indexable: true`.
- **Review needed / preview** — a useful reviewed subset is published for real-world review, but long-form parity or final QA has not been confirmed. Normally `publish: true` and `indexable: false` with `noindex,follow`.
- **Unmaintained / unpublished** — no reasonable path exists to keep the locale trustworthy. Normally `publish: false`; existing historical translations may remain in source/history but must not be presented as current.

The operational registry expresses this with `lifecycle`, `publish`, and `indexable`. Publication and indexing are separate decisions so a locale can be reviewed on its real static URL before it becomes a search surface.

Do not delete a useful historical translation merely because it is behind, but do not present an unmaintained translation as current.

## 10. Current implementation and expansion strategy

The English, Korean, and Simplified Chinese preview workflow uses one locale registry across the landing-page builder, long-form document renderer, machine-readable localized routes, sitemap discovery, runtime demo translation lookup, searchable language picker, and live post-deploy smoke checks.

Localized document metadata is not stored in a Korean-only table. A locale declares only the long-form documents that genuinely exist. The renderer creates those routes, their canonical metadata, language-switch targets, and reciprocal `hreflang` graph generically. The sitemap likewise discovers indexable localized document routes from the locale registry instead of hardcoding Korean paths.

Published localized long-form documents carry exact `reviewedSourceBlob` pins. `scripts/verify_localized_doc_revisions.py` verifies those pins in CI, and the sitemap/Pages build performs the same contract check before publication.

Interactive demo translation is separated from its JavaScript engine. `site/editor-demo-localize.js` loads the active locale from the registry and consumes `site/i18n/editor-demo.<locale>.json` data, so future languages do not require copied observers or `if locale == ...` branches.

Homepage and generated documentation language controls are progressively enhanced by the same `site/locale-picker.js`: static crawlable links remain the fallback, while JavaScript adds locale search, browser-language recommendations, explicit-choice memory, preview badges, route-aware switching, RTL-safe labels, and mobile layout without forcing redirects.

Add further locales based on actual user/search demand and available review capacity. Candidate languages can include Japanese, Traditional Chinese, Spanish, German, French, and Brazilian Portuguese, but priority should be informed by Search Console and community demand rather than a fixed language-count target.

A future locale should therefore exercise the generic path rather than expand the architecture: register it, add reviewed landing-page data, add a runtime translation bundle, expose it as a non-indexable preview when the preview gate is met, declare only genuinely translated long-form documents with exact reviewed-source pins, and promote it to maintained/indexable only after the stronger gate is satisfied.

## References behind this policy

This policy is informed by:

- Google Search Central guidance for localized versions, separate locale URLs, canonicalization, `hreflang`, and scaled-content abuse;
- W3C Internationalization guidance for language negotiation, visible language links, explicit-choice preference, and language-selection usability;
- Unicode/CLDR language-tag and locale matching practices used when considering future script/region-aware recommendation improvements;
- Kubernetes localization practice around minimum viable localized content, human review, terminology, and stale-translation warnings;
- static localization patterns used by Docusaurus and VitePress.

External guidance is a design input, not a substitute for TeamForge's own testing and maintenance evidence.
