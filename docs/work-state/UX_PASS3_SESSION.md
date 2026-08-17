# UX Pass 3 Session

Date: 2026-08-10
Base: Phase 4 v0.5.0 UX Pass 2 Hotfix2

## User field evidence inherited

- Unity EditMode: 91/91 PASS.
- Quick A/B/C: PASS.
- C Late Join: PASS.

## Current change

Collaboration home UX only:

- explicit Invite code input;
- Paste + Join Invite flow;
- `Connect Current` renamed to `Connect Saved Session` with explicit semantics;
- Auto / English / 한국어 selector using EditorPrefs;
- visible `ⓘ` section help and per-control UI Toolkit tooltips;
- Project/Scene identity security checks unchanged.

## Remaining field gate

Compile + 91/91 + invite join between A/B showing same Project/Session and People 2 + tooltip/language smoke.

The Project Coordinator UUID warning remains a separate diagnostic and is not bypassed by this pass.
