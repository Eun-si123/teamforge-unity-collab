# STATUS localization review — 2026-11-21

Scope: documentation PR #588, English `docs/STATUS.md` source
`cd44b3e6801ab4801aeed0f37005a9b9e668a2ed` → `4004d8c7937da93990fc5cf46d61c2d9010a940d`.

This is a **scoped semantic compatibility review**, not a complete new
translation or native-speaker certification.

- The English source change adds dated, already-merged M1–M4 progress,
  security/input-validation fixes, unmerged M4 recovery/M5 PR links, and the
  remaining actual physical-Windows/package test plan. It does **not** change
  the r10 published artifact, existing r9/r10 physical two-PC reports, or
  **FIELD BLOCKED** readiness.
- Compared all **20** homepage manifests' status-related navigation
  and links; they refer to the canonical status but do not repeat newly added
  detailed PR claims. No localized homepage copy requires a wording change.
- Inspected all **15** localized STATUS preview summaries declared in
  `site/i18n/locales.json` against the source update. Every page explicitly
  remains dated **2026-11-20**, links readers to canonical current English
  source, and retains the relevant M4, r10 and FIELD BLOCKED boundaries. None
  purports to be a full translation of the newly added 2026-11-21 section.
- The dated source addition does not contradict the existing translated
  high-level claims; advanced only those precise English-source review pins.
  No translation quality claim or readiness promotion is made.
- Any future change to the readiness verdict or supported/packaged feature
  surface needs a new locale review and possibly updated translations.

Validation: `python3 scripts/verify_localized_doc_revisions.py .`,
`python3 scripts/verify_site_locale_data.py .`, `npm run validate:docs`,
and GitHub Pages CI. This review is limited to source-to-summary consistency,
not real-device evidence.
