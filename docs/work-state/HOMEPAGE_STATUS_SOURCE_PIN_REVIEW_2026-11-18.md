# Homepage locale status-source review — 2026-11-18

Review scope: exact source SHA pin for docs/STATUS.md in the 20 existing
site/i18n/homepage.*.json landing-page manifests. This note is evidence
of a limited source-to-landing-page claim review, NOT a professional
translation review or new release/field attestation.

Source diff examined: English STATUS now records M1 PR #533 merged
to main and its real one-Editor/Node Unity CI; M2 #559 with tested
late-join PR #565 remains on a separate feature branch. The published
r10 candidate, immutable package hashes, unsupported general Components
and physical FIELD BLOCKED readiness did NOT change.

The English homepage and its localized replacements still describe an
early public preview, Presence/Hierarchy/Lock and P2P collaboration.
They do not claim M1/M2 Collider shipping, or translate any M1/M2/Collider/
Component/Inspector/r10-specific homepage phrases. No site/index.html,
Editor demo, release-contract.json or other reviewed source pin changed.
All existing translated homepage strings and metadata were preserved.
Only the one reviewed STATUS source hash was advanced for each locale.

Long-form translation review: the 15 localized status/ documents had their
reviewed English source blob advanced only after updating the obsolete M1
"PR/Unity CI pending" paragraph. For Korean the canonical paired STATUS.ko.md
was already revised; for 14 existing preview languages the paragraph now
explicitly states M1 #533 is in main and real one-Editor/Node CI passed, while
M2 #559/#565 remains on the separate M2 branch and physical two-Editor tests
and released r10 are unchanged. Each localized document retains its preview
status; translations were AI-assisted with no claim of native-speaker or
professional linguistic certification. Exact source pins attest only to this
limited factual comparison, not broad fluency or comprehensive translation.

The full GitHub Pages build and verifier step scripts were reproduced locally
from .github/workflows/pages.yml and both PASSED after these updates (including
all published locale homepages, document revision pins, feeds and 39 locale
picker regression tests). GitHub CI for this new commit must separately pass
before merging; subsequent source changes require fresh review.

## M2 merge evidence refresh (same date)

After the original review, M2 PR #559 was merged to main at 1e1054096278182a26f8849a0f847bfb8a2df330, including #565. The 15 localized STATUS documents now distinguish mainline opt-in source M2 from the immutable r10 release and unverified physical Windows two-Editor use. Their English source pins and the 20 homepage pins were updated after this factual alignment; no homepage-specific M2 shipping text was introduced. These localized updates are not professional translation certification.
