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


## Mobile hero correction (2026-11-23)

User-provided Galaxy browser screenshot showed the original 340px orange geometric "EDITOR 01 / HOST", "EDITOR 02 / GUEST" cube stage consuming almost the entire second mobile screen. This was purely decorative, not a real pair of Unity Editor screenshots or the interactive Cube demo.

At <=760px, the mobile hero is now normal document flow instead of a minimum 860–980px absolutely arranged canvas. The pseudo-3D reactor, rings and cube are hidden, and the same first-party HOST and GUEST labels become a compact, accessible CSS-only two-editor relationship with a centered link arrow. The actual collaboration demonstration below is untouched. The responsive workbench footprint at a 375px CSS viewport shrank from ~340px art to ~77px summary; page hero height from ~982px to ~699px in preview.

The canonical HTML changes only in the stylesheet cache key from forged1 to forged2, with the 20 localized source pins updated after strict one-string replacement verification. No translation strings, site anchors, runtime demo, Unity code or vendor assets change. Mobile 320/360/375/390 widths and old browser cache risk are verified at release.


## Desktop fake-cube illustration replaced (2026-11-23)

The user reported the same desktop problem after showing the enormous mobile orange square labeled EDITOR 01 / HOST and EDITOR 02 / GUEST. The desktop cuboid was a decorative CSS-only element, not actual editor UI.

Above 760px, the hero now puts the title and CTA first, followed by a wide still from the **existing first-party recorded Unity collaboration development demo** (assets/teamforge-demo-poster.jpg). The old ring, fake cube and diagonal-shaped graphic are hidden; the original source image, working video and its production claims are unchanged. The narrow center crop shows the dual-editor frames instead of the letterboxed black margins. The stage retains aria-hidden because it is decorative, while the video further down has an accessible label and controls.

The first-party image was already supplied by the project; no external visuals or copyrighted superhero characters were introduced. The compact host/guest strip from PR #626 is unchanged below 761px. The English source template differs by exactly one CSS cache-version query, and all 20 published translation manifests have been repinned without modifying strings or routes.

The image is **historical development footage**, not evidence of a new successful two-Windows-PC field test.
