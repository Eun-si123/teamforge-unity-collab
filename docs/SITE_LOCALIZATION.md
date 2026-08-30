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
   - Future locales follow the same directory model.
3. **Do not publish fake localized pages.**
   - If a document has no maintained translation, do not copy the English body into a locale URL just to create another indexed page.
   - Link the reader to the locale landing page and make the English fallback explicit.
4. **Machine translation may assist drafting, but it is not the publication standard.**
   - Product claims, limitations, security language, release state, and technical terminology require review before a localized page is treated as maintained.
5. **No locale is allowed to weaken safety or evidence boundaries.**
   - Warnings, experimental status, unsupported features, release blockers, and source-versus-package distinctions must survive translation.
6. **Locale behavior is data-driven.**
   - `site/i18n/locales.json` owns locale lifecycle, routing, document equivalents, and runtime translation bundle discovery.
   - A new language should add locale data and reviewed translations, not another language-specific branch in the builders.

## 2. Minimum publication gate for a new locale

A new locale should not be added to the public language selector until it has at least:

- a maintained localized landing page;
- a localized current-status page;
- a localized “How it works” page or equivalent product-flow explanation;
- localized title, description, navigation, and important image alternative text for those pages;
- a reviewed interactive-demo translation bundle when the demo exposes user-facing runtime text;
- a named maintainer/reviewer or an explicit review owner;
- a terminology/glossary decision for recurring TeamForge and Unity terms;
- passing build checks for `lang`, canonical URL, reciprocal `hreflang`, local links, runtime bundle integrity, and sitemap presence.

A locale can start small. It is better to publish three maintained pages than thirty pages whose state is unknown.

## 3. URL, canonical, and language metadata

For every localized page that has a real equivalent:

- use one stable locale URL;
- set `<html lang="...">` to the page language;
- use a **self-referencing canonical URL**;
- list the English and localized equivalents with reciprocal `hreflang` links;
- use `x-default` for the default English fallback unless the site later gains a dedicated language chooser;
- use normal crawlable `<a href>` language links;
- display language names in their own language (`English`, `한국어`, `日本語`, ...), not flags alone;
- add `dir="rtl"` when a future locale requires right-to-left layout.

TeamForge currently uses HTML `<link rel="alternate" hreflang="...">` annotations as the single hreflang mechanism. The XML sitemap lists real deployed URLs and source-aware `lastmod` values, but should not duplicate the hreflang graph unless there is a concrete reason to change that design.

For long-form documentation, `hreflang` is emitted **only for real equivalents declared in the locale registry**. An untranslated English document must not gain an invented `/locale/...` counterpart.

## 4. Language switching behavior

- Never force a visitor to another locale only because of IP address, browser language, or geography.
- The explicit user-selected language always wins.
- Automatic language detection may later be used only as a **suggestion**.
- If the site later remembers a language choice, store only the explicit choice and always keep a visible way to switch back.
- When the current page has an equivalent translation, switch to that same page.
- When it does not, link to the locale landing page and clearly say that the document itself is not translated yet.

## 5. Translation freshness

A translation can become misleading even when its prose is high quality.

Long-form document pages currently compare the most recent Git change date of the English source and localized source. If the localized document is older, the generated page shows a visible warning and links to the English source.

That date comparison is a **warning heuristic, not proof of semantic parity**. A newer translation commit could still omit an earlier English change.

Landing pages use a stronger reviewed-source contract: locale manifests record exact Git blob IDs for English/product sources that were considered during translation review. Changes to those translatable sources make the build fail until the locale is reviewed again.

Rendering and loading implementation files are not translation freshness boundaries merely because their code changes. Runtime translation content is separated into locale bundles, while actual English product/UI copy remains the review boundary.

Longer-term improvement for long-form documents:

- record the exact English source revision or semantic fingerprint that each translated document was last reviewed against;
- fail or warn in CI when the relevant English content changes beyond that reviewed revision;
- require a reviewer to advance the recorded revision after checking the translation;
- distinguish `current`, `review-needed`, and `unmaintained` rather than pretending freshness is binary.

Until exact reviewed-revision metadata is implemented for long-form documents, translators should compare the full English source when updating a current-status or safety-sensitive page.

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
- all real equivalent pages link back to one another with matching `hreflang` values;
- `x-default` is deliberate;
- the page is reachable through normal links, not JavaScript-only navigation;
- the page is included in `sitemap.xml` only if it actually exists;
- important links resolve and do not accidentally cross into a wrong locale without explanation;
- locale runtime assets referenced by the page actually deploy and match the declared locale;
- no mass-generated thin pages were created only to catch translated keywords.

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

- **Maintained** — minimum publication gate is met and translations are actively reviewed.
- **Review needed / preview** — still useful or under review, but parity has not been confirmed; public preview pages should remain non-indexable until the maintenance gate is met.
- **Unmaintained / unpublished** — no reasonable path to keep the locale trustworthy. Remove it from the main language selector and clearly mark existing pages rather than silently serving outdated project claims.

The operational registry expresses this with `lifecycle`, `publish`, and `indexable`. Publication and indexing are separate decisions so a locale can be reviewed on its real static URL before it becomes a search surface.

Do not delete a useful historical translation merely because it is behind, but do not present an unmaintained translation as current.

## 10. Current implementation and expansion strategy

The English + Korean workflow now uses one locale registry across the landing-page builder, long-form document renderer, machine-readable localized routes, sitemap discovery, runtime demo translation lookup, and live post-deploy smoke checks.

Localized document metadata is no longer stored in a Korean-only `KO_PAGES` table. A locale declares only the long-form documents that genuinely exist. The renderer creates those routes, their canonical metadata, language switch targets, and reciprocal `hreflang` graph generically.

Interactive demo translation is also separated from its JavaScript engine. `site/editor-demo-localize.js` loads the active locale from the registry and consumes `site/i18n/editor-demo.<locale>.json` data, so future languages do not require copied observers or `if locale == ...` branches.

Add further locales based on actual user/search demand and available review capacity. Candidate languages can include Japanese, Simplified Chinese, Traditional Chinese, Spanish, German, French, and Brazilian Portuguese, but priority should be informed by Search Console and community demand rather than a fixed language-count target.

The next locale should therefore exercise the generic path rather than expand the architecture: register it, add reviewed landing-page data, add a runtime translation bundle, declare only maintained translated documents, keep it non-indexable while under review, and let the same CI/deployment gates verify it.

## References behind this policy

This policy is informed by:

- Google Search Central guidance for localized versions, separate locale URLs, canonicalization, `hreflang`, and scaled-content abuse;
- W3C Internationalization guidance for language negotiation and visible language links;
- Kubernetes localization practice around minimum viable localized content, human review, terminology, and stale-translation warnings;
- static localization patterns used by Docusaurus and VitePress.

External guidance is a design input, not a substitute for TeamForge's own testing and maintenance evidence.
