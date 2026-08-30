# TeamForge physical two-PC field evidence — 2026-08-30

> [!NOTE]
> **Dated engineering evidence, not the current status source.**
>
> This note records the physical two-PC Windows field run performed on 2026-08-30. For current capability and release readiness, use **[STATUS.md](STATUS.md)**. This note deliberately distinguishes observed behavior from exact packaged-release closure.

## Purpose

The run revisited the Windows field-blocker line associated with #67, #68/#74, #69, #70, and #71 after the fixes merged through PR #81 and were published in `v0.5.1-prealpha-wp5.1-r4`.

The field run is valuable post-fix evidence, but it was a **mixed-provenance Host/Guest run** rather than an exact r4 packaged Host + exact r4 packaged Guest run. It therefore must not be used to claim that the r4 artifact is fully field-closed.

## Environment and provenance

### Host PC (PC A)

- Windows x64 physical machine.
- Unity Editor: `6000.3.21f1`.
- Repository revision: `main` at `ac53e931488a60daa82b2c50e8e6817654981f5a`.
- `git status` reported only one unrelated local documentation modification: `docs/roadmap.md`.
- TeamForge Unity package was used as an embedded package under the test Project's `Packages/com.eunsung.teamforge/` directory after the previous copy was removed and a fresh current-source copy was placed there.
- The copied source package did **not** contain generated `Runtime~`, so this was a source/development Host path rather than the exact packaged Host runtime path.
- Host/Server/Seed therefore must be treated as source/development execution evidence, not exact packaged-Host evidence.

The following field-relevant Unity files in the actual embedded Host Project were hashed after the run and matched the r4 publication source blobs exactly:

| File | Git blob SHA |
| --- | --- |
| `Editor/TransformSync/TeamForgeTransformSyncService.cs` | `6465a68a5498a8922061cf183bf16e891066ad71` |
| `Editor/UX/TeamForgeGuestHandoff.cs` | `991182dd01df89bb926ef91d63ceaaca0e2a8603` |
| `Editor/UX/TeamForgeVerifiedGuestReconnect.cs` | `38f43f4fc4d1fdd89ce95463ef42e78f0c0039de` |

Relevant current Host orchestration and realtime authority source also remains unchanged from the r4 publication snapshot for the paths inspected during review, including the Host orchestration used for the fixed Seed port.

### Guest PC (PC B)

- Separate physical Windows PC on the same LAN.
- Guest was started only through the packaged Windows Launcher from `v0.5.1-prealpha-wp5.1-r4`.
- r4 publication source commit: `5fdebda8c91e3c858e894356eb4bb735bbc34885`.
- r4 artifact: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-candidate-win-x64.zip`.
- r4 SHA-256: `390ecbe4dad9488acdd992cc7198b25bf6407debf050d78385b01e076275c030`.

## Observed results

The tester reported the following manual physical two-PC scenarios as working during the run:

- Host -> signed Collaboration Invite -> Guest Launcher -> authentication -> direct Project transfer -> Publisher trust -> verified Active Project -> Unity realtime connection.
- Presence / `People: 2` and bidirectional Transform synchronization.
- Supported same-Scene Hierarchy create, rename, reparent, sibling-order, and delete propagation.
- #67 positive saved-Guest reconnect path: Guest made a legitimate collaborative change, saved the Scene, exited Unity while the Host/session stayed running, reopened the same verified Active Project, and rejoined without the prior `guest_handoff_mismatch` failure.
- #68/#74 targeted lock-contention exercise: two physical peers contended for the same Transform; after the losing-side interaction ended, collaboration remained usable and did not remain in the earlier persistent protected-conflict state in the observed run.
- #69 interruption/resume exercise: the receiving packaged Guest Launcher was closed/interrupted during `guest_state: Receiving`, then restarted with the same invite/destination and recovered/resumed without the previously observed unhandled CLR/application-error dialog in this run.
- #70 real-LAN direct transfer operated with the production Seed listening on TCP `5091`.
- #71 long/deep Guest destination triggered the path-budget-risk path and proceeded through verification, receive, activation, and Unity launch without the former positive-path handoff rejection.
- A normal final regression path remained usable after the targeted exercises.

### Captured #70 signal

The Host showed the fixed direct Seed listening on the intended LAN port:

```text
TCP    0.0.0.0:5091    0.0.0.0:0    LISTENING    19988
```

This is useful evidence that the field run exercised a stable TCP `5091` Seed rather than the earlier random `--port 0` behavior.

### Captured #71 signal

The packaged Guest Launcher reported:

```text
runtime_verification_started
runtime_verification_passed
path_budget_risk_detected: automatic Unity path optimization will be selected after verification
guest_state: ImportingInvite
guest_state: Connecting
guest_state: Receiving
guest_state: Complete
guest_active_verified: unity=6000.3.21f1
unity_open_started
```

The tester subsequently reported the opened Unity Guest and realtime collaboration as functioning normally. This is evidence for the intended positive `ExecutionAlias` / path-resilience field path rather than only an ordinary short-path launch.

## Evidence boundary and remaining gaps

This run should be treated as **strong post-fix physical interoperability evidence**, not as stronger evidence than it actually is.

It does **not** establish all of the following:

- exact r4 packaged Host + exact r4 packaged Guest byte-for-byte field closure; the Host used current source/development execution;
- a deliberately isolated #68 fresh-baseline late-join case where an authoritative Hierarchy snapshot dirties the Scene before the Transform snapshot and later live Transform traffic is checked;
- #67's negative fail-closed case for an unrelated, wrong-identity, stale, or otherwise unverified Guest Project/session/path;
- #71's negative fail-closed case for a retargeted/unrelated execution alias;
- a statistical guarantee for #69's race-sensitive shutdown bug; the prior failure was intermittent, so one successful close/termination sequence is evidence but not proof of the word `never` in the issue acceptance criteria;
- packaged-Host firewall/runtime behavior, because PC A did not use the generated packaged Host `Runtime~` tree.

## Release-readiness interpretation

Recommended interpretation of this dated run:

1. The post-fix blocker code now has meaningful real two-PC Windows evidence in addition to automated, CI, same-machine, and previous field evidence.
2. Do **not** retroactively relabel r4 as fully field-closed.
3. Keep the product readiness state `FIELD_BLOCKED` until a single new immutable candidate built from current `main` is validated as the exact packaged Host and exact packaged Guest used for final closure.
4. Use the new exact candidate run to close only the remaining evidence boundary instead of repeating every exploratory test from scratch.

## Minimal final exact-candidate closure target

For the next immutable candidate, the final physical run should use the **same exact candidate ZIP/hash on both machines** and cover:

- fresh packaged Host -> fresh packaged Guest -> Project transfer -> `People: 2` -> basic Transform/Hierarchy smoke;
- #67 saved Guest reconnect plus one wrong/unverified identity rejection check;
- #68/#74 rapid two-PC contention recovery plus the distinct fresh late-join snapshot scenario;
- #69 receive interruption/resume with repeated abrupt-termination attempts sufficient to give the intermittent race meaningful coverage;
- #70 Host stop/start with Seed rebind on TCP `5091` and successful fresh Guest transfer;
- #71 long/deep-path positive handoff plus one retargeted/unrelated alias rejection check;
- exact artifact filename, SHA-256, Unity version, and physical Host/Guest identities recorded with the field result.

If those exact-candidate checks pass, the remaining WP5.1 field-blocker evidence can be reevaluated for issue closure and removal of the `FIELD_BLOCKED` release gate.