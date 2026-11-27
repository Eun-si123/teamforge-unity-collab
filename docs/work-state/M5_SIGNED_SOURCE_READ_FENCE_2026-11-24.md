# P1 M5 signed Project read boundary + changing-approval fence — 2026-11-24

**Scope:** Draft #620, implementation and Linux Node evidence only. This is a dated checkpoint; current status and field readiness are still owned by `../STATUS.md`.

## Problem observed

The Coordinator recovery, Collider admission and future M4→M5 signed-source preflight all read managed `project.json`, `published.json`, signed Manifest and Descriptor files through `fs.promises.readFile()` with no consistent byte cap, final-leaf link guard, pinned inode or read-time replacement check. An unexpectedly large, symlinked, FIFO-swapped or modified managed file could block safe verification, consume excessive memory or become inconsistent with the exact approved bytes. Further, a Host Publisher pointer or Guest Active could advance between initial source approval and completing an expensive Manifest/Descriptor read; the reader could otherwise return a previously approved revision as still current.

## Implementation

- `project-peer/src/stored-metadata-reader.mjs`: reusable read-only, no transport dependency; strictly bounded `64 MiB` Manifest, `256 KiB` Descriptor, `64 KiB` Project identity and `16 KiB` published pointer. Validates absolute location, non-redirected real directory chain, non-symlink regular leaf, exact size, handle `dev/ino`, `size`, `mtimeNs`, `ctimeNs` before and after a bounded one-byte-over-limit read. Uses POSIX `O_NOFOLLOW | O_NONBLOCK` to reject symlink/FIFO swaps without hanging. A replaced path fails closed and the underlying filesystem path is not echoed in generated errors. Windows relies on pre/open/post identity checks and retains platform-specific reparse/TOCTOU limitations.
- `project-peer/src/stored-publication.mjs`: all managed signed-source reads use the bounded reader; a draft descriptor directory cannot silently redirect via a symlink. After cryptographic Manifest/Descriptor checks, re-reads both Host published pointer, Guest current pointer, and Project identity; any difference fails with `stored_publication_changed` instead of returning an obsolete verified source. The read fence **does not** replace an Editor write-freeze or atomically coordinate SQLite and the managed filesystem.
- `project-peer/src/persistent-metadata.mjs`, `project-peer/src/project-peer.mjs`: publishing a content-addressed source that would exceed the reader's budget fails **before** creating any final or temporary file. Signed Descriptor writes have the tighter matching 256 KiB limit; normal signed Manifests share the 64 MiB budget. No wire protocol change, no new mandatory UI, and no enabling of M4→M5 publication.

## Specific negative evidence

- Bounded reader: oversize and empty files; final leaf symlink; ancestor directory redirect; inode replacement between `lstat` and `open`; actual Linux FIFO swap with no waiting for a writer; and a missing source error that does not echo a private local filesystem pathname.
- Publisher writer: oversized signed Descriptor rejected before canonical or temp files appear, existing approved file unchanged.
- Signed selection: a subprocess replaces `published.json` with a different canonical revision **after** the previously approved Descriptor is opened; `loadStoredPublication` detects drift and refuses stale approval. Approved immutable source files are not mutated during this test.

## Verification limitations

Exact final Ubuntu Mini PC source checks (Node 24): Server **465 PASS / 0 FAIL**, Project Peer **651 PASS / 0 FAIL / 6 environment SKIP** (657 total), cross-Phase **143 PASS / 0 FAIL**, Host/Seed smoke PASS, engineering/docs/workflows/public-source validation PASS. Suite counts overlap. The post-fix final suite includes the missing-path privacy regression and the signed Host approval pointer race test. Exact new-commit GitHub CI must be checked after push. No physical Windows Editor pair, actual power-cut, shared network filesystem, exact release ZIP or live M4→M5 commit was tested. The remaining end-to-end transition still requires source-bound Publisher possession proof, quiescence, a cross-store commit intent/recovery journal, Publisher/Seed handoff, Guest verified Active refresh and rollback. `FIELD_BLOCKED` stays unchanged.
