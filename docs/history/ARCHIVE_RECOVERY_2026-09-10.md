# TeamForge archive recovery audit — 2026-09-10

> Historical evidence only. This document records archive-preservation work performed in September 2026. It is **not** a current capability, support, compatibility, or release-readiness source of truth. Use `docs/STATUS.md` and `release-contract.json` for current state.

## Purpose

A preservation audit compared surviving TeamForge artifacts across local Codex output archives, ChatGPT Library records, Google Drive backups, the repository, and GitHub Releases.

The goal was to distinguish:

- artifacts that still exist but are not published as exact GitHub Release assets;
- artifacts already represented by later/privacy-sanitized GitHub assets;
- historical documents and checksums that survive independently of a binary;
- artifacts whose original bytes are genuinely lost.

Original local/Drive evidence is retained as historical provenance. A reconstructed or privacy-sanitized archive must not be represented as byte-identical to an older artifact unless its SHA-256 proves that identity.

## Recovered artifacts not currently published as exact-name GitHub Release assets

The following artifacts were recovered from preserved Codex/Drive archives but were not found as exact-name assets in the GitHub Releases inventory during this audit:

| Artifact | Preservation state |
| --- | --- |
| `Unity-TeamForge-Phase3-v0.4.1-final.zip` | Recovered with adjacent `.sha256` in the preserved 2026-08-04 Codex outputs archive. |
| `Unity-TeamForge-Phase3-v0.4.1-hotfix1-candidate.zip` | Historical candidate identity survives with checksum/evidence; a preserved copy was recovered during the archive consolidation. |
| `Unity-TeamForge-Phase3-v0.4.1-closure.zip` | Recovered with adjacent `.sha256` in the preserved 2026-08-07 Codex outputs archive. |
| `Unity-TeamForge-Phase4.5-WP1-characterization-compile-hotfix1.zip` | Recovered with adjacent `.sha256` in the preserved 2026-08-10 Codex outputs archive. |
| `Unity-TeamForge-Phase4.5-WP7-policy-profile-resolution.zip` | Recovered with adjacent `.sha256` in the preserved 2026-08-10 Codex outputs archive. |
| `Unity-TeamForge-Phase4.5-closure.zip` | Recovered with adjacent `.sha256` in the preserved 2026-08-10 Codex outputs archive. |
| `Unity-TeamForge-UX-Bootstrap-WP3.5-runtime-discovery-packaging-security-foundation-win-x64-candidate.zip` | Recovered with adjacent `.sha256` in the preserved 2026-08-13 Codex outputs archive. |
| `Unity-TeamForge-0.5.1-WP4-field-hotfix-win-x64.zip` | Preserved in the 2026-08-15 Codex outputs archive and Drive backup. |
| `Unity-TeamForge-0.5.1-WP4.1-guest-refresh-rejoin-hotfix-win-x64.zip` | Preserved in the 2026-08-15 Codex outputs archive and Drive backup. |
| `Unity-TeamForge-0.5.1-WP5-diagnostics-recovery-ux-win-x64.zip` | Preserved with adjacent `.sha256` in the 2026-08-15 Codex outputs archive. Historical verification identifies this WP5 candidate as 138,227,873 bytes, SHA-256 `DF9432E43F0022447596CC9B07D66E19384FC1E891F7E44A8EBF9C8EB557DD16`. |

This table is an archival publication gap list, not a recommendation to publish every historical binary unchanged. Any public backfill must first check machine-local paths, credentials, invite material, keys, tokens, private addresses, and other private data. If sanitization changes bytes, the sanitized artifact requires a new SHA-256 and must be described as a repack rather than the original byte identity.

## WP5.1 note

WP5.1 path-resilience artifacts also survive in the preserved Codex outputs. GitHub Releases already contain public WP5.1 assets, including privacy-sanitized repacks made to remove machine-local Windows path fixtures. Those public repacks intentionally have different whole-archive hashes from earlier local artifacts. Both forms are useful evidence for different purposes:

- preserved local/Drive copies retain development provenance;
- GitHub Release copies are the public distribution artifacts for their respective tags.

Do not use an old local checksum to validate a later privacy-sanitized GitHub asset.

## Confirmed lost artifact

### `TeamForge-0.5.1-WP5-public-source-clean.zip`

**Status: LOST — original ZIP bytes unavailable.**

Surviving metadata records the expected SHA-256 as:

`98542b080acd043d67abe9c5cc1a4741ac8b1e5780a6d7bbe4ba7853b5e2a863`

The surviving cleanup report describes this artifact as a public/review source snapshot derived from `Unity-TeamForge-0.5.1-WP5-diagnostics-recovery-ux-win-x64.zip`, not as a byte-identical replacement for the tested WP5 release candidate. The cleanup included licensing-metadata changes, machine-local path/address sanitization, stronger ignore rules, and removal of generated release payloads.

The ZIP itself was not found in the checked Library, Drive archive, relevant local Codex folders, or additional local computers checked by the project owner. Its checksum and cleanup report survive, but a checksum cannot reconstruct the original bytes.

If a future copy is discovered, verify it against the SHA-256 above before changing this status. A newly recreated source snapshot must use a new artifact identity and must not be presented as the lost original.

## Preservation boundaries

- Historical records remain historical records; this audit does not rewrite old evidence to match current behavior.
- Current capability/readiness claims remain owned by `docs/STATUS.md`.
- Exact current release/runtime/protocol selections remain owned by `release-contract.json`.
- GitHub Release filenames and SHA-256 values remain the public byte-identity record for published artifacts.
- Raw logs, screenshots, local work-state, and unredacted provenance may remain Drive-only when publishing them would expose private or machine-local data.
- Backfilling historical Release assets is separate work from preserving source history in `docs/history/`.

## Follow-up

1. Privacy/secret-scan each recovered binary before any GitHub Release backfill.
2. Publish only unchanged artifacts that are safe to expose; otherwise create clearly labeled sanitized repacks with new hashes.
3. Preserve selected historical handoff/design documents in `docs/history/` only after the same privacy review.
4. Keep the lost WP5 public-source snapshot recorded as lost unless an exact SHA-256-matching copy is recovered.
