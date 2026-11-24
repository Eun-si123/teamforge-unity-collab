# P1 M4→M5: online Publisher possession preparation (no commit) — 2026-11-24

**Work state:** Draft PR #620. `FIELD_BLOCKED`. This change does not update the current M4 Project, any SQLite checkpoint, the Host published pointer, Guest Active pointer, cached asset, Unity Scene, or WebSocket-public transition privilege.

## Why this gate is needed

An all-Editor ACK proves only that the connected Unity Editors reported local transport readiness. The full signed M4/M5 source audit proves only the checked stored bytes *at the time of the scan*. A signed candidate Descriptor is replayable and does not prove current possession of its Publisher private key. These are three distinct facts, and NONE individually authorizes a cross-store M5 commit.

## New in-process orchestration

The existing Coordinator already (1) installs a per-Project transport freeze, (2) verifies each durable Editor's current exact ACK, and (3) audits the old approved M4 and candidate M5 signed Manifest/Chunk data, Unity `.meta` GUIDs and changed sources with bounded read-only checks. This batch now adds the fourth gate:

- Retain an **in-memory, project-scoped, exact-pause and exact-signed-candidate observation** only if a post-ACK signed source audit returns `verified_source_only` (no blockers). Any failed or reattempted audit invalidates the previous observation and any pending proof.
- `issueOnlinePublisherChallenge(projectId,pauseId,candidateDescriptor)` is **trusted in-process only**. It requires the current unexpired all-ACK Editor pause, the exact signed approved M4 Descriptor and current audited next-revision M5 Descriptor/Manifest. It reuses `ProjectTransitionPublisherProof.issue` for a fresh, domain-separated, random, one-use challenge signed by the **actual current Publisher**, including an Owner-delegated Publisher when applicable. The externally reported deadline is clipped to the earlier Editor pause expiry.
- `verifyOnlinePublisherChallenge(...)` consumes the challenge once, rejecting wrong-key, malformed, replayed or expired signatures. Even after a correct Ed25519 proof, it **re-runs the full signed-source audit**, checking current Editor pause, independent M4 Session revisions/checkpoints, Host approved pointer and exact staged Manifest. A disconnect, cancellation or expiration during this async recheck rejects the whole result.
- The success shape is a **diagnostic only** (`verified:true`, `sourceVerified:true`, `commitPermitted:false`), with no internal receipt object or transition authority given to the caller. `cancelOnlineProjectPause` and all busy/connection-loss/timeout notifications revoke outstanding observations and proof material. Process stop clears them too.
- `ProjectTransitionQuiescence.matchesOffline` now explicitly differentiates **zero-Editor offline freeze** tickets from online all-ACK tickets. The prior offline Publisher methods now require the offline state and cannot accept even a valid online ready ticket. This keeps future Host transitions from accidentally treating an online pause as an offline zero-member freeze.

## Regression evidence

New real WebSocket tests cover: two independently connected Editor ACKs, no Publisher challenge before *both* ACKs and source audit, mismatched signed candidates, fresh one-use signature bound to actual M4/M5 hashes, wrong Ed25519 key consuming the challenge, replay resistance, pause-limited expiry, cancellation between proof verification and the subsequent signed source audit and no changes to the M4 Baseline. Unit tests also assert that online ACK tickets **never** satisfy the offline freeze predicate. Existing delegated-Publisher and long-tail stale challenge tests remain in place.

## Checks completed on Ubuntu Mini PC (Node 24)

- Server **497 PASS / 0 FAIL**, including two new live two-Editor WebSocket/Publisher tests.
- Cross-phase Node **159 PASS / 0 FAIL**; these tests overlap the Server suite.
- Project Peer **651 PASS / 0 FAIL / 6 environment SKIP** (657 total), run separately from cross-phase to avoid oversubscribing child processes.
- Server module syntax/check, Host+Seed smoke, engineering/docs checks, GitHub workflow policy for 29 workflows, public-source validation, and `git diff --check`: **PASS**.
- GitHub Unity EditMode and multi-version Windows tests are **not** included in these Mini PC runs and must be independently confirmed against the pushed SHA. No two-Windows-PC field tests were performed.

## Not implemented / release block

These checks do **not** prove absence of arbitrary third-party Unity plugin writes, external file writers, Host/Guest pointer atomicity, storage power-loss survival or an actual user-approved M5 commit. This change does not add an Editor UI flow for Publisher signing, a WebSocket API to initiate promotions, or an in-process route to `transitionProjectCheckpoints`. Safe live migration still requires explicit Host+SQLite+Guest crash-consistent commit/rollback, independent source/epoch rechecking directly at the write boundary, and real two-Windows-PC Unity tests. Continue to leave the Draft PR unmerged and `FIELD_BLOCKED`.
