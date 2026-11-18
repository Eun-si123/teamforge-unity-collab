# WP6 Publisher-signed local Collider observation approval — 2026-11-09

## Decision and dependency

The Project Coordinator already validates Ed25519 Owner/Publisher signatures
for published Baseline Descriptors and pins Project identity. New
`component-collider-completeness.mjs` from PR #509 distinguishes complete
allowlisted local Collider observations from sparse prepared samples.
The next useful step is to bind the **same registered Publisher** to an
exact observed Component/Inspector fingerprint, with explicit replay
isolation and no Inspector/network write. Reusing the project's signing
roots is preferable to creating a separate unchecked Component key.

Stack this source-only PR on #509. Unity-side read-only chain #506–#508
and remote preview #346–#348 remain untouched.

## Cryptographic binding

- Require real `ProjectCoordinatorCore` and `SessionAuthority`
  objects with the **same active registered Editor connection object**,
  valid `projectId`, `sessionId`, negotiated Project Transfer + Hierarchy,
  matching current membership in both registries.
- Require current same-Session/same-revision complete saved-Scene
  BoxCollider/SphereCollider observation via PR #509's strict verifier.
- Read the **current** Project registry baseline and reverify the signed
  Descriptor, Owner pin and delegated Publisher authorization, rather
  than trusting unverified plain metadata.
- Domain-separated v1 Ed25519 payload binds Project ID and UUID, Session
  ID, exact connection ID, published Baseline revision, manifestHash,
  descriptorHash, Scene GUID, realtime revision and SHA-256 of prepared
  identity/property fingerprints. Verify only against the registered
  Publisher public key. Refuse malformed/fake keys or signatures, key
  mismatch, cross-Project/cross-connection/cross-revision replay, changed
  local content, stale Project registry and incomplete observations.
- Avoid getters/proxy side effects from approval records by exact inert
  own-data descriptor validation; accept only canonical 64-byte signature
  base64. Verification has no networking, filesystem reads, writes,
  Scene/Undo changes, authority mutation or property exposure.

## What this does NOT establish

An authorized Publisher can sign fabricated-but-well-formed values; the
signed Project **manifestHash does not prove these Collider observations
came from the actual .unity file bytes**. There is still no file->Scene
parser, verified unity asset identity/contents mapping, durable Session
epoch, realtime signed-approval operation, Inspector write, safe Undo or
repair/reconnect protocol. A successful verdict must never be used as a
live authorization or named 'verified Project Scene baseline'.
The only successful verdict is
`publisher_approved_local_observation_scene_bytes_unverified`.

This is a new, disconnected verification helper rather than a change to
the old generic local simulation or to Project Coordinator wire dispatch.
It intentionally does not install the approved snapshot in the existing
experimental transaction; coupling that simulator to changing Project
registry epochs would require a separate fail-closed retirement design.

## Validation, risk and rollback

High risk if connected to production; safe isolated source-only research
until an independently verified Scene source-to-contents bridge and
authenticated Editor signature production have been designed and tested.
Test real published signed Baselines in Project Coordinator and active
realtime registration, Owner and delegated Publisher, key mismatch,
tampered descriptor, signature aliases, malformed/proxy inputs,
other active Editor replay, changed values, expired membership,
revision drift, rotated Project Baseline, invalid/missing Colliders,
and rejection without Session mutation.

Run focused + whole Server suites, Node syntax check, engineering/docs/
source/workflow gates and exact GitHub CI. No Unity/editor signing tests
or physical two-PC evidence are claimed. Revert the one stacked commit
if necessary; no DB migration, Session activation, release artifact or
network compatibility change exists.
