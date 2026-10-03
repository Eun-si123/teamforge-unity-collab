# TeamForge 현재 상태

[English](STATUS.md) | **한국어** | [简体中文](STATUS.zh-Hans.md)

_마지막 문서 검토: 2026-10-03 (UTC). 게시된 r6 Artifact와 그 Exact Windows Release validation을 기존 Exact-r5 두 PC 물리 Evidence와 함께 대조했습니다. Exact-package automation과 Physical-field evidence는 계속 별도로 취급합니다._

> [!WARNING]
> **Early Public Preview — 중요한 Unity Project의 유일한 사본이나 유일한 복구 수단으로 TeamForge를 사용하지 마세요.**
>
> 기존 WP5.1 Windows 핵심 blocker 세트는 정확한 r5에서 상당한 실제 두 PC 검증을 마쳤고, r5 이후 안정화 변경은 이제 r6로 패키징되어 Exact Release 자동 검증까지 통과했습니다. 다만 r6의 Networking/Identity 변경은 남은 물리 두 PC Field 검증이 필요합니다. 테스트 중에는 Backup을 유지하고, 가능하면 버려도 되는 Project를 사용하세요.

이 파일은 **현재 기능과 Release readiness 주장에 대한 기준 Human-readable source**입니다. 다른 문서는 현재 blocker나 validation 상태를 별도로 복제하지 말고 이 문서를 링크해야 합니다.

정확한 Product/Runtime/Protocol 선택은 [`../release-contract.json`](../release-contract.json), Packaged byte identity와 superseded build 규칙은 [`../builds/README.md`](../builds/README.md), 상세 Bug 논의와 과거 재현 기록은 연결된 GitHub Issue를 사용하세요.

## 현재 상태 한눈에 보기

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- 최신 Published Packaged Candidate: **`v0.5.1-prealpha-wp5.1-r6`**
- r6 Source/tag commit: **`b479244a40ebf3f1e56787edd044d06b2d050e2b`**
- r6 Windows ZIP: **`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r6-win-x64.zip`**
- r6 Artifact SHA-256: **`4a411e8769fd39a2cfa46feaf0bb6e711e8fbd1b5c0d98b5e74a93d7ebf3a64a`**
- Packaged target: **Windows x64**
- Release readiness: **FIELD BLOCKED**
- Unity line: **`6000.3`**, 기록된 Candidate test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source와 Packaged Candidate의 차이

`v0.5.1-prealpha-wp5.1-r6`는 2026-10-03에 commit `b479244a40ebf3f1e56787edd044d06b2d050e2b`에서 게시되었습니다. 다음 Field pass를 위해 선택한 r5 이후 Windows networking, Project identity, diagnostics, packaging, foreign-lock visual feedback 안정화가 포함되어 있습니다.

게시된 r6 ZIP은 이후 Windows Exact Release Validation run `37110765817`을 통과했습니다. 해당 Run은 Release Asset을 직접 내려받아 기록된 SHA-256과 Release Manifest의 모든 파일 Hash를 검증하고, 외부 Working Directory에서 한글/공백이 포함된 경로로 Fresh extract한 뒤 Staged public/source contract, Bundled Runtime/Node, Launcher fail-closed behavior, Exact-candidate Windows path-resilience/real-junction 검사를 다시 실행했습니다.

따라서 r6에는 **Exact-package automated evidence**가 있습니다. 하지만 Windows Firewall/UAC 실제 동작, 실제 LAN reachability, Process loss 뒤 Project identity recovery, 전체 Host → Guest → Realtime user flow의 물리 두 PC Evidence를 대체하지는 않습니다.

Exact r5 Package는 2026-08-31 Scenario의 물리 Evidence Artifact로 계속 유효합니다. 해당 결과는 그대로 보존해야 하며, r6 게시가 r5 bytes나 과거 결과를 소급 변경하지 않습니다.

이 STATUS 갱신 자체는 Immutable r6 게시 후 기록되는 Metadata이므로 r6 Source commit보다 최신일 수 있습니다. 이후 `main`에 Runtime 변경이 생기면 다시 r6와 분리해서 취급해야 합니다.

### r6에 포함된 post-r5 안정화

r6에는 r5보다 최신이던 다음 제한된 Behavior가 포함됩니다.

- 사용자의 명시적 동의와 Windows UAC 승인 뒤 Coordinator/Seed용 좁은 Inbound rule을 만들 수 있는 Windows LAN Firewall onboarding. Rule은 Private profile과 `LocalSubnet`에 제한되고 TeamForge-owned reconciliation/cleanup 동작을 포함합니다.
- 선호/default Seed port가 사용 중이거나 Bind 불가능한 경우의 Startup recovery. Windows bind-context `EACCES`도 포함하며 한 번 OS-assigned port로 fallback하고 실제 선택된 endpoint를 광고합니다.
- OS-owned named-pipe live lock과 오래된 Writer용 permanent compatibility fence를 사용하는 Project identity 생성 직렬화/Windows crash recovery. 최근 Node 22/24 Windows identity-recovery job은 통과했으며, #182는 영구 Node 22 비호환이 입증된 상태가 아니라 간헐 CI 감시 Issue로 남아 있습니다.
- Coordinator rejection cleanup, HTTP cancellation/deadline hardening, Host diagnostics context 개선, WebSocket client-role log, Launcher Invite와 `TF1` code 표현 개선, 현재 `TeamForge · Locked by <owner>` SceneView feedback. #79는 Visual feedback만으로 모든 transient Gizmo motion이 제거되는 것은 아니므로 계속 Open입니다.

Linux/macOS Project identity stale-lock recovery는 Windows 전용 구현 범위 밖에 남아 있습니다.

## 기능 상태

| 영역 | 현재 Source 상태 | 현재 Evidence 경계 |
| --- | --- | --- |
| Connected-user Presence | ✅ 구현 / 검증 경험 있음 | 물리 두 PC baseline에서 동작; 더 넓은 외부 테스트는 여전히 유용 |
| Selection / Editor awareness | ✅ 구현 / 검증 경험 있음 | 더 넓은 외부 테스트는 여전히 유용 |
| Transform synchronization | 🟡 구현 / 안정화 중 | Exact r5 두 PC late-join/contention recovery PASS; r6 Exact-package automation PASS; 더 넓은 물리 Coverage와 #79 UX 후속 작업이 남음 |
| Basic Locking / Ownership | 🟡 구현 / 안정화 중 | Exact r5 contention/recovery PASS; r6에 Foreign-lock SceneView feedback 포함; transient Edit 방지/명확성은 #79가 계속 추적 |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 구현 / 안정화 중 | 지원 subset은 실제 두 PC에서 검증 경험 있음; 더 넓은 Field coverage는 유용 |
| Project bootstrap / Collaboration Invite | 🟡 구현 / 안정화 중 | Exact r5 Saved Guest reconnect PASS; r6가 Windows Project identity crash recovery를 포함하고 Exact-package automation PASS; 물리 Process-loss/conflict recovery는 Pending |
| Direct P2P Project transfer | 🟡 구현 / 안정화 중 | Exact r5 `5091` Stop/Start + 실제 Transfer PASS; r6가 Firewall onboarding/unavailable-port fallback을 포함; 실제 두 PC LAN lifecycle Evidence는 Pending |
| Diagnostics / recovery UX | 🟡 구현 / 안정화 중 | r6에 이후 Diagnostics/recovery 개선과 Privacy-safe support-bundle path 포함; 더 넓은 Field usability 검증은 유용 |
| Windows path resilience / Execution Alias | 🟡 구현 / 안정화 중 | Exact r5 실제 Long/Deep-path handoff PASS; Exact r6 Windows path/junction automation PASS; 악성/무관 Alias 거부는 Fail-closed coverage 유지 |
| Component / Inspector synchronization | ⏳ 계획 | 일반 Component Add/Remove와 `SerializedProperty` sync는 아직 지원하지 않음 |
| Prefab / 일반 Asset collaboration | ⏳ 계획 | 현재 지원 Workflow가 아님 |
| Persistent Server/Session restart recovery | ⏳ 계획 | Authority/Session state는 현재 Memory-resident |
| Automatic Internet NAT traversal / relay | 🔬 연구 / 미래 | WebRTC, ICE, STUN, TURN, Relay, Discovery, 자동 NAT traversal 없음 |

## Exact r5 실제 Field closure 기록

아래 표는 기존 blocker 세트를 아직 Exact physical validation 전이라고 잘못 표현하던 오래된 상태 문구를 대체합니다.

| Issue | Exact r5 실제 결과 | 현재 남은 경계 |
| --- | --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) — Saved Guest reconnect | **PASS** — 정상 Collaborative edit/save → Guest Unity 종료 → 같은 Verified Active Project 재실행 → `guest_handoff_mismatch` 없이 Realtime 재접속 | Fresh/unverified identity rejection은 Strict implementation과 Automated regression coverage로 보호 |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) — Fresh late-join snapshot conflict | **PASS** — Fresh Guest가 Authoritative Hierarchy/Transform/Lock state를 받고 이후 Live Transform도 False protected conflict 없이 적용 | 더 넓은 Scenario는 유용하지만 기존 Field blocker는 종료 |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) — stale lock-contention protected conflict | **PASS** — Losing side가 Authoritative state로 복구되고 이후 Collaboration도 계속 사용 가능 | 다른 Peer가 Lock을 가진 동안의 UX 명확성은 #79로 별도 추적 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) — Receive shutdown | **PASS** — Receive 중 Launcher를 Task Manager로 여러 번 강제 종료하고 다시 시작해 Verified partial data를 재사용하여 Resume 완료, 기존 CLR/Application error 재현 안 됨 | 향후 Runtime 변경도 Regression coverage를 유지해야 하지만 기존 r5 Field blocker는 종료 |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) — Seed / Firewall onboarding | **r5 Product goal 기준 PARTIAL / Stable-Seed path는 PASS** — Packaged Host Stop/Start 후 TCP `5091` 재바인딩과 실제 Guest transfer 성공, 단 Firewall access는 미리 필요 | Fresh automatic Windows Firewall onboarding과 더 최신 unavailable-port fallback은 r5 이후 추가되어 Exact replacement-package physical evidence 필요 |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) — Execution Alias handoff | **PASS** — Long/Deep destination에서 Path optimization이 작동하고 Unity 실행 및 Realtime collaboration 성공 | 악성/무관/retargeted Alias 거부는 Automated fail-closed coverage |

상세 Timeline은 GitHub Issue가 소유합니다. 이 페이지는 현재 Release effect를 소유합니다.

## Automated / Local evidence

PR #81 병합 전 Final integrated head는 `docs/MAIN_PATCH_STATUS_2026-08-27.md`에 기록된 Repository protection gate를 통과했습니다.

- CI run #216: Server, Project Peer, Launcher runtime loader, Windows Launcher, Public-source contract — **PASS**
- Dependency Review run #140 — **PASS**
- Unity Tests run #73 — **PASS**
  - Unity Lock Contention E2E
  - Unity Realtime Authority E2E
  - Realtime Authority Chaos E2E
  - Project Transfer Resume E2E
- 이전 Local Unity Test Runner: **143 / 143 locally runnable tests PASS**, CI-only real-server test 2개는 Local에서 의도적으로 Ignore
- Same-machine A/B contention recovery — **PASS**
- A/B/C late-join Hierarchy/Transform convergence — **PASS**, 기록된 run에서 protected conflict 0

이후 Source hardening도 Focused Project Peer/Launcher/Unity tests와 일반 Repository quality gate를 거쳤습니다. 특히 Windows Project identity crash/concurrency suite는 지원되는 Node 22/24 line에서 통과했고, unavailable Seed port regression path도 재현 Windows 환경의 Full Project Peer suite를 통과했습니다.

게시된 r6 Artifact는 추가로 Exact Release Validation run `37110765817`을 통과했습니다. Release download/hash identity, Release-manifest file hash, 한글/공백 경로 Fresh extraction, Staged public/source validation, Bundled Runtime/Node, Launcher fail-closed Runtime behavior, Exact-candidate Windows path-resilience/real-junction 검사가 모두 PASS했습니다. 이는 해당 자동 검사에 대한 Package evidence이며, 남아 있는 두 PC LAN/UAC/Process-loss Field scenario를 대체하지 않습니다.

## 기록된 물리 두 PC Evidence

### 2026-08-22 baseline

Targeted blocker를 분리하기 전 Physical Windows flow에서 다음이 동작했습니다.

- Host → Signed Collaboration Invite → Fresh Guest → Authentication → Direct Project transfer → Publisher trust → Verified Active Project → Unity realtime connection;
- Presence와 Bidirectional Transform sync;
- 정상 Lock/Ownership contention;
- 지원되는 Same-Scene Hierarchy create/rename/reparent/sibling-order/delete;
- Unsaved Guest exit/reopen 후 살아 있는 Session에서 Authoritative Hierarchy/Transform/Lock recovery;
- Coordinator TCP interruption → Retry → Unity restart 없이 자동 Reconnect.

### 2026-08-31 Exact r5 closure

Exact r5 ZIP/SHA pair를 Windows 물리 PC 두 대에서 사용해 위 표의 Saved reconnect, Fresh late-join, 반복 Receive resume, Long/Deep-path, Lock contention recovery scenario를 닫았습니다. 같은 Field pass에서 Packaged Stable Seed `5091` Stop/Start와 실제 LAN transfer도 확인했으며, 당시 Fresh Firewall onboarding에는 수동 허용이 필요했다는 경계도 함께 기록했습니다.

## Evidence 경계

한 결과는 실제로 실행한 것만 증명합니다.

- Source CI는 Packaged ZIP이 올바르다는 증거가 아닙니다.
- Unity automation은 모든 SceneView input ordering, Windows process condition, LAN/Firewall state, 두 번째 Machine timing을 재현하지 않습니다.
- Same-machine multi-project test는 신뢰도를 높이지만 같은 OS/Network stack/Timing/Hardware를 공유합니다.
- Exact r5 physical evidence는 실행된 r5 bytes와 Scenario를 증명할 뿐, r6 전용 Networking/Identity behavior를 증명하지 않습니다.
- Exact r6 Automated Release validation은 실행된 r6 Artifact/Hash/Manifest/Extraction/Runtime/Launcher/Path 검사를 증명하지만, 두 번째 Machine의 LAN reachability, UAC/Firewall lifecycle, 실제 Process-loss recovery, SceneView UX timing까지 증명하지는 않습니다.
- Product version만으로는 Byte identity가 되지 않습니다. Exact package evidence에는 정확한 Artifact filename과 SHA-256이 필요합니다.
- Bug Issue가 Closed라고 해서 같은 Subsystem의 모든 이후 구현까지 Package/Field evidence를 얻는 것은 아닙니다.
- Historical phase/work-state/evidence note는 당시 Snapshot에는 유효하지만 현재 Readiness에서는 이 페이지를 대체하지 않습니다.

## 남은 Release-readiness gate

TeamForge를 일반 설치 가능한 Alpha로 올리기 전에는:

1. 남은 post-r5 Field pass에서는 위 Exact r6 identity를 사용합니다. r6 bytes를 다시 빌드하거나 조용히 교체하면 안 됩니다.
2. Exact r6에서 Fresh Firewall onboarding/UAC flow, Narrow rule scope/lifecycle, Preferred-port unavailable/collision fallback, 실제 Advertised Seed reachability, Host Stop/Start, Fresh Guest transfer를 물리 두 PC로 검증합니다.
3. Exact r6에서 비정상 Process loss 뒤 Windows Project identity recovery를 검증하고 Ambiguous/Conflicting identity가 계속 Fail-closed인지 확인합니다.
4. Exact r6 Fresh extraction으로 Host → Fresh Guest → Realtime collaboration smoke를 수행합니다. 두 Editor를 쓰는 김에 Foreign-lock feedback이 이해 가능하고 Release/Takeover 뒤 정상 해제되는지도 확인합니다. #79는 별도 UX 후속 Issue로 유지합니다.
5. #182는 간헐 CI 감시 Issue로 유지합니다. 다시 발생하면 Classified diagnostics를 사용하고 Retry/Skip으로 Fail-closed lock을 가리지 않습니다.
6. 실제 실행한 Scenario만 새 r6 Evidence로 기록하고, 완료된 r5 Physical evidence와 분리해 보존합니다.
7. Install/Update/Uninstall 안내를 계속 개선하고 폭넓은 Reliability 주장을 하기 전 Project creator 외 사용자의 Testing/Review를 확보합니다.

Server process restart는 현재 **Disconnect/Fail-closed/New-session recovery** Scenario이지 Persistence test가 아닙니다. Durable Authority/Session restart recovery는 구현되어 있지 않습니다.

## 정보 소유권

문서 Drift를 피하기 위해 다음 질문은 아래 Source를 사용합니다.

| 질문 | 기준 Source |
| --- | --- |
| 지금 무엇이 동작하고 무엇이 막혀 있나? | **이 `STATUS.ko.md` / 영어 `STATUS.md`** |
| 정확한 Version/Runtime/Protocol 선택은? | [`release-contract.json`](../release-contract.json) |
| 현재/Superseded Packaged bytes는? | [`builds/README.md`](../builds/README.md) + GitHub Release SHA-256 |
| TeamForge가 End-to-end로 어떻게 동작하나? | [`HOW_IT_WORKS.ko.md`](HOW_IT_WORKS.ko.md) |
| 앞으로 무엇을 할 계획인가? | [`ROADMAP.ko.md`](ROADMAP.ko.md) |
| 현재 System 구조는? | [`architecture.md`](architecture.md) |
| Architecture 결정 이유는? | [`architecture-decisions.md`](architecture-decisions.md) |
| Named validation scenario는 어떻게 실행하나? | [`TEST_LAB.md`](TEST_LAB.md) |
| Bug의 상세 상태는? | GitHub Issues |
| 과거 Test/Stabilization pass에서 무슨 일이 있었나? | Dated phase/work-state/evidence notes |
