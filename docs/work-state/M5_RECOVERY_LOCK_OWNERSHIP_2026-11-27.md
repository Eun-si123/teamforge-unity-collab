# M5 recovery lock ownership correction — 2026-11-27

Base: Draft PR #620, 7c0cd010. Guest recovery integration is being developed independently in stacked Draft PR #684; do not replace or duplicate that work.

## Confirmed defect and reproduction

The prior process-bound lock implementation silently fell back to file-only ownership if the Windows named pipe or Linux abstract socket bind failed for a reason other than contention. It still emitted the same schema-v1 owner record as a successful mutex-backed acquisition. Another caller that successfully acquired the mutex could then reclaim the live owner's file and enter the protected operation concurrently.

Reproduced against the unmodified base module in an isolated temporary directory: inject EACCES for the first mutex bind, let its protected callback enter, restore the real bind, and invoke the second acquisition before the first returns. Both callbacks entered. No customer Project or lock was touched.

## Correction

- Refuse work on mutex-capable platforms if the mutex cannot be established or its filesystem identity is unavailable. Preserve the existing lock/mutex names and busy codes.
- Emit schema-v2 recoverable records only with actual mutex ownership. Platforms without a crash-released mutex retain a non-reclaimable file-only record. Earlier v1 records are ambiguous because they could have been produced without a mutex. They now require operator verification rather than automatic removal.
- Reuse the bounded, pinned managed metadata reader for existing lock records. Oversized, redirected, malformed, or invalid owner records remain untouched.
- Existing genuine v2 locks can still be recovered after their process dies in the same local mutex/filesystem domain. This is not a distributed lock across machines, network filesystems, or distinct OS namespaces. Do not share a managed project root across independent ownership domains.
- No production lock was deleted and no release or journal gate was changed.

## Validation

- Focused lock tests: 6 PASS, including new bind-failure, ambiguous legacy/file-only and oversized/redirected record regressions.
- Draft #620 plus patch: Server 522 PASS / 0 FAIL; Project Peer 664 PASS / 0 FAIL / 6 environment SKIP (670 total).
- Independent detached checkout of Draft #684 at 85203aac230e2b7b797eaa009a1cd811833be9bb with the two-file patch: 89 PASS / 0 FAIL for Guest transition inspection/rebind/recovery and proof/finalization, Host+SQLite recovery, and process-bound lock suites. The stack branch was not modified or pushed.
- Server/Peer syntax, engineering, documentation, workflow policy (22 workflows), public-source validation and diff check pass.
- Native Windows and Unity/physical two-PC behavior of the new patch not tested here; GitHub CI for the new commit remains necessary.

## Remaining integration boundary

The stacked Draft #684 contains additional implementation of Guest recovery copies, retained-version rebind, signed participant reconciliation, durable finalization and offline execution. Its existing CI had no failing/pending checks at inspection, but this does not make the product release-ready. Keep both PRs in their intended review order and retain FIELD_BLOCKED until real Windows/Unity and cross-device evidence exists. This patch fixes their common ownership primitive rather than duplicating the stack.
