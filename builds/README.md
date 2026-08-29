# TeamForge build archive

This directory records how packaged TeamForge builds are classified. Large binary archives are **not committed to Git history**; publish them as assets on the corresponding GitHub Release instead.

Current capability/release-readiness claims belong to **[docs/STATUS.md](../docs/STATUS.md)**. This file owns packaged-artifact classification and byte-identity rules.

## Identity rules

TeamForge distinguishes **product/source-line identity** from **byte-level artifact identity**:

- Product version identifies a compatible product line, for example `0.5.1`.
- Release/work-package identity identifies a source/candidate lineage.
- A packaged ZIP is identified by its exact filename plus SHA-256. **If the bytes change, the artifact identity changes**, even when the product version and work-package lineage stay the same.
- A privacy sanitization, metadata correction, bug fix, rebuild or other repack produces a replacement artifact with a new SHA-256.
- Once a ZIP/SHA-256 pair is published as evidence, treat those bytes as immutable. Supersede them rather than silently changing what the hash is supposed to identify.
- A newer source commit does **not** retroactively update an already-published ZIP.
- A packaged candidate and current `main` may share a product/release lineage while still differing in behavior. Claims about packaged behavior must follow the exact source commit and artifact identity used to build those bytes.

## Current published candidate

The latest published post-fix WP5.1 candidate is:

- Product version: `0.5.1`
- Release identity: `0.5.1-wp5.1-path-resilience`
- GitHub Release tag: `v0.5.1-prealpha-wp5.1-r4`
- Source commit used for publication: `5fdebda8c91e3c858e894356eb4bb735bbc34885`
- File: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-candidate-win-x64.zip`
- SHA-256: `390ecbe4dad9488acdd992cc7198b25bf6407debf050d78385b01e076275c030`
- Readiness classification: **FIELD BLOCKED**

r4 was rebuilt from patched `main` after PR #81 integrated the #67/#68/#69/#70/#71 and #74 stabilization fixes. It remains the exact published candidate for the remaining physical Windows field-closure scenarios associated with those fixes.

**FIELD BLOCKED still matters:** publishing an exact ZIP and SHA establishes artifact identity, not physical two-PC correctness. The remaining physical scenarios are owned by `docs/STATUS.md` and the corresponding GitHub issues.

## Current source is newer than r4

Current `main` has moved beyond the r4 publication commit. The post-r4 integration work includes repository/documentation/test infrastructure **and an actual Launcher behavior change**: the manual privacy-safe **Save support bundle** path plus its diagnostics safety contract.

That means:

- r4 remains immutable and valid evidence for the exact source snapshot from which it was built;
- r4 is **not** byte- or behavior-equivalent to current `main`;
- post-r4 source CI or Launcher tests do not become r4 package evidence merely because the product version is still `0.5.1`;
- if current `main` is packaged for distribution or field closure, publish a new immutable candidate with a new exact filename/SHA-256 and validate that artifact on its own.

Do not silently rebuild the r4 tag/assets to absorb later source changes.

## Superseded

`superseded/` records builds that are intentionally retained for historical/debugging value but **must not be presented as current downloads**.

Known WP5.1 superseded artifact classes include:

- early path-resilience ZIPs superseded because release/verifier identity still referred to the older WP5 line;
- replacement final ZIPs superseded when fresh-extraction validation still carried obsolete project-state assertions;
- `v0.5.1-prealpha-wp5.1-r2`, which predates the PR #81 post-fix packaged candidate;
- `v0.5.1-prealpha-wp5.1-r3`, superseded after exact-release validation exposed stale legacy WP4 release-file requirements and a publisher native-exit-code masking bug;
- any pre-sanitization byte variant replaced for distribution by a privacy-sanitized archive.

If superseded archives are retained in Releases, label them clearly as **SUPERSEDED — DO NOT USE** and preserve their exact historical hashes where available.

## Historical

`historical/` is for older milestone builds that were valid for their own point in development but are no longer the current candidate. Historical artifacts may be valuable for reproducibility or regression investigation, but are not current supported downloads.

## Storage policy

- Source history belongs in Git commits and tags.
- Current candidate and milestone binaries belong in GitHub Releases.
- Every published binary used as evidence should have an exact cryptographic hash associated with those exact bytes.
- Superseded binaries may be retained when historical/debugging value justifies it, but must be clearly labeled.
- CI-only or disposable builds should normally remain temporary Actions artifacts.
- Do not commit large ZIP/runtime packages under `builds/`; this directory keeps classification metadata only.
