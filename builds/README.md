# TeamForge build archive

This directory records how packaged TeamForge builds are classified. Large binary archives are **not committed to Git history**; publish them as assets on the corresponding GitHub Release instead.

Current capability/release-readiness claims belong to **[docs/STATUS.md](../docs/STATUS.md)**. This file owns packaged-artifact classification and byte-identity rules. The exact identity of the latest published package is mirrored in [`published-candidate.json`](published-candidate.json) for machine validation so tooling does not need to depend on this Markdown layout.

## Identity rules

TeamForge distinguishes **product/source-line identity** from **byte-level artifact identity**:

- Product version identifies a compatible product line, for example `0.5.1`.
- Release/work-package identity identifies a source/candidate lineage.
- A packaged ZIP is identified by its exact filename plus SHA-256. **If the bytes change, the artifact identity changes**, even when the product version and work-package lineage stay the same.
- A privacy sanitization, metadata correction, bug fix, rebuild or other repack produces a replacement artifact with a new SHA-256.
- Once a ZIP/SHA-256 pair is published as evidence, treat those bytes as immutable. Supersede them rather than silently changing what the hash is supposed to identify.
- A newer source commit does **not** retroactively update an already-published ZIP.
- A packaged candidate and current `main` may share a product/release lineage while still differing in behavior. Claims about packaged behavior must follow the exact source commit and artifact identity used to build those bytes.
- `published-candidate.json` is a machine-readable mirror of the current published candidate identity, not a replacement for Release evidence. It must agree with this section, `docs/STATUS.md`, and the live GitHub Release metadata.

## Current published candidate

The latest published post-r6 field-fix candidate is:

- Product version: `0.5.1`
- Release identity: `0.5.1-wp5.1-path-resilience`
- GitHub Release tag: `v0.5.1-prealpha-wp5.1-r7`
- Source/tag commit used for publication: `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- File: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256: `a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- Readiness classification: **FIELD BLOCKED**

r7 contains the full r6 stabilization set and the Guest retry fix found during the first physical r6 field pass. In particular, a Windows v2 `project-identity.lock` compatibility fence created by TeamForge is now recognized as managed metadata only when it is the exact bounded TeamForge-owned fence shape; malformed, modified, linked, oversized, or incompatible content remains fail-closed.

The published r7 ZIP passed Exact Release Validation run `37118580632` after publication. That lane downloaded the Release asset, verified the recorded SHA-256 and every release-manifest file hash, extracted under a Korean/space-containing path from a foreign working directory, re-ran the staged public/source contract, verified the bundled Runtime/Node and Launcher fail-closed behavior, and exercised the exact-candidate Windows path-resilience/real-junction checks.

That is **exact-package automated evidence**, not physical two-PC field evidence. The r6 field pass already exercised Host authentication gating, external-local-package refusal, firewall onboarding to Host Ready, and exposed the Guest retry defect that r7 fixes. The separate Coordinator handshake timeout and the remaining LAN/process-loss/realtime checks still require physical field evidence owned by `docs/STATUS.md`.

The exact r5 ZIP/SHA pair remains valid historical physical evidence for the scenarios exercised on two Windows PCs on 2026-08-31. The exact r6 ZIP remains valid historical package evidence for the field pass that exposed the retry defect. Publishing r7 does not rewrite either artifact or its evidence.

## r7 versus current source

r7 is immutable and targets source commit `d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`. At this status update, later commits on `main` are repository/agent-governance and CI-routing changes rather than TeamForge runtime behavior, but they still do not retroactively change r7 bytes.

That means:

- use **r7** and its exact ZIP/SHA when making claims about the latest published packaged candidate;
- preserve **r5** as exact physical evidence for the older scenarios it actually exercised and **r6** as the immutable package used to discover the Guest retry defect;
- do not treat r7 automated Release validation as proof of the still-pending two-PC networking/identity/realtime field scenarios;
- if runtime behavior changes after the r7 source commit, publish another immutable candidate before attributing those changes to packaged bytes.

Do not silently rebuild or replace the r7 tag/assets. Supersede them with a new artifact identity if another package is required.

## Earlier candidates and superseded builds

Older published candidates remain useful for historical reproducibility and regression investigation, but they are not the latest packaged candidate once r7 exists.

Known WP5.1 older/superseded artifact classes include:

- early path-resilience ZIPs superseded because release/verifier identity still referred to the older WP5 line;
- replacement final ZIPs superseded when fresh-extraction validation still carried obsolete project-state assertions;
- `v0.5.1-prealpha-wp5.1-r2`, which predates the PR #81 post-fix packaged candidate;
- `v0.5.1-prealpha-wp5.1-r3`, superseded after exact-release validation exposed stale legacy WP4 release-file requirements and a publisher native-exit-code masking bug;
- `v0.5.1-prealpha-wp5.1-r4`, which remains valid exact historical evidence for its own bytes;
- `v0.5.1-prealpha-wp5.1-r5`, which remains the exact physical-evidence package for the 2026-08-31 field scenarios but is superseded as the latest downloadable candidate by r6 and then r7;
- `v0.5.1-prealpha-wp5.1-r6`, which remains the immutable exact package used for the 2026-10-03 field pass that exposed the Guest retry defect, but is superseded as the latest downloadable candidate by r7;
- any pre-sanitization byte variant replaced for distribution by a privacy-sanitized archive.

If superseded archives are retained in Releases, label them clearly enough that users do not mistake them for the current candidate, and preserve their exact historical hashes where available.

## Historical

`historical/` is for older milestone builds that were valid for their own point in development but are no longer the current candidate. Historical artifacts may be valuable for reproducibility or regression investigation, but are not current supported downloads.

## Storage policy

- Source history belongs in Git commits and tags.
- Current candidate and milestone binaries belong in GitHub Releases.
- Every published binary used as evidence should have an exact cryptographic hash associated with those exact bytes.
- Superseded binaries may be retained when historical/debugging value justifies it, but must be clearly labeled.
- CI-only or disposable builds should normally remain temporary Actions artifacts.
- Do not commit large ZIP/runtime packages under `builds/`; this directory keeps classification metadata only.
