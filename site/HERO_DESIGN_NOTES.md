# TeamForge — cinematic developer landing design (2026-11-23)

## Brief and source truth

The user asked for an "Unslop" redesign with a superhero-like, high-impact hero landing page. TeamForge is a **Unity Editor real-time collaboration prototype**, not a complete multiplayer product. The design must not alter Unity synchronization code, demo semantics, the 21-locale homepage translation anchors, validation warnings or source-control messaging.

## Design inspiration, independently checked

- [Land-book](https://land-book.com/) — gallery of authentic landing pages, bold type, color-contrasting hero layouts and editorial rhythm.
- [Zed](https://zed.dev/) — developer-product experience grounded in visible real UI.
- [Awwwards](https://www.awwwards.com/) and [gaming hero examples](https://dribbble.com/shots/14534343-God-of-War-Cinematic-Hero-Landing-Page) — cinematic pacing, oversized display type and a single focal illustration.

No external images, IP characters, fonts or source code were copied. Existing TeamForge source markup, scene/cube illustration and recorded Unity demo remain first-party assets. The heroic visual is an original hard-edged CSS composition, not a licensed superhero property.

## What changed

The homepage uses midnight navy, paper-colored text and industrial orange instead of neon-lime glow. The first-screen editorial hierarchy communicates real-time collaboration with a poster-like headline, clean CTA, an original flat geometric forged-cube illustration and restrained development-state label. Repeated scrolling marquees, reactor bloom, ray glow, rotating gradients and scroll theatrics are removed. The illustration works with JS disabled.

The page alternates paper/light and dark factual sections, preserving the lightweight Cube demo, verified actual Unity capture, capability limitations, source-control workflow and AGPLv3/community links. The demo visual palette is adapted without replacing its JavaScript or runtime CSS. The source HTML is intentionally **unchanged**, because its complete blob hash is review-pinned for all 21 translations. RTL placement keeps the focal illustration away from the text column. Reduced-motion users receive no reveal transitions.

## Evidence required

- Site tests: homepage, locale-picker, translations, interactive Cube demo.
- Source DOM section IDs, English source text, SEO metadata and all 21 translation review pins unchanged.
- Visual: desktop 1440px, mobile 390px, Korean and Arabic/RTL check. No unintended clipping or horizontal scroll.
- Functional browser: clickable demo controls and fallback mirrored X value, locale picker, navigation and real Unity video source.
- CI/Pages deployment and **published** website verification are separate from in-memory CSS preview.
- No claims that native Unity two-PC field tests were completed; historical video is development evidence only.

This project currently has numerous parallel feature PRs; this site-only change must not merge, rebase, overwrite or misrepresent those changes.

## Production cache follow-up

On merged PR #624, GitHub Pages rebuilt the new homepage.css but a connected Chromium session still used the previous URL's cached neon stylesheet. The measured computed CSS lacked the new --forge-ember token, even though a cache-busted stylesheet request returned the new file. Follow-up #625 versions both homepage.css and homepage-motion.js URLs from the English source. Because TeamForge pins the exact English homepage Git blob for 20 localized landing manifests, all 20 reviewed-source digests are updated to the new hash **only after verifying the entire HTML is byte-for-byte identical except for the two URL query strings**. No translation strings, locale routes, IDs, assets or SEO copy are changed. This is an asset-revision review, not a new machine-translation claim.


## Mobile Editor 01/02 illustration and hero-height fix (2026-11-23)

A user-provided Android screenshot and production browser inspection showed an oversized CSS-only **EDITOR 01 / HOST / EDITOR 02 / GUEST** decoration occupying 340–385px and 450px of reserved bottom padding in the first screen. This graphic is not a real Unity Editor screenshot; the true interactive Cube/lock demo comes in the next section.

At widths up to 760px, the hero now flows naturally: the compact diagram follows the actual title and CTA, measures 152–172px, and contains a small cube and a single connector on a quiet dark backdrop. The tall fixed minimum hero height is removed, section vertical gaps are reduced and headings wrap safely. Between 761–1200px, the same compact decoration moves below all hero text to prevent overlap observed in landscape/tablet widths.

The only English source HTML change is the CSS cache query, checked byte-for-byte against its prior version. The 20 non-English homepage review-pin hashes were updated to refer to that exact English source blob without touching translations. The live demonstration, locale picker, videos, SEO, Unity code, and existing product claims remain unchanged.

Acceptance: HTML source review pins, full Pages build, responsive geometry at 360/390/832/1024px, keyboard navigation, and actual published CSS verified after merge. This is a layout repair, not a new collaboration feature.
