# WP6 loaded clean Scene ↔ published source consistency check — 2026-11-09

## Objective

Source-only PR #511 gives Project Peer a way to reconstruct signed
approved Scene and .meta **published bytes**, distinct from the Unity
Editor loaded Scene. Stacked Unity PR #506 resolves exact saved
Component identity and #507 produces a complete bounded Collider
inventory. This PR supplies a local, read-only consistency check
connecting **expected** published Scene/.meta hashes and GUID to
the *active clean Editor Scene* during one inventory pass.

This PR stacks one commit atop #507, not #508 (comparison) and does
not alter the independent Project Peer/Server PR branches. It
introduces no implicit runtime activation or distributed trust.

## Scope, data and resource boundaries

- `TeamForgeWp6LoadedSceneSource.TryCapture` accepts expected Scene
  asset path, Scene GUID and SHA-256 via existing
  `TeamForgeSceneBaseline` and a second exact expected `.meta`
  SHA-256. Expectation is **not** automatically trusted; it must
  originate from a separately verified active Project/Publisher
  source. This method never parses publisher signatures.
- Require a valid loaded active saved and clean Scene. Reject any
  path/asset GUID mismatch, dirty Scene, noncanonical hash fields,
  unsafe/missing/redirected Scene or meta file, redirected directories
  from Assets through the Scene's immediate parent, and over-budget
  128 MiB Scene / 64 KiB meta before reading. The selected Project root
  itself may be a separately verified execution alias; this gate does
  not resolve or reject that root. Parent and file checks repeat after
  enumeration, but are not an atomic filesystem snapshot or lock.
- Reuse `TeamForgeBaselineFingerprint.TryCaptureActiveScene`
  rather than invent a second Scene file hasher. Hash bounded
  .meta contents using a capped read. Hash both before and after
  `TeamForgeWp6SceneInventory.TryCapture`; ensure exact
  expected GUID, stable SHA-256/path, active Scene identity and
  clean/loaded state. If any check fails, return no partial data.
- A success packages only the existing immutable read-only
  Collider observations and observed local file hashes. No
  Editor Scene reload/open/save, no Undo changes, no Server calls,
  no disk writes, no new property value serialization or persistence.
- No cross-process atomic lock exists here: another program could
  modify an on-disk Scene in ways not covered by the before/after
  windows. More importantly, a loaded clean Scene might not
  reflect external on-disk edits without explicit Unity reimport.
  **Do not claim serialized Component-value provenance or enable
  Inspector writes from this observation alone.**

## Validation, failure and rollback

- NUnit Unity EditMode source tests: multiple same-type Box
  Colliders and nested Sphere in a saved active Scene; stable
  expected Scene/meta SHA and GUID, no dirty flag or Undo; wrong
  expected Scene/file/hash; dirty editor state; external Scene
  and .meta modification; malformed/unsaved inputs.
- Local C# parse and source/docs/engineering/workflow gates are
  helpful but **not** Unity API compilation or Editor execution.
  Actual Unity CI on this exact branch and physical Host/Guest
  scenario remain separate evidence. The current alpha release
  is still FIELD_BLOCKED with unchanged selected artifact.
- Failures return null/false; the method never mutates the Scene.
  Revert this one stacked commit to remove all behavior without
  data migrations or deployed protocol changes.

## Remaining dependency

Validate current published Project trust/pin and Scene/.meta
fingerprints from Project Peer #511, then independently prove
the exact Unity Editor Component snapshot matches the **actual
serialized contents** of that published Scene. Connect only then
to Server signed Publisher approval (#509/#510), authenticated
Session owner, revision and lock checks with safe Inspector
Undo/rejection/reconnect behavior. The read-only checks alone
are not a synchronized Feature/Phase completion.
