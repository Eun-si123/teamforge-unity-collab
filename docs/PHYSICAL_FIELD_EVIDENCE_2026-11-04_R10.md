# TeamForge r10 physical two-PC field evidence — 2026-11-04 (KST)

> Field report, not a release certification. The tester reported the results in ChatGPT on 2026-11-04 KST. Current capability and readiness are maintained in [STATUS.md](STATUS.md).

## Provenance and environment

- Candidate identified by the tester as **r10**; published [v0.5.1-prealpha-wp5.1-r10](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r10).
- Published immutable Windows x64 release: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r10-win-x64.zip`; release source `693d3a9d647f9a511012f1ebba3209834531656e`; published ZIP SHA-256 `01afb269bd6235470bd75d1dda6a6c0119d0e21acea87087fe1115d0cd002f89`.
- Release [Exact Release Validation run 41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102) completed successfully for the published release. This is independent **packaging automation**, not the physical test.
- Physical roles: Windows desktop Host and slower, remotely managed **headless Windows laptop Guest** on a LAN; Unity **6000.3.21f1**.
- **Evidence boundary:** tester described both sides as r10, but did **not** supply individually checked installed-Host/Guest ZIP hashes, exact Windows builds or full per-step trace. Do not claim byte-for-byte exact-r10-on-both-PC closure from this report alone.
- The tester supplied short diagnostics and a Unity screenshot, not an exported, complete or privacy-sanitized support bundle. The screenshot contained local environment detail and is **not embedded in this public repository**.

## User-reported positive outcomes

| Scenario | Reported result | Detail and boundary |
| --- | --- | --- |
| Host Ready | **PASS** | Host reached Ready |
| Signed Guest invite / Publisher trust | **PASS** | `publisher_trust_approved` was observed |
| Project transfer, verification and activation | **PASS** | `guest_state: Complete`; `guest_active_verified: unity=6000.3.21f1` |
| Guest Unity launch / realtime join | **PASS** | `unity_open_started`; screenshot showed live Guest `Connected. Server 0.5.1` |
| Presence, Transform, basic Lock, supported Hierarchy | **PASS** | User-reported functional operation between the Editors |
| Host stop/start and recovery | **PASS** | User-reported restart/recovery; this does **not** imply durable persistence of Server Session state |
| Cancelled transfer followed by receive/resume | **PASS** | User-reported completion after interruption; not a claim of force-kill/process-loss coverage |
| Guest Unity close and verified-project reopen | **PASS** | User-reported successful Guest reconnect |
| Incorrect access code rejected, valid retry | **PASS** | User-reported negative authentication test |
| Host state changed before Guest late join | **PASS** | User-reported later join and current state recovery |
| Long/deep destination with ASCII shell metacharacters | **PASS** | Unity opened, Scene objects rendered, TeamForge connected and applied a Transform snapshot; actual path omitted for privacy |
| Invite replacement / transient code clearing / trust check | **PASS (user report)** | Tester later reported success; exact substeps and a distinct-Publisher negative challenge were not independently recorded |

The screenshot showed the supported Scene opened in **6000.3.21f1**, no Unity Console errors or warnings at that captured moment, and a TeamForge Transform snapshot at **revision 44** with two object states and zero protected conflicts. Unity's asset-search-index background task was still running; completing that index was not part of the asserted TeamForge PASS.

The destination test exercised an unusually long directory name and ASCII characters with shell meaning. It **did not separately establish Korean characters or spaces**, every possible path character, an actual short-execution-alias path, or arbitrarily long Windows path support. The positive result is limited to the observed destination and Unity launch / realtime state.

## Blocked / not exercised

- **Actual Guest Wi-Fi/NIC disconnection and subsequent reconnect: BLOCKED / NOT RUN.** Cutting the headless laptop's network would also cut its remote administration connection. [Issue #457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457) tracks an isolated, non-disruptive TeamForge-only transport fault-injection Test Lab/CI scenario. Automation is **not** equivalent to a real Wi-Fi loss field pass.
- The reported Host restart was not a claim that the current Server restores a persistent session across process restarts.
- No separately evidenced clean non-elevated UAC/firewall onboarding; explicit preferred Seed-port collision/fallback; disappearance of an apparently Ready Host's Direct Seed; abrupt process loss/identity fence recovery; unrelated or retargeted execution alias rejection; all negative Publisher/Owner identity changes; installer/update/uninstaller lifecycle; or broad Component/Prefab/Asset synchronization.
- Slow-laptop repeated Launcher double-clicks opened multiple instances during r10 testing. This **UX defect was observed**, not a field PASS; [Draft PR #456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456) addresses duplicate launch and early startup feedback **after** immutable r10, with separate Windows CI evidence. It is **not** included in r10.

## Interpretation and next validation

This is substantial positive **user-reported two-PC physical evidence** for basic collaboration, receive/recovery, safe negative access-code handling, late join and one challenging Windows destination. It improves confidence without converting the release into general availability or treating unperformed negative/physical checks as PASS.

For later code changes, re-run regression tests **by changed subsystem** rather than repeatedly redoing already-passed happy-path steps: Project Peer receive and identity/fallback; Launcher startup and credentials; Unity realtime authority / late join; and the safe, isolated connection-loss scenario in #457. Validate the new immutable candidate's ZIP identity and separate source/CI/physical evidence before updating release readiness.

The canonical release-metadata/STATUS mirrors still require coordinated translation review before moving from r9 to the published r10 identity; this is tracked separately in [#459](https://github.com/Eun-si123/teamforge-unity-collab/issues/459). This dated report preserves field evidence without bypassing the localization freshness gate.

Do not publish raw invites, access codes, addresses, full paths or the original screenshot as public evidence.
