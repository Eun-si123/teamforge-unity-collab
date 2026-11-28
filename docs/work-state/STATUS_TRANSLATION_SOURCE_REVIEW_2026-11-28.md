# TeamForge 2026-11-28 multilingual source-delta review for PR #644

Review scope: the English STATUS and HOW_IT_WORKS changes in #644 (source checkpoint 2026-11-26), not a new product release. The source PRs #643, #617 and #618 were independently confirmed merged, and #620 remains an open Draft. The prior canonical r11 evidence distinguishes automated exact ZIP validation from physical Windows Editor acceptance; r10 evidence remains historical. M5 remains partial (#586 and #578), and active M4-to-M5 rotation and arbitrary live Prefab sync are not complete.

The Korean STATUS and HOW_IT_WORKS already contain the corresponding changes in #644. For the 14 other published long-form locales, added a localized dated STATUS correction covering the new source checkpoint, r11 evidence versus physical/installed ZIP/soak limitations, partial M5 and remaining gaps. Explicitly marked older text as a historical snapshot subordinate to the correction; did not silently rewrite older field evidence. In each HOW_IT_WORKS translation, updated the authority lifetime table and explanatory paragraph to describe optional M4 SQLite persistence before acknowledgement, new-epoch recovery and the limits on restoring connections, locks, Presence and offline edits. These are AI-assisted factual-delta translations, not native-speaker certification or a fresh full-text translation review.

Reviewed the 20 homepage manifests against the STATUS-only source delta. Existing homepage copy contains no references to the changed PRs, r10/r11, M4/M5 or SQLite, and the underlying release and FIELD BLOCKED status are unchanged. Preserved existing localized copy and advanced only the exact STATUS review pin. Updated the registry's 15 STATUS and 15 HOW_IT_WORKS reviewed-source pins after the source-delta edits.

Local checks on the isolated PR checkout:
- Translation freshness: 60 localized document pins and 20 published homepage manifests passed.
- Replayed exact Pages build and discovery verification steps: 94 human routes, 52 sitemap URLs, 43 JavaScript tests, three Python test groups (21 tests), link, feed and mirror checks passed.
- Status-live regression tests 5/5; documentation, engineering and public-source validators and diff whitespace check passed.

No Pages deployment, native-speaker review, new packaged release, Unity or physical Windows testing is claimed. The exact updated PR-head CI is still required.
