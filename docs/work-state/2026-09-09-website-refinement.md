# Website follow-up review — 2026-09-09

Historical change/review record, not a current readiness owner.

## Scope and ownership

Reviewed current main `0cd6e56` after reading AGENTS, agent governance,
documentation/localization and engineering guides, and the redesign record.
The small static-site refinement keeps the existing IA, themes, discovery and
progressive 3D enhancement. No application/server/Unity behavior is changed.
Canonical homepage/CSS/JS and Python renderers own presentation; generated
`.pages-site` HTML is build output. STATUS owns current readiness, compatibility
owns platform/topology requirements, release-contract owns exact selections,
HOW_IT_WORKS and architecture retain behavior/structure ownership.

## Decisions

- Implement direct horizontal Pointer Events manipulation in the lightweight
  illustration, with the existing shared X state and A-ownership rule. Retain
  buttons; add focusable sliders/arrow keys, cancel/reset capture handling and
  pan-y so the page can still scroll vertically. No physics or WebGL dependency.
- Improve Docs intent routing with compatibility, roadmap and CODEMAP links;
  add a compact Korean routing section and direct Korean document-navigation
  entry. English-only destinations are explicitly labeled. No invented locale
  routes or duplicated technical documents.
- Extend existing compatibility owner with before-testing orientation,
  unestablished resource minima and current-source Windows managed-root boundary.
- Keep long-document evidence intact; make mobile TOC sticky, bounded and
  collapsible, with section focus on navigation.
- Clarify LLM-heavy translation practice, limited owner semantic checking and
  lack of professional/native-speaker review. English authority and preview
  indexing rules remain. Chinese remains preview; no locale promotion.
- Reject adoption counters/social proof: repository engagement is not usage.
- Defer another workflow visualization: the current homepage already previews
  Host/join/collaboration and HOW_IT_WORKS has a 60-second diagram and detailed
  verification/transfer/recovery flow. Another summary would duplicate it.
- Reject a fresh visual redesign or decorative density reduction: real capture,
  quiet visual system and concise homepage still serve the project well.

## STATUS semantic review

Compared the 2026-08-30 review baseline (`7905fc5`) with current main, the
subsequent STATUS changes, release-contract and source changes. Relevant later
changes include firewall onboarding/cleanup and Seed fallback, coordinator
rejection cleanup, HTTP cancellation/deadlines, identity creation serialization,
Windows crash-releasing identity lock, diagnostics context and invite clarity.
Reviewed the identity lock's actual named-pipe/fence/legacy refusal and local
fixed NTFS/ReFS restrictions. STATUS now summarizes post-r4 source hardening;
compatibility owns storage prerequisites. No capability is promoted. r4 identity,
FIELD BLOCKED and physical/exact-artifact gates remain unchanged.

Paired Korean and preview Chinese STATUS additions preserve the source-only,
legacy-refusal and artifact-evidence distinctions. Existing full documents were
compared for those boundaries before advancing exact source pins; this is an
LLM-assisted semantic comparison, not native-speaker linguistic certification.

## Validation

Executed existing Pages build and verification from the current workflow:
19 human routes, 37 required discovery outputs, 49 sitemap URLs, release identity,
internal links/fragments/assets and update feeds passed. All four localized
long-form source pins passed. Twelve Node tests passed (eight locale tests,
two existing 3D-model tests, two new lightweight input/ownership/reset tests).
Four Python renderer tests passed, including the explicit English-link regression.
Documentation, engineering and public-source validation passed.

Actual Chrome checks: desktop light/dark; Korean 320px/390px iframe views;
320px home, Docs, STATUS and Architecture in both themes (305px content and
305px scroll width, one H1). Mouse Pointer Events dragging mirrored A to B;
locked B rejected a real drag; keyboard Home/End and reset worked. At 320px a
real pointer drag updated both values to 0.92, and End kept the Cube inside both
Scene bounds. Mobile TOC expanded/collapsed, jumped to a section and moved focus.
Korean routing and explicit English STATUS navigation worked after correcting an
existing self-link bug. Theme choice persisted across page loads. WebGL failure
retained the usable lightweight controls. No terminal.local site errors appeared
in inspected browser logs; browser-extension metadata errors were separate.

Browser QA found fixed-pixel Cube movement could clip on narrow screens; motion
now scales to each Scene width. It also found the canonical-link rewrite sent
explicit English links back to the current locale; the renderer now preserves
that language intent. The sticky TOC has extra anchor clearance.

## Remaining boundaries and tradeoffs

No physical Android/iOS, stylus, native touch-gesture arbitration, screen reader,
GPU rendering or OS reduced-motion emulation was performed. Pointer Events use
one input path and pan-y; reduced-motion CSS still removes transitions, but these
are implementation facts rather than physical-device evidence. Existing 3D
behavior and the real Unity video are preserved. No runtime/network recovery
or packaged-artifact test is claimed by this website patch.

Compatibility/roadmap/CODEMAP links intentionally use their canonical GitHub
pages instead of adding more generated routes. The Korean routing block is a
small maintained navigation aid, not a translated copy of the full English Docs
hub. Further linguistic review remains welcome. No dependencies, framework,
video assets, machine-readable routes or new readiness claims were added.
