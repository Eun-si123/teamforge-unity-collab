# WP6 server-side complete Collider observation gate — 2026-11-09

## Scope and why now

Current WP6 local property preparation and local transaction simulator
accept intentional partial property observations, which is fine for broad
experimental unit coverage but unsuitable as a **complete** saved-Scene
Collider baseline. The new Unity-side read-only PR chain #506 (exact
identity), #507 (bounded Scene inventory), #508 (diff) now needs a server
equivalent that distinguishes complete allowlisted observation from a
partial/fabricated Component inventory without changing production authority.

## Change and risk

- Standalone pre-wire module with exact `BoxCollider`/
  `SphereCollider` schema: m_IsTrigger (boolean), m_Center (vector3),
  m_Size (vector3 for Box), m_Radius (float for Sphere), same 100-axis
  and nonnegative size/radius bounds as local Unity observations.
- Require existing private WeakMap-prepared snapshot and identity
  baseline for the same server-owned Session, current revision,
  Scene/owner Hierarchy references, saved Scene GUID and exact
  non-Prefab Component and GameObject GlobalObjectIds.
- Compare every identity against exactly three observed properties,
  fail on missing/extra paths, wrong type/owner, unsupported types,
  stale Session/Scene, over 512 Components. Reject whole candidate
  before touching even the local simulator ledger.
- Provide a **distinct local-only** complete-snapshot seed entrypoint
  that delegates to the existing disconnected transaction simulation
  only after the completeness check; the old generic prototype seed
  semantics and all production WebSocket/SessionAuthority handlers stay
  unchanged.
- No full-Scene attestation: even a complete syntactically valid
  observation could be fabricated by a trusted local test fixture.
  Publisher-signed Project provenance, authenticated ownership,
  reconciliation/Undo and physical two-Editor evidence remain pending.

## Invariants, failures, rollback and evidence

Risk: medium (new offline server-side safety validation on top of prepared
data), high if ever connected to production. The gate must not grant
authority, mutate Session history/revision/locks when rejecting data,
leak property values in diagnostics, or weaken any existing generic
validators or replay semantics. No migrations, release artifacts,
changed network protocol or app configuration.

Test exact 3-property happy path for two same-type Collider IDs and one
Sphere, missing/extra observations, widened prototype policy, prefab
ID, wrong Scene GUID, stale/forged Sessions, invalid values, >512
identities, unchanged Session after rejection, and an authorized
**local-only** simulator commit. Run focused Server tests and the full
Server suite plus source/engineering/docs/workflow validators, Node
syntax, and GitHub exact-head CI. Only actual Unity/physical packaging
can validate source-to-scene and Host/Guest claims, and this PR makes
no such claims.

Rollback: revert the standalone module/test/check/README/doc commit.
Existing unrelated WP6 preview stack #346–#348, UI PRs #506–#508,
release/packaging, Server wire handlers and the shared dev machine
remain untouched. Next prerequisite: independently verifiable Project
baseline provenance before any live Component seed.
