# UX Pass 4 Session

Date: 2026-08-10
Base: Phase 4 v0.5.0 UX Pass 3

## Inherited field evidence

- UX Pass 2 Hotfix2 Unity EditMode: 91/91 PASS.
- Quick A/B/C: PASS.
- C Late Join: PASS.
- UX Pass 3 UI checks 1–5: PASS.
- First UX Pass 3 real invite join reached the intended fail-closed Project UUID mismatch check.

## Current change

The Project mismatch is now an actionable recovery flow:

- classify matching/missing/different Project identity before join;
- offer `Choose Matching Project`, `Get Host Project`, or Cancel;
- validate the selected Unity Project root and exact TeamForge Project UUID;
- prompt for unsaved Scene handling before switching Projects;
- open the matching Project with Unity;
- temporarily hand off the secret-free TF1 invite for 15 minutes and restore it only in the expected Project;
- keep explicit user confirmation before the realtime connection;
- link normal users to existing Project Bootstrap / Project Transfer guidance when they do not yet have the host Project.

No UUID forcing, Project overwrite, auth-secret transfer, or authority weakening was added.

## Regression tests

Three EditMode tests were added. The previous UX Pass 2 Hotfix2 field total was 91. The user ran the exact UX Pass 4 candidate in Unity `6000.3.21f1`; the current result is **94/94 PASS**.

## Closure evidence

- Candidate: `Unity-TeamForge-Phase4-v0.5.0-uxpass4-candidate.zip`
- SHA-256: `ED27CC23459B15AB90337A7DF181996D469A2DC33F252EE49125814256521AE7`
- Unity EditMode: **94/94 PASS** — user-provided field evidence.
- A/B/C Late Join: **PASS** — user-provided field evidence.
- Language / Tooltip / Invite basic UX: **PASS** — user-provided field evidence.
- WP0 did not rerun Unity. Repository validator evidence is recorded separately in the Closure report.
