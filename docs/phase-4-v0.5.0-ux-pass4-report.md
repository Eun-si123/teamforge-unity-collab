# TeamForge Phase 4 v0.5.0 — UX Pass 4 Report

Date: 2026-08-10 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Base: UX Pass 3 candidate
Phase 5: NOT STARTED

## Field trigger

UX Pass 3 compile/UI checks 1–5 passed in the user's Unity field test. The first real invite join then correctly failed closed with:

`This local Unity Project does not match the host Project baseline.`

That safety decision is correct, but the dialog left a normal user with no direct recovery path. The user had to already know that a realtime `TF1…` session invite requires the same TeamForge Project identity and that Project files are transferred separately.

## UX Pass 4 goal

Keep Project identity protection fail-closed while making the mismatch recoverable from the normal Collaboration window.

## Changes

### Project compatibility is classified before join

`TeamForgeJoinCode` now exposes an explicit compatibility classification:

- compatible;
- local Project identity missing;
- local Project identity different from the host invite.

`TryApply` continues to reject missing/mismatched identities. No UUID rewriting or bypass was added.

### Actionable mismatch assistant

When `Join Invite` sees a missing or different Project identity, the normal home window now shows an actionable assistant instead of the previous one-button error.

The user can:

1. **Choose Matching Project** — select an existing copy/sync of the host Unity Project;
2. **Get Host Project** — open Project Transfer / Project Bootstrap guidance;
3. **Cancel**.

The dialog shows short host/current Project identity fingerprints so the distinction is visible without dumping the full UUID.

### Safe matching-project selection

Before opening a selected folder, TeamForge checks that it is a Unity Project root and validates its `ProjectSettings/TeamForgeProject.json` with the existing descriptor validation policy. The folder must contain the exact Project UUID carried by the invite.

A wrong/missing descriptor is rejected. TeamForge explicitly tells the user not to edit the descriptor to bypass identity checks.

### Unsaved Scene protection and project switch

After a matching Project is selected, TeamForge calls Unity's modified-Scene save prompt before switching Projects. Cancel aborts the switch.

The actual Project switch uses `EditorApplication.OpenProject`.

### Invite handoff after Project switch

Because opening another Unity Project restarts/reloads the Editor context, the secret-free `TF1…` invite is kept temporarily in local `EditorPrefs` for up to 15 minutes. It is restored only when the newly opened Project has the exact expected Project UUID.

After a valid handoff:

- the Collaboration window reopens;
- the invite field is repopulated;
- the user still explicitly presses `Join Invite` and sees the normal join confirmation.

The handoff does **not** contain Bearer tokens or private keys and does not auto-connect.

### Project Transfer guidance

If the user does not yet have the host Project, the assistant explains that a `TF1…` invite is a realtime session invite, not a Project-file payload. It points to either a trusted host Project copy/sync or the existing `Publish → Project Invite → Sync` Project Transfer workflow, with one-click access to the Advanced / Project Bootstrap UI and a Copy Steps action.

### Home-page explanation

The invite area now contains an info box explaining that TeamForge does not silently replace local Project files and will offer a safe recovery flow when identities differ.

## Security / authority boundary

Unchanged:

- no forced Project UUID changes;
- no overwrite of the currently open Project;
- no Bearer token/private-key inclusion in `TF1…` invites;
- Project descriptor compatibility remains validated;
- Scene baseline validation remains fail-closed after Project compatibility passes;
- server/Hierarchy/Transform/Lock authority is unchanged;
- Phase 5 remains not started.

## Automated regression source added

Three Unity EditMode tests were added:

1. join compatibility distinguishes matching / missing / different identities;
2. matching-Project folder selection accepts the exact host identity and rejects another identity;
3. a Unity Project without the host TeamForge descriptor is rejected.

The previous UX Pass 2 Hotfix2 field result was `91/91`. The user subsequently ran the exact UX Pass 4 candidate in Unity `6000.3.21f1`; all three added tests were discovered and the current field result is **94/94 PASS**.

## Original build-environment validation

- Repository validator: PASS.
- Modified C# lexical delimiter/syntax-shape check: PASS for `TeamForgeJoinCode.cs`, `TeamForgeHomeWindow.cs`, and `TeamForgeUxTests.cs`.
- Full Node `npm test`: NOT COMPLETED in this container because the configured internal npm mirror cannot provide the unchanged `ws@8.21.1` tarball (HTTP 404). This is an environment/dependency-availability limitation, not a test PASS.
- Unity Editor was not executed in that build environment. The Unity result below is later user-provided field evidence, not a build-environment execution claim.

## Closure field evidence

Evidence source: user-reported execution against the exact archived candidate below on 2026-08-10. The WP0 documentation pass did not rerun Unity and does not reclassify this as newly executed automated evidence.

- Candidate: `Unity-TeamForge-Phase4-v0.5.0-uxpass4-candidate.zip`
- Candidate SHA-256: `ED27CC23459B15AB90337A7DF181996D469A2DC33F252EE49125814256521AE7`
- Unity: `6000.3.21f1`
- Unity EditMode Test Runner: **94/94 PASS**
- A/B/C Late Join: **PASS**
- UX Pass 4 Language / Tooltip / Invite basic UX: **PASS**

These results close the `91/91` versus expected `94` evidence gap for this exact candidate. They do not claim that Unity was launched by the WP0 documentation environment, and they do not add Phase 5, persistence, protocol, or authority behavior.
