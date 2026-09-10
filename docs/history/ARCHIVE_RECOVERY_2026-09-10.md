# TeamForge archive recovery audit — 2026-09-10

> Historical evidence only. This document records archive-preservation work performed in September 2026. It is **not** a current capability, support, compatibility, or release-readiness source of truth. Use `docs/STATUS.md` and `release-contract.json` for current state.

## Purpose

A preservation audit compared surviving TeamForge artifacts across local Codex output archives, ChatGPT Library records, Google Drive backups, the repository, and GitHub Releases.

The goal was to distinguish:

- artifacts that still exist but are not published as exact GitHub Release assets;
- artifacts already represented by later/privacy-sanitized GitHub assets;
- historical documents and checksums that survive independently of a binary;
- artifacts whose exact original bytes are genuinely lost or not currently recovered.

Original local/Drive evidence is retained as historical provenance. A reconstructed or privacy-sanitized archive must not be represented as byte-identical to an older artifact unless its SHA-256 proves that identity.

## Recovered artifacts not currently published as exact-name GitHub Release assets

The following artifacts were found in preserved Codex/Drive archives but were not found as exact-name assets in the GitHub Releases inventory during this audit. Some now have separately named public privacy-sanitized repacks; those repacks do not change the historical artifact's byte identity.

| Artifact | Preservation state |
| --- | --- |
| `Unity-TeamForge-Phase3-v0.4.1-final.zip` | Exact historical inner ZIP recovered with matching adjacent `.sha256` in the preserved 2026-08-04 Codex outputs archive. Historical SHA-256: `F780C825A87321E81130B21DBDDBAAA260C70FE9278FDF9B3AA544D6C289E41F`. A separately named privacy-sanitized public repack is published. |
| `Unity-TeamForge-Phase3-v0.4.1-hotfix1-candidate.zip` | **Exact whole-archive bytes are not currently recovered.** Surviving historical evidence records size `375,897` bytes and SHA-256 `9DE6ABFA6E4C91787513CF76316B262B8F90B9DCA779BC41C0E1876200EF024F`. A Drive copy with the same filename is `376,058` bytes and SHA-256 `E6B7F4B7FEE6D80E7E9CFE8EC916681D32EB81286AA04D92CABE2EFCB3C5F610`; it has the same 176-file set, with three work-state files differing by machine-path sanitization. The surviving per-file manifest preserves the original hashes, but rebuilding the file set does not prove the original ZIP byte stream. |
| `Unity-TeamForge-Phase3-v0.4.1-closure.zip` | Exact historical inner ZIP recovered with matching `.sha256` in the preserved 2026-08-07 Codex outputs archive. SHA-256: `56C02EC6700E9750AB7E4594B6863825FAA43EE5479A5FFCEA398FB1B751368B`. A separately named privacy-sanitized public repack is published. |
| `Unity-TeamForge-Phase4.5-WP1-characterization-compile-hotfix1.zip` | Exact historical inner ZIP recovered with matching `.sha256` in the preserved 2026-08-10 Codex outputs archive. SHA-256: `979E7AD88CAEDF93E04758A813B57AA2CDB5CA86BFA36D9ED68A71F5F675F26E`. A separately named privacy-sanitized public repack is published. |
| `Unity-TeamForge-Phase4.5-WP7-policy-profile-resolution.zip` | Exact historical inner ZIP recovered with matching `.sha256` in the preserved 2026-08-10 Codex outputs archive. SHA-256: `3D203F86B6AB9F3E23905F2BEC25D3FD23C0A3616A232A6B0EFAF40D68035D4B`. A separately named privacy-sanitized public repack is published. |
| `Unity-TeamForge-Phase4.5-closure.zip` | Exact historical inner ZIP recovered with matching `.sha256` in the preserved 2026-08-10 Codex outputs archive. SHA-256: `859D0806238A588187D76A14E4575CE04E2E1348CFA7DB4F6CF68CEA2571987D`. A separately named privacy-sanitized public repack is published. |
| `Unity-TeamForge-UX-Bootstrap-WP3.5-runtime-discovery-packaging-security-foundation-win-x64-candidate.zip` | Exact historical inner ZIP recovered from the preserved 2026-08-13 Codex outputs archive with matching adjacent `.sha256`. Historical SHA-256: `CA63E45C42EA44E8D59A85A482DCAD2E1F2264A2EC4B71369B91E8E8980DC509`. A separately named privacy-sanitized public repack is published. |
| `Unity-TeamForge-0.5.1-WP4-field-hotfix-win-x64.zip` | Historical/Codex evidence survives, and a prior privacy-sanitized archival copy is preserved separately. A newly named public repack derived from the preserved sanitized archival copy is published. This publication does **not** establish recovery of an older exact historical ZIP byte stream. |
| `Unity-TeamForge-0.5.1-WP4.1-guest-refresh-rejoin-hotfix-win-x64.zip` | Historical/Codex evidence survives, and a prior privacy-sanitized archival copy is preserved separately. A newly named public repack derived from the preserved sanitized archival copy is published. This publication does **not** establish recovery of an older exact historical ZIP byte stream. |
| `Unity-TeamForge-0.5.1-WP5-diagnostics-recovery-ux-win-x64.zip` | Preserved with adjacent `.sha256` inside the 2026-08-15 Codex outputs archive. Historical verification identifies this WP5 candidate as `138,227,873` bytes, SHA-256 `DF9432E43F0022447596CC9B07D66E19384FC1E891F7E44A8EBF9C8EB557DD16`. It has not yet been individually extracted and prepared for public backfill. |

This table is an archival publication-gap list, not a recommendation to publish every historical binary unchanged. Any public backfill must first check machine-local paths, credentials, invite material, keys, tokens, private addresses, and other private data. If sanitization changes bytes, the sanitized artifact requires a new filename/SHA-256 and must be described as a repack rather than the original byte identity.

## Privacy-sanitized historical backfill published

Eight separately named public-backfill repacks and eight `.sha256` sidecars were uploaded to the existing `TeamForge` Historical Builds prerelease on 2026-09-10. These are **new byte-level artifacts** and must not be treated as byte-identical replacements for historical originals.

For the first five entries below, exact historical inner ZIPs were recovered from preserved Codex outputs and retained privately; their public repacks remove machine-local work-path material. For the WP3.5 candidate, the exact historical inner ZIP was likewise recovered and verified before preparing the public repack. The WP4 and WP4.1 public repacks were instead derived from preserved privacy-sanitized archival copies, so their publication does not prove recovery of an older exact historical whole-archive byte stream.

| Published public repack | SHA-256 |
| --- | --- |
| `Unity-TeamForge-Phase3-v0.4.1-final-privacy-sanitized-repack.zip` | `B7E47C449C5C106D81256F64E828EFD20911C72953FD369DF8C0B848078EC4A3` |
| `Unity-TeamForge-Phase3-v0.4.1-closure-privacy-sanitized-repack.zip` | `1F41A0AC2CAF3BB34BCD29FE8BA474C79117CB6835C4DF5B0DD2DA5C057B51B9` |
| `Unity-TeamForge-Phase4.5-WP1-characterization-compile-hotfix1-privacy-sanitized-repack.zip` | `361C0394467E6F451281880C3E1F3658DF97E683576F9AC444332A1E1AEE0DC2` |
| `Unity-TeamForge-Phase4.5-WP7-policy-profile-resolution-privacy-sanitized-repack.zip` | `72E551082237A30E37D429D8777DDEF4F6273C7C3C2480AE02E3C547C4E3E1F0` |
| `Unity-TeamForge-Phase4.5-closure-privacy-sanitized-repack.zip` | `D20D8DBAAA8F7FEC1BE04EB7A19751DCB2E11A4F0641E31C95C98EA8E9890369` |
| `Unity-TeamForge-UX-Bootstrap-WP3.5-runtime-discovery-packaging-security-foundation-win-x64-candidate-privacy-sanitized-repack.zip` | `7FCE1FE13ED204C95E560A8129D5AD577CA6760D1BCFB80E618649922BC1843C` |
| `Unity-TeamForge-0.5.1-WP4-field-hotfix-win-x64-privacy-sanitized-repack.zip` | `2FF0BA49364F3BC2044428D93850C04C1B8ECA45E985164E06BBF760E629E0EA` |
| `Unity-TeamForge-0.5.1-WP4.1-guest-refresh-rejoin-hotfix-win-x64-privacy-sanitized-repack.zip` | `BDDBF4A00876531F8C1F968BC3A0D64C8EF51555D51CE6CF5E3EE927F99C052E` |

The first publication batch used a high-signal post-repack scan that found no retained real Windows user path, `/mnt/data/` or `/home/oai/` work path, Tailscale `100.x` address, PEM private-key block, GitHub/OpenAI/AWS key pattern, or literal bearer-authorization material in those five repacks. RFC1918 documentation/test examples were intentionally retained because they are examples rather than private endpoints.

The second publication batch downloaded a temporary public Drive staging set through GitHub Actions, verified each uploaded split part, reconstructed the WP4 and WP4.1 repacks, verified the reconstructed whole-file SHA-256 values, and tested all three ZIPs for structural validity. A ZIP-native scan then checked archive member data, including UTF-16LE forms, for the known machine-local literals `C:\Users\Eun`, `C:/Users/Eun`, `DESKTOP-B4146F3`, `/mnt/data/`, and `/home/oai/`; that gate passed. The workflow also refused any existing Release asset-name collision before publication.

GitHub-reported digest verification passed after both publication batches: **16/16 assets** total — eight ZIPs and eight `.sha256` sidecars. The second batch independently passed **6/6** digest comparisons after upload.

Hotfix1 is intentionally excluded from this published set because its exact historical whole-archive identity has not been recovered.

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

1. Individually extract and prepare `Unity-TeamForge-0.5.1-WP5-diagnostics-recovery-ux-win-x64.zip` with the same privacy/identity discipline before any public backfill.
2. Preserve selected historical handoff/design documents in `docs/history/` only after privacy review.
3. Keep the lost WP5 public-source snapshot recorded as lost unless an exact SHA-256-matching copy is recovered.
