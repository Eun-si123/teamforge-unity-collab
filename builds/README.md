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

The latest immutable Windows pre-release candidate is **r8**, published on 2026-10-10:

- Product version: 0.5.1
- Release identity: 0.5.1-wp5.1-path-resilience
- GitHub Release tag: v0.5.1-prealpha-wp5.1-r8
- Source/tag commit: 4aff5756329c2fe013d78344859e0760c6a382ef
- File: Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r8-win-x64.zip
- SHA-256: 3a003791043c067009250bf59da4d916e75eb6dc1b1ed0e93d54984a2d23eb21
- Readiness: **FIELD BLOCKED**

The [r8 Release](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r8) records that exact source commit and SHA-256. The manual publisher's Windows packaging/verification passed. [Exact Release Validation run 38019297086](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/38019297086) also **passed** after downloading the published ZIP, checking its cryptographic identity, manifest/extraction, Runtime/Launcher and Windows path/junction validation. No exact-r8 physical two-PC Host/Guest test has been recorded yet.

r8 includes the previously packaged r7 Guest managed-root retry fix plus the post-r7 [PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) recovery source changes (truthful Host Direct-Seed health, verified Existing-Active execution alias, nested managed-root refusal). These fixes have package-level automated evidence, **not** a proven physical repair of the earlier r7 field symptoms. Preserve r7, r6 and r5 evidence for their own immutable bytes and exercised scenarios.

## r8 versus current source

r8 is immutable and targets commit 4aff5756329c2fe013d78344859e0760c6a382ef. Later changes on main, including SceneView warning PR #217 and transfer measurement PR #219, are **not** in the r8 ZIP. Do not attribute later source changes or future field results to r8 without exact artifact evidence.

Changes on current main do not retroactively change the r8 package bytes or previously recorded evidence. The existing r7 tag, ZIP, SHA-256 and past physical observations remain unchanged. A future repack must use a new release identity, never overwrite r7 or r8.

## Earlier candidates and superseded builds

Older published candidates remain useful for historical reproducibility and regression investigation, but they are not the latest packaged candidate once r8 exists.

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
