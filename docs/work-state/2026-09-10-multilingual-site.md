# Multilingual website expansion

## Intent and owners

Base: current main `3988a20`. Extend the existing locale registry from English,
Korean and Simplified Chinese to Japanese, Spanish, German, French and Brazilian
Portuguese. English is the sole semantic source. Existing translated values are
not used to translate another language; English anchors/regex schemas are reused.

Scope: landing page, runtime demo, document chrome, documentation hub, compatibility
information, locale selection, freshness and generated Pages validation. No product,
release-readiness, networking, Unity or historical-evidence changes.

Canonical owners: site/index.html plus build-agent-web.py for final English landing
copy, editor-demo-v2.js and editor-demo-v4.js for runtime English, docs/compatibility.md
for requirements, existing English document sources for current claims. locales.json
continues to own routing, publication and language selection. Generated .pages-site
is not edited. The hardcoded English docs hub will move to one data source so its
localized equivalents can use the existing source-blob/document registry contract.

## Invariants and evidence plan

Preserve English semantics and DOM structure, source/automated/physical/package
boundaries, explicit language choice, English fallback, actual equivalent routes,
self-canonical metadata and preview noindex. No native-speaker review is claimed.
New locales remain public previews until the existing maintained/indexable gate is
met. Long-form engineering/history documents without maintained translations stay
English and links identify that destination language.

Run Pages build, localization freshness, docs/engineering/source/workflow validators,
locale/demo tests, generated route/anchor checks, and representative browser QA.
Baseline Pages build passed before edits. Record actual final evidence below.
