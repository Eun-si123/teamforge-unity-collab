# WP6 bounded read-only Scene Collider inventory — source-only change plan

## Problem and phase outcome

After PR #506 provides exact live saved-Scene Component identity capture
and re-resolution, WP6 still needs a deterministic **complete allowlisted
local observation**, not merely an individually selected Collider.
A future authenticated, revision-bound Component baseline cannot safely
pretend a partial Scene scan is complete, conflate same-type Components,
or silently accept unsupported Prefab Collider instances.

## Scope, trust and failure boundaries

- Stack on PR #506 (`feat/wp6-stable-component-identity-20261109`), not a
  copy of its code in a second PR diff. Preserve concurrent WP6 network
  preview #346–#348, Host/Guest and unrelated Unity/Server work.
- Enumerate the hierarchy of **one** saved, loaded Scene without modifying
  GameObjects, Components, the Scene, Undo, Project assets or Session state.
  Preserve exact Component GlobalObjectIds and owner IDs and sort by
  canonical ID. Return a read-only local diagnostic snapshot.
- Restrict observation to exact BoxCollider/SphereCollider types and their
  three validated existing SerializedProperties. Other Components are
  explicitly out of scope. Prefab-backed allowed Colliders are unsupported
  and must cause a failure rather than disappear from the result.
- Bound the traversal to 4096 GameObjects and 512 supported Colliders.
  Abort without returning a partial result for invalid/removed allowed
  Collider, duplicate IDs, failed read-only property capture, incomplete
  hierarchy, Scene identity change or dirty-flag change during scan.
- Snapshot may observe **locally dirty** Scene values but marks the dirty
  state. It does not establish saved Project bytes, signed Publisher
  provenance, authoritative hierarchy, security, lock, revision or permission
  to apply a write, even if the Scene is clean.
- Do not add packet types, network transport, persistent snapshots,
  authentication changes, Component writes, automatic repairs or release
  claims. The existing immutable published candidate is unaffected.

## Planned verification

- Unity EditMode cases: two same-type BoxColliders and another nested
  SphereCollider, stable sorted IDs and values after save/reopen, unrelated
  Component ignored, saved/dirty flags and Undo invariants, no aliasing
  after local edit.
- Negative Unity cases: unsaved Scene, unsupported Prefab Collider,
  invalid allowlisted property, bounded count refusal, no partial result.
- Repository docs/engineering/public-source/workflow gates and C# syntax
  analysis. GitHub Unity Editor CI is mandatory for Unity semantic
  compilation and actual engine-state behavior. Source-only local parsing
  is not a passed Unity NUnit run; no physical two-PC claim.

## Reversal and next dependency

Delete the isolated inventory helper/tests/docs and revert the minor
identity-guid visibility adjustment. Any failure leaves the user's Scene
unchanged. Next: verify scene authority/provenance at the Server and build
one opt-in, revision-fenced baseline transaction before attempting Inspector
property writes. This PR explicitly does **not** authorize the transaction.
