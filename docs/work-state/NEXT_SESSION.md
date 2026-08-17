# Next session

## Resume point

Continue from the final packaged/fresh-validated Phase 4 `0.5.0` candidate. The provisional fresh gate passed; documentation was then corrected, so the exact final archive still needs the final freeze/revalidation step before delivery. Read `CURRENT_STATE.md`, `PHASE4_SESSION.md`, `TEST_EVIDENCE.md`, `DECISIONS.md`, and the v0.5.0 reports first.

## Immediate user-side gate after delivery

1. Extract candidate to a short new Windows path.
2. Verify SHA-256.
3. Open validation project in Unity `6000.3.21f1`.
4. Run Compile + EditMode `Run All`; require Failed 0 / Compile Error 0.
5. Run `docs/phase-4-v0.5.0-manual-test-checklist.md` with two Editors.
6. Report the first failing step/log; do not proceed into Phase 5.

## Important safety boundary

If testing a newly republished Phase 3 baseline while an older hierarchy Session is alive, do not try to force identity migration. The current `0.5.0` MVP intentionally fails closed on unsafe logical-ID mismatch. Restart/reseed the hierarchy Session or use a matching baseline. Persistent migration/recovery is not Phase 4.

## 2026-08-08 Hotfix3 immediate resume point

Use the Hotfix3 package/candidate, not Hotfix2. Unity `6000.3.21f1` must compile clean and EditMode should become 71/71 because one targeted regression was added. Then repeat only the failed field path first: A creates a GameObject, keeps it selected, B receives it, A moves it without deselect/reconnect, A acquires/owns the lock and B converges. Do not continue to Reparent/Reorder/Delete until this targeted gate passes.

## 2026-08-08 Hotfix4 immediate resume point

Use Hotfix4 for the Unity gate. Run EditMode `Run All`; expected 71/71. If green, repeat the exact field runtime path that originally failed: A creates a new GameObject and keeps it selected, B receives it, A moves it without deselection/reconnect, A acquires the lock, and B converges. Only then continue hierarchy Reparent/Reorder/Delete/conflict tests.


## Hotfix5 immediate gate
Use the exact Hotfix5 Server and Unity package. Run Unity EditMode expecting 72/72. Then connect two Editors and rename a synchronized object whose Transform is clearly non-zero in A->B and B->A directions without moving it after rename. Both peers must retain identical coordinates. If PASS, continue Reparent/cycle rejection, sibling reorder, delete/tombstone, conflict, and late join.

## 2026-08-10 UX Pass 3 immediate gate

Use the UX Pass 3 candidate. In Unity `6000.3.21f1`, require Compile Error 0 and EditMode 91/91. Verify language switching, `ⓘ` tooltips, and explicit Invite code -> Paste -> Join Invite flow. A and B must display the same Project ID, same Session ID, and `People: 2 connected`. Then run one Create/Rename/Transform smoke and C Late Join smoke. Treat the Project Coordinator UUID warning as a separate diagnostic if it reappears; do not bypass Project UUID checks.
