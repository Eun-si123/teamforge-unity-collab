# M5 Guest Publisher trust and Active project promotion — 2026-11-22

**Source-only, stacked on the unmerged Guest update review PR #578.** This is not a published or field-verified release.

## Problem and invariant

An approved replacement Publisher could change the standalone Guest trust pin **before** the new signed Project revision became Active. A cancelled, stale or failed update then left the previous Active Project with the new Publisher pin. Two independently renamed files cannot provide an atomic cross-file trust/Active transaction.

Use the **one validated Active `metadata/current.json` pointer** (which selects a verified signed descriptor and manifest) as the committed trust decision for subsequent Guest receives. `ManagedProjectStore.activate()` already requires Publisher approval before it atomically selects the new pointer. The previous separate Guest trust file is bootstrap state for first receive, not an ahead-of-time approval for a replacement Publisher while an existing Active is being updated.

## Implementation

- `TeamForgeGuestOrchestrator.inspect()` and `#attempt()` use the **verified Active revision's exact signed Owner/Publisher identity** when a validated Active exists; an invalid raw trust record still asks for explicit trust, and a conflicting Owner still fails closed.
- Guest update approval to a different Publisher is held in the current attempt for the exact reviewed manifest and never writes a replacement pin before Active activation. Cancelled/stale/failed updates leave the old pointer and old standalone pin intact.
- A successful update selects a new verified Active pointer as the durable approved Publisher state; a later Guest run sees its Publisher without a duplicate challenge, even if the separate historical bootstrap pin still names the original Publisher.
- First receive with no Active still requires the existing safe trust-pin write. Reapproving an already Active exact Publisher can also repair a malformed standalone pin without changing the current Project.
- The Coordinator latest-publication caveat remains: last observed signed publication is not a global CAS/commit guarantee. A rejected attempt never automatically uploads/discards local Unity edits.

## Verification

- Focused real signed Guest transfer/update/activation and abort tests: **44/44 passed**.
- Full Project Peer suite on the branch: **595 passed, 0 failed, 6 platform skips**.
- Public source, docs, engineering validation and `git diff --check`: PASS.
- Physical Windows Host/Guest with actual imported Assets, exact package identity and Unity Editor launch: **NOT RUN**.

**Integration note:** This must be reviewed and tested with PR #578 and latest `main` before merge. There is no new generic network protocol, implicit Publisher trust on unverified Project content, release publication, or field-ready claim.
