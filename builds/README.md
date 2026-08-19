# TeamForge build archive

This directory records how packaged TeamForge builds are classified. Large binary archives are **not committed to Git history**; publish them as assets on the corresponding GitHub Release instead.

## Current

`current/` is reserved for the currently recognized candidate for a work package or milestone.

### WP5.1 current candidate

- File: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-candidate-win-x64.zip`
- SHA-256: see the current `v0.5.1-prealpha-wp5.1` GitHub Release notes. Whole-archive hashes can change when an archive is privacy-sanitized or otherwise repacked without changing its release identity.
- Status: **AUTOMATED QUALIFIED / FIELD BLOCKED**
- This is the only WP5.1 ZIP currently identified as the candidate deliverable.
- The 2026-08-19 privacy-sanitized repack replaces machine-local Windows test fixture paths with an equal-length generic placeholder and regenerates the affected embedded `release-manifest.json` file hashes. Product code and current/superseded classification are unchanged.

`FIELD_BLOCKED` means the candidate has automated verification evidence but still must not be described as WP5.1 CLOSED until the required Unity/two-PC field validation is completed.

## Superseded

`superseded/` records builds that are intentionally retained for historical/debugging value but **must not be presented as current downloads**.

WP5.1 superseded builds:

- `Unity-TeamForge-0.5.1-WP5.1-path-resilience-win-x64.zip`
  - Superseded because its archive verifier still carried the old WP5 release identity.
- `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-win-x64.zip`
  - Superseded because fresh-extraction repository validation still carried the old WP5 project-state assertion.

If these archives are attached to a release for preservation, label them clearly as **SUPERSEDED — DO NOT USE**.

## Historical

`historical/` is for older milestone builds that were valid for their own point in development but are no longer the current candidate, such as prior WP releases retained for reproducibility or regression investigation.

## Storage policy

- Source history belongs in Git commits and tags.
- Current candidate and milestone binaries belong in GitHub Releases.
- Superseded binaries may be retained in Releases when their historical/debugging value justifies it, but must be clearly labeled.
- CI-only or disposable builds should normally remain temporary Actions artifacts rather than permanent repository files.
- Do not commit large ZIP/runtime packages under `builds/`; the repository keeps only classification metadata here.
