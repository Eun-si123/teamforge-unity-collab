# TeamForge UX Pass 2 Hotfix2 Work State

Date: 2026-08-10 Asia/Seoul
Base: UX Pass 2 Hotfix1 / Hotfix6 authority model
Status: Test Lab clone Scene-startup fix implemented; static validation in progress at creation time
Phase 5: NOT STARTED

## Confirmed field evidence before this hotfix

- Unity `6000.3.21f1` Hotfix1 compile succeeded.
- EditMode **90/90 PASS**.
- Local Coordinator connection succeeded with A/B and Presence reported 2 connected.
- Quick A/B/C Lab clone B launched but was on unsaved `Untitled` Scene when it auto-connected.
- B then rejected the authoritative Hierarchy snapshot because the host saved Scene was not loaded.
- Home UI incorrectly labeled this state `Collaboration active` even though Hierarchy was not ready.
- Project Coordinator UUID warning remains separately tracked; root cause not proven by this run.

## Hotfix2 decisions

- Carry exact host Scene baseline in clone bootstrap.
- Resolve Scene GUID and verify saved Scene SHA before realtime auto-connect.
- Open exact baseline Scene with `EditorSceneManager.OpenScene(..., OpenSceneMode.Single)`.
- Never auto-save/discard dirty clone Scene state; fail closed.
- Yield one Editor update after Scene load before Connect so Scene/Hierarchy callbacks settle.
- Prepare C's Scene too, but keep C offline for Late Join.
- Expose Hierarchy snapshot readiness so Home cannot claim full readiness prematurely.
- Keep Coordinator/Project Peer/protocol/authority unchanged.

## Next field gate

- Unity compile Error 0.
- EditMode Failed 0; source-discovered expected count 91.
- Quick A/B/C Lab: B must open host SampleScene then auto-connect; C must open host SampleScene and remain offline.
- No `Authoritative Scene ... is not loaded` or `Scene '' was not added to Transform baseline` during B bootstrap.
- Then C Late Join field test.
