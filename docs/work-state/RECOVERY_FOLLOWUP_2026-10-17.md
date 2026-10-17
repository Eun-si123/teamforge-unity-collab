# Recovery follow-up — 2026-10-17

## Baseline and outcome

Continue the existing recovery branch/PR #289 from
`818a1f915b093c11c0d664d4d6751514e2217238`. Live main remains
`6de9b89aca061a12bb59504949ca14fd9f7f163a`; the worktree was clean and the first
batch's final Windows/Unity/source checks passed. Existing open Dependabot work
is independent. The [first investigation](RECOVERY_STABILITY_2026-10-17.md)
retains its original evidence; this record owns subsequent work.

Goal: make already-approved Project recovery, shared verified caches and user
receive controls dependable under damaged leftovers, failed writes and delayed
responses. Candidate defects identified from current source:

- `loadPublication` parses every descriptor directory entry even when an
  approved/current pointer identifies the exact descriptor. An unrelated partial
  or damaged entry can prevent recovery of an otherwise valid approved baseline.
- `ChunkStore.put` cleans its temporary file only after write/sync/close succeed.
  Failed writes can retain partial files; Swarm source-failure cleanup can also
  delete a good cache entry completed by another operation.
- Launcher pause/cancel handlers accept overlapping input and can apply an old
  ACK/error after the receive operation has ended or been replaced.

## Plan and protected boundaries

Risk: high for persistence/recovery, medium for presentation/control. Reproduce
each behavior before implementing its smallest coherent fix. Read the exact
pinned descriptor; never substitute a different signed baseline on failure.
Verify selected Project/UUID/Manifest/descriptor identity and revision. Preserve
required signature, trust, approval and Active-pointer checks.

Clean only the current writer's temporary file after failure; preserve the
original I/O error and already-verified content. Network/source errors do not
confer ownership of the shared cache. Keep cancellation/resume semantics and
chunk verification unchanged.

Fence control responses to the current receive lifetime, reject duplicate
in-flight controls, and retain cancellation priority over pause/resume. Do not
change Bridge wire shapes, authorization, runtime pins or launch policy.

Evidence: focused negative/retry tests, real Server/Seed integration, shared-cache
failure coverage, native Windows real-Bridge UI tests, full relevant suites and
repository checks. Keep cross-build, Windows execution, Unity automation and
new-package/physical evidence distinct. Source and protocol compatibility stay
unchanged; no release artifact or main history is replaced.

Documentation owners: module READMEs/changelog for behavior, this dated record
for investigation/checkpoints and remaining tests, PR #289 for final live CI.

## Checkpoint

Plan committed as `0adb2f6`. Five regression cases failed before the publication
loader fix: pinned recovery blocked by unrelated leftovers, accepted foreign
Project/revision draft descriptors and malformed hash path lookup. The loader
now reads a canonical pinned descriptor, validates selectors before paths, and
checks route/UUID/Manifest/Owner/revision. Missing or malformed selected metadata
still fails; no alternate filename silently supplies an approved descriptor.

Publication/Host orchestration/real Server restart tests passed **27/27**;
publication + real Server tests passed **14/14** after the selected-corruption
negative case was added. Source changes and tests are saved on the task branch.
Next: reproduce failed cache-write cleanup and concurrent verified-cache loss.

Publication fix committed as `893cae6`. Four injected write/sync/close failure
cases reproduced leftover temporary files and a secondary close error masking
the primary ENOSPC error. A separate real-cache regression reproduced deletion
of content completed by another writer during a corrupt source response.
`ChunkStore.put` now closes and retires its own exclusive temporary file across
all those failure paths while preserving the first error; Swarm no longer
deletes shared cache entries because a remote source failed.
