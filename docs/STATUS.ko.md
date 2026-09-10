# TeamForge 현재 상태

[English](STATUS.md) | **한국어** | [简体中文](STATUS.zh-Hans.md)

_마지막 문서 검토: 2026-09-10 (UTC). 현재 `main`에 들어 있는 r5 이후 Windows 네트워크/진단/Project identity hardening, 게시된 r5 Artifact, 그리고 2026-08-31에 기록된 정확한 r5 실제 Field 결과를 함께 대조했습니다. 게시된 Package evidence와 더 최신 Source evidence는 계속 별도로 취급합니다._

> [!WARNING]
> **Early Public Preview — 중요한 Unity Project의 유일한 사본이나 유일한 복구 수단으로 TeamForge를 사용하지 마세요.**
>
> 기존 WP5.1 Windows 핵심 blocker 세트는 정확한 r5에서 상당한 실제 두 PC 검증을 마쳤습니다. 하지만 현재 `main`은 r5보다 더 최신이며, 추가된 Windows networking/identity 동작은 아직 하나의 정확한 replacement package로 만들어 물리 PC에서 검증되지 않았습니다. 테스트 중에는 Backup을 유지하고, 가능하면 버려도 되는 Project를 사용하세요.

이 파일은 **현재 기능과 Release readiness 주장에 대한 기준 Human-readable source**입니다. 다른 문서는 현재 blocker나 validation 상태를 별도로 복제하지 말고 이 문서를 링크해야 합니다.

정확한 Product/Runtime/Protocol 선택은 [`../release-contract.json`](../release-contract.json), Packaged byte identity와 superseded build 규칙은 [`../builds/README.md`](../builds/README.md), 상세 Bug 논의와 과거 재현 기록은 연결된 GitHub Issue를 사용하세요.

## 현재 상태 한눈에 보기

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- 최신 Published Packaged Candidate: **`v0.5.1-prealpha-wp5.1-r5`**
- r5 Source/tag commit: **`a97b6ba5649e2888b909bf3c99c64acfd7042ba6`**
- r5 Windows ZIP: **`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`**
- r5 Artifact SHA-256: **`5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`**
- Packaged target: **Windows x64**
- Release readiness: **FIELD BLOCKED**
- Unity line: **`6000.3`**, 기록된 Candidate test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source와 Packaged Candidate의 차이

기존 WP5.1 안정화 Fix인 #67, #68/#74, #69, #70, #71은 PR #81을 통해 통합되었습니다. 이후 `v0.5.1-prealpha-wp5.1-r5` Candidate가 commit `a97b6ba5649e2888b909bf3c99c64acfd7042ba6`에서 게시되었고, 이 r5에는 기존 blocker fix뿐 아니라 r4 이후 추가된 Windows Launcher **Save support bundle**도 포함되어 있습니다.

2026-08-31에는 정확한 r5를 Windows 물리 PC 두 대에서 검증했습니다. 기록상 Saved Guest reconnect(#67), Fresh late-join Transform snapshot regression(#68), 반복 Receive shutdown/resume race(#69), Long/Deep-path Execution Alias handoff(#71), stale lock-contention protected-conflict recovery(#74)가 r5 실제 테스트로 닫혔습니다. 같은 r5 LAN 테스트에서는 필요한 Firewall access가 존재하는 상태에서 Packaged Host의 Stop/Start 후 Seed TCP `5091` 재바인딩과 실제 Guest Project transfer도 물리적으로 확인했습니다.

따라서 이 기존 Scenario들은 **아직 r5 실제 재검증을 한 번도 하지 않은 상태가 아닙니다.** 다만 이 Evidence가 r5 이후 Source 변경을 r5에 포함시키는 것은 아니며, TeamForge 전체를 일반 설치용 Alpha로 만들어 주는 것도 아닙니다.

현재 `main`은 r5보다 더 최신입니다. 따라서:

- 최신 Published Package와 2026-08-31 Exact field evidence를 말할 때는 **r5**를 기준으로 합니다.
- r5와 현재 `main`의 bytes나 behavior가 동일하다고 설명하면 안 됩니다.
- 오래된 STATUS 문구가 Pending으로 남아 있었다는 이유만으로 이미 닫힌 r5 blocker scenario를 다시 미완료로 취급하지 않습니다.
- 현재 `main`을 새 Candidate로 배포한다면 새 Immutable Artifact를 만들고, r5 이후 실제로 추가된 동작을 그 정확한 Artifact에서 검증해야 합니다.

### r5에 포함되지 않은 이후 Source hardening

현재 Source에는 r5 게시 이후 다음과 같은 제한된 Behavior 변경이 추가되어 있습니다.

- 사용자가 명시적으로 동의하고 Windows UAC를 승인한 뒤 Coordinator/Seed용 좁은 Inbound rule을 만들 수 있는 Windows LAN Firewall onboarding. Rule은 Private profile과 LocalSubnet에 제한되며 TeamForge-owned rule의 reconciliation/cleanup 동작도 포함합니다. 기존 r5 실제 LAN 테스트 당시에는 여전히 수동 Firewall 허용이 필요했으므로, 이 더 최신 Onboarding path는 더 강한 Readiness 주장을 하기 전에 Exact-package physical evidence가 필요합니다.
- 선호/default Seed port가 이미 사용 중이거나 Bind 불가능할 때의 Startup recovery. Windows bind-context `EACCES`도 포함하며, Host는 한 번 OS-assigned port로 재시도하고 선택된 endpoint를 광고합니다. Windows Project Peer automated coverage는 있지만 이 동작은 r5보다 최신입니다.
- Project identity 생성의 Process 간 직렬화와 Windows crash recovery. Live ownership은 OS-owned named-pipe lock을 사용하고, 오래된 Writer와의 혼합 버전 안전성을 위해 영구 compatibility fence를 유지합니다. Windows Node 22/24 crash/concurrency suite는 통과했지만 이 변경을 포함한 Published Package의 Exact physical evidence는 아직 없습니다.
- Coordinator rejection cleanup, HTTP cancellation/deadline hardening, Host diagnostics context 개선, WebSocket client-role log, Launcher Invite와 `TF1` Connection Code 구분 개선.

이들은 Current Source/automation 사실이지 r5 Packaged behavior가 아닙니다. 또한 Linux/macOS의 Project identity stale-lock recovery는 Windows 전용 변경의 지원 범위 밖에 남아 있습니다.

## 기능 상태

| 영역 | 현재 Source 상태 | 현재 Evidence 경계 |
| --- | --- | --- |
| Connected-user Presence | ✅ 구현 / 검증 경험 있음 | 물리 두 PC baseline에서 동작; 더 넓은 외부 테스트는 여전히 유용 |
| Selection / Editor awareness | ✅ 구현 / 검증 경험 있음 | 더 넓은 외부 테스트는 여전히 유용 |
| Transform synchronization | 🟡 구현 / 안정화 중 | Exact r5 두 PC late-join과 contention recovery PASS; 더 넓은 Field coverage와 UX 후속 작업이 남음 |
| Basic Locking / Ownership | 🟡 구현 / 안정화 중 | Exact r5 contention/recovery PASS; 다른 Peer가 Lock을 가진 상태의 Edit UX는 #79 후속 작업 |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 구현 / 안정화 중 | 지원 subset은 실제 두 PC에서 검증 경험 있음; 더 넓은 Field coverage는 유용 |
| Project bootstrap / Collaboration Invite | 🟡 구현 / 안정화 중 | Exact r5 Saved Guest reconnect PASS; post-r5 Project identity crash recovery는 Package/Field evidence가 아직 없음 |
| Direct P2P Project transfer | 🟡 구현 / 안정화 중 | Exact r5 `5091` Stop/Start + 실제 Transfer PASS; post-r5 Firewall onboarding과 unavailable-port fallback은 replacement-package Field evidence가 아직 없음 |
| Diagnostics / recovery UX | 🟡 구현 / 안정화 중 | r5에 Privacy-safe Launcher support bundle 포함; 이후 Diagnostics 개선은 r5 대비 Source-only |
| Windows path resilience / Execution Alias | 🟡 구현 / 안정화 중 | Exact r5 실제 Long/Deep-path positive handoff PASS; 악성/무관 Alias 거부는 Automated fail-closed coverage |
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

이후 Source hardening도 Focused Project Peer/Launcher/Unity tests와 일반 Repository quality gate를 거쳤습니다. 특히 Windows Project identity crash/concurrency suite는 지원되는 Node 22/24 line에서 통과했고, unavailable Seed port regression path도 재현 Windows 환경의 Full Project Peer suite를 통과했습니다. 하지만 이 결과는 Fix가 들어가기 전에 게시된 bytes에 Package evidence를 소급해 만들지 않습니다.

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
- Exact r5 physical evidence는 실행된 r5 bytes와 Scenario를 증명할 뿐, 더 최신 `main` behavior를 증명하지 않습니다.
- Product version만으로는 Byte identity가 되지 않습니다. Exact package evidence에는 정확한 Artifact filename과 SHA-256이 필요합니다.
- Bug Issue가 Closed라고 해서 같은 Subsystem의 모든 이후 구현까지 Package/Field evidence를 얻는 것은 아닙니다.
- Historical phase/work-state/evidence note는 당시 Snapshot에는 유효하지만 현재 Readiness에서는 이 페이지를 대체하지 않습니다.

## 남은 Release-readiness gate

TeamForge를 일반 설치 가능한 Alpha로 올리기 전에는:

1. Exact r5 physical 결과는 완료된 Evidence로 보존합니다. #67/#68/#69/#71/#74가 마치 r5 closure를 한 적 없는 것처럼 다시 Pending 목록에 들어가면 안 됩니다.
2. 현재 `main`을 배포 대상으로 선택한다면 post-r5 Runtime behavior가 r5에 없으므로 새 Immutable Candidate를 게시해야 합니다.
3. 그 정확한 Replacement Artifact에서 사용자에게 중요한 post-r5 Windows Networking lifecycle을 검증합니다: Fresh Firewall onboarding, Narrow rule scope/lifecycle, Preferred-port unavailable/collision fallback, 실제 Advertised Seed reachability, Host Stop/Start, Fresh Guest transfer.
4. Exact replacement artifact에서 post-r5 Windows Project identity crash recovery를 검증합니다. Process loss 뒤 안전한 재시작과 Ambiguous/Conflicting identity의 Fail-closed 유지도 포함합니다.
5. 새 Packaging/Integration 변경이 r5 Evidence를 자동 상속한다고 가정하지 않도록 Exact replacement artifact에서 Fresh extraction Host → Fresh Guest → Realtime collaboration smoke test를 수행합니다.
6. Exact Candidate filename/SHA/Source identity를 남기고 실제 실행한 Scenario만 Evidence로 기록합니다.
7. Install/Update/Uninstall 안내를 계속 개선하고, 폭넓은 Reliability 주장을 하기 전 Project creator 외 사용자의 Testing/Review를 확보합니다.

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
