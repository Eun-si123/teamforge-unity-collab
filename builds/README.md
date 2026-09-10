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
- GitHub Release tag: `v0.5.1-prealpha-wp5.1-r5`
- Source/tag commit used for publication: `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`
- File: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`
- SHA-256: `5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`
- Readiness classification: **FIELD BLOCKED**

r5 contains the PR #81 stabilization fixes for the original #67/#68/#69/#70/#71/#74 line plus the post-r4 integration that added the Windows Launcher **Save support bundle** and its diagnostics/privacy contract.

The exact r5 ZIP/SHA pair was exercised on two physical Windows PCs on 2026-08-31. Recorded exact-package results closed the original saved-Guest reconnect, fresh late-join Transform conflict, repeated receive/shutdown-resume, long/deep-path handoff and stale lock-contention recovery blockers. The same r5 field pass also exercised packaged Host Stop/Start on Seed TCP `5091` and a real Guest transfer after firewall access existed.

**FIELD BLOCKED still matters:** r5's exact field evidence does not include behavior added later to current `main`, and the r5 LAN run still required manual firewall allowance. Current readiness and the remaining replacement-package evidence gate are owned by `docs/STATUS.md`.

## Current source is newer than r5

Current `main` has moved beyond the r5 publication commit. Later source behavior includes Windows LAN firewall onboarding/rule lifecycle work, preferred-Seed-port unavailable/collision fallback including bind-context `EACCES`, Windows Project identity crash recovery, and additional networking/diagnostics hardening.

That means:

- r5 remains immutable and valid evidence for the exact source snapshot and physical scenarios it actually exercised;
- r5 is **not byte- or behavior-equivalent to current `main`**;
- later source CI, Project Peer, Launcher or Unity tests do not become r5 package evidence merely because the product version is still `0.5.1`;
- the Launcher support-bundle path **is** present in r5 and must not be described as a current-main-only behavior relative to r5;
- if current `main` is packaged for broader distribution or the next field-closure pass, publish a new immutable candidate with a new exact filename/SHA-256 and validate the post-r5 behavior on that artifact.

Do not silently rebuild the r5 tag/assets to absorb later source changes.

## Earlier candidates and superseded builds

Older published candidates remain useful for historical reproducibility and regression investigation, but they are not the latest packaged candidate once r5 exists.

Known WP5.1 older/superseded artifact classes include:

- early path-resilience ZIPs superseded because release/verifier identity still referred to the older WP5 line;
- replacement final ZIPs superseded when fresh-extraction validation still carried obsolete project-state assertions;
- `v0.5.1-prealpha-wp5.1-r2`, which predates the PR #81 post-fix packaged candidate;
- `v0.5.1-prealpha-wp5.1-r3`, superseded after exact-release validation exposed stale legacy WP4 release-file requirements and a publisher native-exit-code masking bug;
- `v0.5.1-prealpha-wp5.1-r4`, which remains valid exact historical evidence for its own bytes but is no longer the latest candidate after r5 publication;
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
