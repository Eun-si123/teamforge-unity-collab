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

## Current published candidate

The release contract currently identifies the published WP5.1 r2 candidate:

- Product version: `0.5.1`
- Release identity: `0.5.1-wp5.1-path-resilience`
- GitHub Release tag: `v0.5.1-prealpha-wp5.1-r2`
- File: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-candidate-win-x64.zip`
- SHA-256: use the hash published with that exact Release asset/sidecar
- Readiness classification: **FIELD BLOCKED**

The r2 artifact was built from its recorded pre-PR-#81 source snapshot. It contains the earlier WP5.1 path-resilience work and collaboration-race fixes through the source state documented for that publication.

### Important: current source is newer than r2

The WP5.1 core field-blocker source fixes were later merged to `main` through PR #81 on 2026-08-27.

Therefore:

- r2 remains the currently identified published historical/current-candidate artifact until it is superseded;
- **r2 is not an exact packaged representation of the post-PR-#81 source**;
- do not use r2 as proof that the merged #67/#68/#69/#70/#71 source fixes passed packaged physical field closure;
- a post-fix field-closure candidate must be rebuilt and published as a new immutable artifact with its own exact hash.

See [docs/STATUS.md](../docs/STATUS.md) for the current source/readiness distinction.

## Superseded

`superseded/` records builds that are intentionally retained for historical/debugging value but **must not be presented as current downloads**.

Known WP5.1 superseded artifact classes include:

- early path-resilience ZIPs superseded because release/verifier identity still referred to the older WP5 line;
- replacement final ZIPs superseded when fresh-extraction validation still carried obsolete project-state assertions;
- the candidate previously published under `v0.5.1-prealpha-wp5.1`, superseded by r2;
- any pre-sanitization byte variant replaced for distribution by a privacy-sanitized archive.

If superseded archives are retained in Releases, label them clearly as **SUPERSEDED — DO NOT USE** and preserve their exact historical hashes where available.

When a future post-fix candidate replaces r2, move r2 into the same explicit superseded/historical classification rather than rewriting its identity.

## Historical

`historical/` is for older milestone builds that were valid for their own point in development but are no longer the current candidate. Historical artifacts may be valuable for reproducibility or regression investigation, but are not current supported downloads.

## Storage policy

- Source history belongs in Git commits and tags.
- Current candidate and milestone binaries belong in GitHub Releases.
- Every published binary used as evidence should have an exact cryptographic hash associated with those exact bytes.
- Superseded binaries may be retained when historical/debugging value justifies it, but must be clearly labeled.
- CI-only or disposable builds should normally remain temporary Actions artifacts.
- Do not commit large ZIP/runtime packages under `builds/`; this directory keeps classification metadata only.
