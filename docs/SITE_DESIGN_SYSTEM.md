# TeamForge website design system

TeamForge public pages share one identity without sacrificing documentation readability.

## Canonical ownership

- site/site-theme.css: shared dark/light color tokens, navigation, focus styles, fallbacks.
- site/homepage.css: homepage-only cinematic hero, art, headings, and marquee.
- site/homepage-motion.js: optional motion, never necessary to display key content.
- site/index.html: owns homepage art and editorial content in source HTML.
- site/reading-design.css: editorial styling for generated Docs, Status, How It Works, Test Lab, Architecture, Security, and other reading pages.
- scripts/render_doc_pages.py: single localized documentation shell generator. Do not fork generated HTML or edit .pages-site directly.
- site/i18n: locale registry, translation data, source-review pins.

## Design principles

1. Keep the homepage theatrical; reading pages calm and dense, with consistent brand navigation.
2. Preserve language-specific headings and translated descriptions. Avoid English-only pseudo-content on translated reading pages.
3. Keep dark/light theme selection on reading pages. Maintain visible focus, legible text, and sufficient contrast.
4. Retain the table of contents, readable widths, scrollable code blocks and data tables.
5. Honor reduced-motion preferences; leave important markup available without JavaScript.
6. Preserve honesty about release readiness and demonstrated capabilities. Styling must not hide warnings or suggest a live demo is production-ready.
7. Avoid runtime DOM rewriting for the core page structure or duplicating style overrides across translated pages.

## Verification

- Run the exact GitHub Pages build workflow from .github/workflows/pages.yml.
- Run Python document renderer tests and the site Node.js tests.
- Inspect generated Docs, Korean Status, How It Works and Test Lab pages on phone and desktop widths.
- Test dark/light switch, locale selection, keyboard navigation, heading anchors and media.
- Merge through a reviewed PR with passing checks.
