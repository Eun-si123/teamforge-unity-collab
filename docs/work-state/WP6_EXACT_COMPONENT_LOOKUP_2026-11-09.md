# WP6 exact saved Component lookup — source-only change plan (2026-11-09)

## Why this is on the current/next Phase path

WP5.1 Source/Windows packaging and field gates remain independent. The next
major work package, WP6, must distinguish **two BoxCollider Components on one
saved GameObject**, including after another Component is added or removed,
before any remotely supplied Inspector property may be applied. The server
has pre-wire validation and a default-off read-only preview; neither implies
that the Unity Editor can safely resolve an intended live Component.

## Scope and invariants

- Implement **Editor-only read-only exact identity capture and resolution** for
  saved, loaded Scene `BoxCollider` and `SphereCollider`.
- Bind canonical `GlobalObjectId`, Scene GUID, owning GameObject and
  exact allowed runtime type; verify the live result again after lookup.
- Refuse unsaved/unloaded/removed/ambiguous, noncanonical, incorrect owner,
  wrong type, asset and Prefab-instance identities. Never substitute an
  Inspector index, Component type, GameObject name or hierarchy path.
- Invoke the exact-ID round-trip check in the existing local read-only
  Inspector probe. Do not modify any Component, Scene, Undo, lock, Project
  bytes, current authority revision, packet, credential or protocol.
- Keep the method internal to Unity Editor: a matching Component identity
  does **not** establish Owner/Publisher/Project trust, Session membership,
  baseline provenance, authority, lock ownership, revision or permission to
  synchronize it. Live write/recovery/reconciliation stay future work.
- Existing WP6 network preview PRs #346–#348 remain separate; no stacked
  branch has been rewritten.

## Failure cases and verification

- Assert exact multiple same-type round-trip and no substitution after
  another same-type Component is appended or the intended target removed.
- Assert wrong owner/Scene/type, noncanonical ID, unsupported/unsaved
  Component, unloaded Scene and Prefab instance fail closed.
- Focused Unity EditMode NUnit coverage plus GitHub Unity CI are required.
  Local C# parsing and repo validators alone cannot prove Unity's identity
  resolution behavior. Exact release packaging/two Windows PCs must be
  validated separately before any production WP6 feature claim.

## Rollback and release

Source-only, no persistent migration or network compatibility change.
Revert the new helper/probe call/tests/docs if necessary. Do not update the
published ZIP or release-readiness claims on the strength of this change.
