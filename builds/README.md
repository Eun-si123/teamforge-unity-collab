# TeamForge build archive

This directory records how packaged TeamForge builds are classified. Large binary archives are **not committed to Git history**; publish them as assets on the corresponding GitHub Release instead.

## Identity rules

TeamForge distinguishes **product/work-package identity** from **byte-level artifact identity**:

- Product version identifies the compatible product line, for example `0.5.1`.
- Release/work-package identity identifies the candidate lineage, for example `0.5.1-wp5.1-path-resilience`.
- A packaged ZIP is identified by its exact filename plus SHA-256. **If the bytes change, the artifact identity changes, even when the product version and work-package lineage stay the same.**
- A privacy sanitization, metadata correction, bug fix, or other repack therefore produces a replacement artifact with a new SHA-256. Do not describe two different archive hashes as the same immutable artifact.
- Once a particular ZIP/SHA-256 pair is published as evidence, treat that byte-level artifact as immutable. Replace/supersede it rather than silently changing what its hash is supposed to identify.

This distinction lets TeamForge retain one work-package lineage while still preserving unambiguous supply-chain evidence for the exact bytes a tester or user received.

## Current

`current/` is reserved for the currently recognized candidate for a work package or milestone.

### WP5.1 current candidate

- Product version: `0.5.1`
- Release identity: `0.5.1-wp5.1-path-resilience`
- GitHub Release tag: `v0.5.1-prealpha-wp5.1-r2`
- File: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-candidate-win-x64.zip`
- SHA-256: use the hash published with the candidate asset/sidecar in the `v0.5.1-prealpha-wp5.1-r2` GitHub Release. The filename alone is not sufficient artifact identity.
- Status: **AUTOMATED QUALIFIED / FIELD BLOCKED**
- This is the only WP5.1 ZIP currently identified as the candidate deliverable.
- The r2 candidate is rebuilt from current `main`: it retains the WP5.1 Windows path-resilience / managed short-workspace implementation and includes the later Transform/Hierarchy reconciliation and lock-contention recovery fixes merged through PR #57.
- The 2026-08-19 privacy-sanitized repack replaced machine-local Windows test-fixture paths with an equal-length generic placeholder and regenerated the affected embedded `release-manifest.json` file hashes. Product code and the WP5.1 release lineage were unchanged, but the repacked ZIP is a distinct byte-level artifact and therefore has its own SHA-256.

`FIELD_BLOCKED` means the candidate has automated verification evidence but still must not be described as WP5.1 CLOSED until the required Unity/two-PC field validation is completed.

## Superseded

`superseded/` records builds that are intentionally retained for historical/debugging value but **must not be presented as current downloads**.

WP5.1 superseded builds:

- `Unity-TeamForge-0.5.1-WP5.1-path-resilience-win-x64.zip`
  - Superseded because its archive verifier still carried the old WP5 release identity.
- `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-win-x64.zip`
  - Superseded because fresh-extraction repository validation still carried the old WP5 project-state assertion.
- The candidate published under `v0.5.1-prealpha-wp5.1`
  - Superseded by `v0.5.1-prealpha-wp5.1-r2`, which is rebuilt from current `main` after the Long Path/path-resilience source synchronization and the PR #57 collaboration race fixes. Preserve the old asset/hash as historical evidence; do not overwrite it.
- Any pre-sanitization byte variant of the final-candidate archive
  - Superseded for distribution when a privacy-sanitized replacement was published. Preserve its old hash only as historical evidence if needed; never reuse that hash for the replacement bytes.

If these archives are attached to a release for preservation, label them clearly as **SUPERSEDED — DO NOT USE** and retain their exact hashes when available.

## Historical

`historical/` is for older milestone builds that were valid for their own point in development but are no longer the current candidate, such as prior WP releases retained for reproducibility or regression investigation.

## Storage policy

- Source history belongs in Git commits and tags.
- Current candidate and milestone binaries belong in GitHub Releases.
- Every published binary used as evidence should have an exact cryptographic hash associated with the exact bytes.
- Superseded binaries may be retained in Releases when their historical/debugging value justifies it, but must be clearly labeled.
- CI-only or disposable builds should normally remain temporary Actions artifacts rather than permanent repository files.
- Do not commit large ZIP/runtime packages under `builds/`; the repository keeps only classification metadata here.
