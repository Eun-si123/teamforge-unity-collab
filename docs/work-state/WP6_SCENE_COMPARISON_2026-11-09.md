# WP6 read-only Scene snapshot comparison — 2026-11-09

## Intended phase advance

A true WP6 Inspector synchronization path needs to distinguish *which*
saved Component changed and *which* allowlisted field differs before
designing authoritative operations. The immediately preceding stack:
#506 captures and re-resolves exact Component GlobalObjectIds; #507
creates bounded all-or-nothing local Scene Collider inventories.

This work adds a pure local **comparison** of two such observations,
not an authoritative delta/operation proposal.

## Implementation, invariants and failure behavior

- Stack one commit on #507, itself based on #506. Do not edit their
  branches, the default-off WP6 preview stack #346–#348, or main.
- For one matching saved Scene GUID, compare exact canonical saved
  Component GlobalObjectIds and owner/type. Classify each result as
  added, removed or changed allowlisted properties with deterministic
  Component-ID ordering. Return only property *names*, no old/new values.
- Revalidate both snapshots before comparing. Refuse malformed or
  duplicate IDs, missing/mismatched Scene identity, inconsistent
  per-Component dirty flags, unsupported types, wrong property paths,
  property-type substitutions, out-of-range/nonfinite numbers and
  owner/type conflicts on the same ID. Never issue a partial report.
- Compare finite float/vector fields exactly; approximate Unity
  Vector3 equality would otherwise silently lose small edits.
- Each snapshot remains bounded to 512 allowlisted Collider observations.
  Read-only report metadata only; no Unity runtime Scene change, network
  traffic, Undo, Session revision, Component edit or Project write.
- A clean Scene observation is not verified Owner/Publisher provenance
  or Project bytes. Dirty observations are explicitly labelled. No
  Server authorization, lock, signature, baseline revision, replay,
  late join or recovery is claimed by this comparison.

## Evidence required

- NUnit EditMode on actual Unity Editor: saved Scene values, duplicate
  BoxColliders, separate SphereCollider, Component add/remove, two
  property changes, sibling reorder with no false positives, local
  dirty flag, small finite change, forged owner/type, duplicate ID,
  corrupted property and Scene GUID mismatch.
- Source/engineering/documentation/workflow validators, C# syntax
  analysis and public-safe commit identity. These static checks do
  **not** establish Unity compilation or a physical two-PC pass.
- Existing #507 Windows Node 22 timeout/orphan-process cleanup EBUSY
  was observed in unchanged test-lab fixture code. This work does not
  alter/disable that check or claim the overall CI was green.

## Rollback, next prerequisite and distribution

Revert the single comparison helper/test/docs commit; no migrations or
runtime state cleanup. Stays source-only Draft and does not change
currently published binaries. Next, build a separately reviewed
revision-fenced and authenticated **Server-owned** complete allowlisted
baseline with explicit verified Project source provenance, then design
one bounded Inspector write transaction plus fail-closed Unity
reconciliation, Undo and physical two-Editor tests.
