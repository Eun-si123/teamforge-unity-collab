# WP6 real Editor local Active Scene report comparison — 2026-11-09

## Missing integration and safe scope

Project Peer #525 checks previously approved signed Active
Scene/.meta file bytes against the signed stored Manifest.
Unity Editor #521–#524 separately compares locally loaded
saved Collider SerializedProperties and current Server Project
Baseline. This PR joins those observations in the real
Unity Test Lab via pasted local JSON. It is a deliberately
UNTRUSTED report, not Publisher-to-Editor authentication.

No new network packet, runtime Server operation, Project
metadata write, Component seed, Inspector mutation, Scene
save/Undo or persisted configuration is introduced.
Original opt-in read-only preview stays independent.

## Implementation

- Bounded 8192-character in-memory JSON field added to the
  Window/TeamForge/Test Lab: WP6 Recovery Preview window.
  Accepts redacted Project Peer wp6-scene-source CLI output.
- Schema v1, exact signed Active source report status,
  Manifest/source-verification flags, four explicitly
  false remote-authority flags, bounded Scene byte count
  and canonical SHA-256 and Owner/Publisher key IDs.
- Exact Project ID, UUID, Baseline revision,
  Manifest/Descriptor hashes, Owner and Publisher
  key IDs equal the current registered Server Project pin.
- Scene path/GUID and BOTH saved Scene/meta hashes equal
  a fresh Editor complete saved Unity YAML-to-loaded
  BoxCollider/SphereCollider SerializedProperty witness.
- Re-observe Project pin and saved/loaded Scene a second
  time before showing a positive result, rejecting
  changed Editor Scene or Project/Baseline during comparison.
- Positive result is LOCAL REFERENCE MATCH with the
  explicit text origin NOT authenticated. Changes to
  input reset the result; closing the window clears it.
- Refusal affects only local text, not Presence/Transform,
  Unity objects, Undo or the default-off preview feature.

## Security boundary and tests

A forged JSON with matching fields might yield MATCH.
The report origin is NOT authenticated and may not be
trusted by the Server, sent as an approval, or used to
authorize any Inspector writes. True live source trust
still requires authenticated Project Peer↔Server↔Editor
nonce/Session-binding, Publisher-signature and post-apply
acknowledgment plus two-device verification.
No such transport or remote apply is implemented here.

New Unity NUnit tests cover exact local reference match,
bad/oversized JSON, false and forged remote-authority
flags, Project/Owner/Publisher/Baseline drift, different
Scene/source/meta and real saved Unity Scene Collider
read-only behavior with no dirty/Undo mutation. Local
C# parser and exact-head CI Unity execution evidence
are separately verified. Rollback is one source-only
stacked PR. TeamForge 0.5.1 remains FIELD_BLOCKED.
