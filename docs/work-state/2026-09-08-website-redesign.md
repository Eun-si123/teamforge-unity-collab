# Website redesign — 2026-09-08

Historical implementation plan and evidence record; not current product status.

## Problem and outcome

The homepage combines a static editor illustration, a second interactive editor,
prototype capture, duplicated readiness tables, generated release facts, history,
origin and localization policy. Navigation hides links on phones. The Docs link
opens documentation maintenance rather than a reader-oriented documentation hub.
The intended outcome is a concise product explanation and a consistent static
website with progressive access to evidence, status and technical detail.

## Scope, risk and invariants

Medium UX/build risk. Change site sources, website generators, translations and
website-specific checks. Unity, Server, Project Peer, Launcher, protocol, release
identity, readiness and physical field gates remain out of scope.

STATUS owns readiness; release-contract.json owns exact selections; HOW_IT_WORKS
owns conceptual behavior; architecture.md owns topology; existing Markdown owns
technical pages. Generated HTML and text mirrors remain generated. Keep public
URLs, indexed locale equivalence, preview noindex, feeds and machine interfaces.
No production-readiness, arbitrary synchronization, automatic Internet P2P or
independent-audit claims. A browser illustration is not Unity field evidence.

## Design and documentation plan

Retain static Python/HTML/CSS/JS stack. Home: short product hero, direct A/B
interaction, adjacent actual Unity capture, four bounded capabilities, version
control positioning, generated compact preview warning and source/contribution.
Add /docs/ task-oriented hub and /about/ origin. Retain /documentation/ as the
maintenance guide. Add /contributing/ from existing policy. Detailed status and
history stay in their existing owning routes; machine resources move into a
compact footer disclosure and docs hub. Preserve legacy home fragment targets
as useful onward links, not duplicate sections.

Shared neutral warm-light/charcoal-dark visual foundation, restrained green
accent, readable system typography, rules rather than card grids. Demo retains
Three.js as opt-in enhancement; obvious keyboard/touch controls explain mirrored
transforms and ownership. Mobile keeps a visible A/B state summary.

No new canonical product document. New routes are navigational views over
existing owners. Propagate them to project metadata and sitemaps. Reconcile
homepage and runtime translations and advance exact reviewed source pins only
after reviewing changed copy. Untranslated technical pages must not switch to
an unrelated homepage; offer only real translated equivalents.

## Evidence required

Build using the real Pages workflow command. Run docs, engineering, workflow,
public-source, locale and agent/discovery checks. Add focused checks for new
route reachability, source-backed status, shared navigation and locale parity.
Actual browser review: desktop/mobile, both themes, demo and fallback, evidence
video, navigation and language equivalence, docs, keyboard and reduced motion.
Check internal links, browser logs and overflow. Save before/after screenshots.
No Unity/physical test evidence is needed or claimed for this website-only work.

## Rollback

One isolated Git branch. Revert website changes as a group if build or navigation
fails; canonical product and release sources remain usable throughout.

## Research

Official sites reviewed on 2026-09-08:
- https://yjs.dev/ — direct collaboration demonstration and docs/source access;
  do not copy decentralized product semantics into TeamForge's authority model.
- https://tauri.app/ — concise orientation, obvious guides versus reference;
  avoid installation promises before TeamForge's field gate closes.
- https://gitbutler.com/ and https://docs.gitbutler.com/overview — actual tool UI,
  feature-to-doc links and compatibility positioning; avoid benchmark claims.
- https://www.partykit.io/ — short concrete workflow and separate deeper docs;
  do not imply hosted deployment or automatic Internet connectivity.
- https://linear.app/ — precise hierarchy and product UI as primary imagery;
  avoid its enterprise sales structure, testimonials and long marketing funnel.

Completion evidence will be appended after implementation.

## Implemented information architecture

| Public route | Responsibility and source |
| --- | --- |
| `/`, `/ko/`, `/zh-hans/` | Product orientation, browser illustration, actual Unity capture, bounded capabilities, short workflow and source CTA. Chinese remains a noindex preview. |
| `/status/` (+ Korean/Chinese equivalents) | Readiness, supported/stabilizing/planned areas, field blockers and exact candidate boundaries from STATUS. |
| `/how-it-works/` (+ Korean/Chinese equivalents) | Human process explanation from HOW_IT_WORKS; diagrams are optional enhancements of canonical diagram source. |
| `/architecture/` | As-built topology and trust boundaries from architecture.md. |
| `/docs/` (new) | Task-oriented entry points: understand, evaluate, build/contribute. Links to the complete canonical docs map. |
| `/source/`, `/test-lab/` | Existing build workflow and named validation scenarios. |
| `/engineering/`, `/documentation/` | Existing contributor engineering and documentation-maintenance guides. The latter is no longer mislabeled as the reader's Docs hub. |
| `/changelog/` | Existing product/package milestones and links to deeper history. |
| `/about/` (new) | Stable origin/philosophy and links to history, authors and localization; site/about.md owns this website copy. |
| `/contributing/` (new), `/security/` | Generated views of existing .github policies; no independent security/readiness claims. |

All existing public routes remain. Legacy homepage fragments `history`, `why`,
`language` and `project-facts` remain useful onward links/disclosure targets.
Machine mirrors, module/history text, feeds, verification tokens, robots and
sitemap surfaces retain their original roles. The result has 19 human pages and
49 source-aware sitemap URLs (the sitemap also covers machine resources).

## What stayed on Home, and what moved

The hero answers what/where/open-source/preview immediately. One interactive
illustration establishes shared state; the adjacent real development capture
establishes that a prototype exists. Four short capability descriptions make the
supported scope legible. The source-control positioning and three-step workflow
explain the between-commits use case. The warning is generated from project.json,
which remains derived from STATUS. Source and contribution links finish the path.

Removed the redundant static hero editor, full visible project/release-facts
block, status tables, development timeline, origin section and localization
policy section. Their detailed information remains with the owners above. AI
resources are in a compact footer disclosure and Docs rather than the main
product story. No new download/readiness, customer, performance or security
claim was introduced.

## Visual and interaction decisions

- Shared warm neutral light and green-charcoal dark palettes; system fonts,
  consistent content width, rules and restrained green accents. No new logo,
  decorative image generation, framework, font download or animation framework.
- Both themes have explicit text/surface/border/status tokens. System preference
  is applied in the head before painting, manual choice persists, and other tabs
  follow changes. The light palette's quieter text was darkened after contrast
  calculation; core text/accent combinations exceed 4.5:1 on their surfaces.
- Global native links/details navigation, same document language equivalents,
  no fake unavailable translations. A one-language document shows a language
  label rather than a search menu with one entry.
- Reading pages share header/footer, typography, code, scrollable tables,
  warnings and a desktop TOC that moves above the article on small screens.
  Preserve old heading fragments while giving each page one H1. Fixed original
  raw GFM warning markers, underscore emphasis and nested code-link placeholders.
- Diagram source remains available. Mermaid loads only on request, uses strict
  rendering, updates with theme, and displays wide flowcharts top-down for
  readable labels without changing canonical topology. Wide diagrams can scroll.

## Browser illustration changes

The default controls are immediately usable: Move Cube +1, Try Editor B, Lock
and Reset. Both positions and small Scene-like grids are visible together, even
on mobile. The peer attempt demonstrates a refused edit while A owns the Cube.
Native buttons, aria-pressed and live announcements support keyboard use.

The existing Three.js shared model, two Editors, hierarchy/inspector/gizmos,
local cameras and object actions remain. Loading is explicit. Added a permanent
A/B position/ownership summary, direct move action, labeled inspector axes,
mobile Editor switching and more complete reset. Rendering draws only dirty,
visible editors, caps DPR at 1.5, and avoids shadows/damping. GPU or module failure
retains the working lightweight DOM, including its event listeners. Partial
renderer initialization also restores that fallback and disposes allocations.

The real Unity WebM/MP4 is still separate evidence. Added a frame taken from that
same capture as a poster. Native video controls replace autoplay and looping;
preload is none. The existing GIF remains an explicit fallback link.

## Discovery, performance and ownership

Canonical/OpenGraph/structured data and locale metadata remain generated. The
new routes were added to project documentation links, semantic/XML sitemaps and
Markdown-mirror mappings. Existing release identity, source hashes, indexability,
feeds and current-document propagation validators remain enforced. Exact
homepage translation review pins were advanced after copy review; Chinese
preview exclusion remains unchanged.

The generated English homepage fell from 54,724 to 20,174 bytes (about 63% less;
gzip approximately 14.0 KB to 5.2 KB). This is an HTML-size measurement, not a
Core Web Vitals benchmark. Shared CSS is slightly larger after adding the common
reading system, but replaces overlapping inline/page-specific presentation.
The 109 KB capture poster is an additional resource. Three.js and Mermaid are
opt-in CDN resources; video payload is user-triggered. Existing unused CSS URLs
were retained for compatibility but removed from the active dependency chain.

## Validation and evidence

Rebased onto main `9aebe26` (the unrelated #157 project-identity fix), preserving
that change without modifying its application files.

Passed locally:

- Exact Pages workflow build and complete output-verification shell step.
- Agent/discovery validation: required mirrors, release identity, translated
  routes, canonical metadata, feeds and 49 sitemap URLs.
- New experience validator: all 19 human routes, one H1, local assets,
  internal links/fragments, fallback controls and video loading/controls.
- 10 Node tests: locale selection and illustration ownership/reset behavior.
- 3 Python rendering regressions: inline-code links, warning/emphasis, escaping.
- Documentation, engineering, Actions-policy and public-source validators;
  JavaScript/Python syntax and git whitespace checks.

Actual Chrome rendering and interactions:

- Homepage full-page and first-screen review, light and dark, theme persistence.
- Responsive iframe viewports: 320, 390, 768, 1024 and 1440 CSS pixels. The
  browser reserves 15 pixels for scrollbars. No horizontal document overflow
  in measured cases; a 320px navigation overflow was found and fixed.
- Korean mobile menu, Escape dismissal, Enter activation, A/B move, ownership
  denial and reset. Korean/English same-document language navigation and browser
  back/forward verified. Chinese preview checked at mobile width.
- Status, How it works, Architecture, Docs, Changelog, Security, Contributing
  and Source rendered at mobile width in both themes: scroll width equaled
  client width, and each exposed one H1. Desktop reading pages were also inspected.
- Actual Unity capture played to 0:21 / 0:33 using native controls; pause control
  remained available. The poster and local video links resolved.
- Canonical How-it-works diagram actually rendered; layout and theme were reviewed.
- WebGL-unavailable path actually exercised. Final fallback produced no site
  console error. Browser-extension metadata errors were present and are unrelated
  to TeamForge; earlier Three context errors led to the native preflight fix.

Screenshots in `assets/website-redesign-2026-09-08/` are browser captures of the
baseline built site and redesigned site. Mobile captures use constrained iframe
viewports, not a claim of physical Android/iOS testing.

## Remaining limitations and next checks

- The supplied browser disables WebGL. The revised 3D path has model tests and
  syntax/source review, but GPU rendering, gizmo dragging and mobile touch
  behavior still need a real WebGL-capable browser pass before merge. This is
  why the change is delivered for review rather than advertised as deployed.
- Reduced-motion CSS removes transition/scroll animation and video no longer
  autoplays. The browser API exposes no OS media-preference emulation; an actual
  reduced-motion environment was not tested. No screen-reader or physical-device
  certification, Lighthouse score, FPS or measured CLS claim is made.
- Canonical technical documents remain long and the dependency-free Markdown
  renderer is deliberately limited. This redesign improves reading/navigation,
  not the owners' technical substance. More translations require maintained
  source review rather than an automatic translation expansion.
- Optional Three/Mermaid still depend on their pinned public CDN. Their failure
  paths retain human-readable content. Self-hosting them is a possible future
  supply-chain/offline choice, not a dependency added to this small-site change.

## Changed implementation groups

`site/index.html`, shared theme/navigation, both demo scripts and active demo CSS,
locale picker/manifests/runtime dictionaries, capture poster and site/about.md;
Python homepage/document/discovery/sitemap generators and their checks;
Pages CI's extra experience tests; package.json's dependency-free local preview
command; localization/website-maintenance notes. Runtime, Unity, Server, Project
Peer, Launcher, release-contract.json and canonical readiness content are unchanged
by this branch.
