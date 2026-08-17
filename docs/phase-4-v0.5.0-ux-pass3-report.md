# TeamForge Phase 4 v0.5.0 — UX Pass 3 Report

Date: 2026-08-10 (Asia/Seoul)
Target Unity: `6000.3.21f1`
Base: UX Pass 2 Hotfix2 candidate
Phase 5: NOT STARTED

## Field trigger

After UX Pass 2 Hotfix2 passed the user's field gates (`91/91` EditMode and Quick A/B/C including C Late Join), the Collaboration home UI still caused a usability trap:

- `Copy Invite` copied a `TF1...` code, but the normal window had no visible invite input field.
- `Connect Current` could be mistaken for the action that consumes the copied invite. It actually reconnects the Project/Session IDs already saved locally.
- In the field screenshot the two Editors displayed different Project IDs and different Session IDs with `People: 1 connected`, showing that they were each connected to their own saved session rather than to one shared invite session.
- The UI was English-only and important controls lacked discoverable explanations.

The existing Project Coordinator warning `A non-empty Project registry requires a Project UUID.` is still a separate diagnostic. This UX pass does not weaken or bypass the Project UUID validation.

## UX changes

### Explicit invite flow

The Collaboration home now exposes a visible `Invite code` text field plus:

- `Paste` — copies the system clipboard into the invite field without connecting;
- `Join Invite` — parses and previews the entered invite, validates local Project/Scene identity, then connects only after confirmation;
- `Copy Invite` — unchanged security model, but its purpose is clearer.

The old clipboard-only join action is removed from the normal path.

### Clear saved-session reconnect semantics

`Connect Current` is renamed to `Connect Saved Session` and its tooltip explicitly states that it uses the locally saved Project ID + Session ID and does **not** consume the invite field or clipboard.

### Language selector

The Collaboration home gains `Auto / English / 한국어` selection. The preference is stored in `EditorPrefs` and is therefore a local editor/user preference rather than shared Project state. `Auto` uses Korean when the operating-system language is Korean; otherwise English.

This pass localizes the normal Collaboration home controls/statuses and confirmation flow. Low-level diagnostic payloads and some developer-facing diagnostic text remain source-language English so error identifiers are not altered.

### Hover help

Major sections now show a visible `ⓘ`. Hovering it uses UI Toolkit `VisualElement.tooltip`. Buttons, invite input, name field, language selector, manual connection fields, and security-sensitive controls also have direct hover tooltips.

## Security/authority boundary

- Join codes remain secret-free; Bearer tokens/private keys are not placed in invite text.
- Project UUID and saved Scene baseline checks are unchanged and still fail closed.
- Server, Coordinator, Project Peer, realtime protocol, Hierarchy authority, Transform authority, and Lock behavior are unchanged.
- Phase 5 remains not started.

## Static validation performed

- Repository validator: PASS — `251 files`, `43 C# sources`, protocol v1.
- Source-discovered Unity EditMode marker count remains `91`.
- Changed runtime product source is limited to `TeamForgeHomeWindow.cs` plus this documentation.
- `PopupField<T>` and `VisualElement.tooltip` usage was checked against Unity's official UI Toolkit API documentation.

## Field validation required

1. Unity `6000.3.21f1` compile: Console Error 0.
2. EditMode: `91/91 PASS`.
3. Open Collaboration and verify the invite text field, Paste, Join Invite, and renamed Connect Saved Session are visible.
4. Switch `Auto -> English -> 한국어`; verify the home UI rebuilds and the invite field text is preserved.
5. Hover each `ⓘ` and representative buttons; verify Unity Editor tooltips appear.
6. In A: Start Collaboration / Copy Invite. In B: Paste -> Join Invite. Verify both show the **same Project ID, same Session ID, and People: 2 connected**.
7. Verify Connect Saved Session on an unrelated Project does not consume the invite field.
8. Re-run one basic Hierarchy Create/Rename/Move and C Late Join smoke to ensure the UX-only change did not disturb Phase 4 behavior.
