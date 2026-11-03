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

The latest immutable Windows pre-release candidate is **r10**, published 2026-11-03 (UTC):

- Product version: 0.5.1
- Release identity: 0.5.1-wp5.1-path-resilience
- GitHub Release tag: v0.5.1-prealpha-wp5.1-r10
- Source/tag commit: 693d3a9d647f9a511012f1ebba3209834531656e
- File: Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r10-win-x64.zip
- SHA-256: 01afb269bd6235470bd75d1dda6a6c0119d0e21acea87087fe1115d0cd002f89
- Readiness: **FIELD BLOCKED** (2026-11-04 KST r10 user-reported two-PC baseline, receive/reconnect and long ASCII-special-character path PASS; full negative/recovery matrix still incomplete).

The [r10 Release](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r10) passed [Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102). Its user-reported physical Host/Guest evidence is documented in [the 2026-11-04 r10 field note](../docs/PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md), while the headless remote-access network-interruption constraint remains [#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457). This report did not independently check the installed ZIP hashes on both physical PCs. The prior r9 Release and its user-reported historical evidence are preserved. Exact byte identity remains the immutable ZIP/hash, not an unverified installed version string.

## r10 versus current source

r10 targets 693d3a9d647f9a511012f1ebba3209834531656e. Changes merged after that commit, including the [startup UX Draft PR #456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), are **not in immutable r10**. The former [r9 Release](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r9) and its SHA-256 `8f53f98ad39ac98326cc5031751648954416582714de01a1f3f379f53e8a94ea` remain separate historical evidence; r8 is also unchanged. Source CI, packaged validation and physical tests retain different evidence boundaries.

Changes on current `main` do not retroactively change immutable released ZIP bytes, and source, packaged and physical evidence must again be treated separately.

## Earlier candidates and superseded builds

The r9 candidate (`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r9-win-x64.zip`) is superseded by r10 but remains immutable; r8 and earlier candidates are also historical.

Older published candidates remain useful for historical reproducibility and regression investigation, but they are not the latest packaged candidate.

Known WP5.1 older/superseded artifact classes include:

- early path-resilience ZIPs superseded because release/verifier identity still referred to the older WP5 line;
- replacement final ZIPs superseded when fresh-extraction validation still carried obsolete project-state assertions;
- `v0.5.1-prealpha-wp5.1-r2`, which predates the PR #81 post-fix packaged candidate;
- `v0.5.1-prealpha-wp5.1-r3`, superseded after exact-release validation exposed stale legacy WP4 release-file requirements and a publisher native-exit-code masking bug;
- `v0.5.1-prealpha-wp5.1-r4`, which remains valid exact historical evidence for its own bytes;
- `v0.5.1-prealpha-wp5.1-r5`, which remains the exact physical-evidence package for the 2026-08-31 field scenarios but is superseded as the latest downloadable candidate by r6 and then r7;
- `v0.5.1-prealpha-wp5.1-r6`, which remains the immutable exact package used for the 2026-10-03 field pass that exposed the Guest retry defect, but is superseded as the latest downloadable candidate by r7;
- `v0.5.1-prealpha-wp5.1-r7`, the immutable exact package and mixed r6/r7 field evidence from 2026-10-03/04; superseded by r8 but retained for historical reproduction.
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
