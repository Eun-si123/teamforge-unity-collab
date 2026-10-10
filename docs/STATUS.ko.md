# TeamForge 현재 상태

[English](STATUS.md) | **한국어** | [简体中文](STATUS.zh-Hans.md)

_마지막 문서 검토: 2026-10-10 (UTC). 최신 r8 배포판 검증과 미완료 물리 테스트, 이후 main 변경을 구분합니다._

> [!WARNING]
> **Early Public Preview — 중요한 Unity Project의 유일한 사본이나 유일한 복구 수단으로 TeamForge를 사용하지 마세요.**
>
> 기존 r5 두 PC 검증, r6 결함 발견, r6/r7 혼합 환경의 결과는 각각 해당 배포판에 대해서만 유효합니다. 새로운 불변 r8 배포판에는 PR #209의 후속 복구 수정이 포함됐고 Windows Exact Release 자동 검증을 통과했지만 **실제 두 PC 재검증은 아직 없습니다.** 버려도 되는 프로젝트와 백업을 사용하세요. 출시 상태는 계속 **FIELD BLOCKED**입니다.

이 파일은 **현재 기능과 Release readiness 주장에 대한 기준 Human-readable source**입니다. 다른 문서는 현재 blocker나 validation 상태를 별도로 복제하지 말고 이 문서를 링크해야 합니다.

정확한 Product/Runtime/Protocol 선택은 [`../release-contract.json`](../release-contract.json), Packaged byte identity와 superseded build 규칙은 [`../builds/README.md`](../builds/README.md), 상세 Bug 논의와 과거 재현 기록은 연결된 GitHub Issue를 사용하세요.

## 현재 상태 한눈에 보기

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- 최신 Published Packaged Candidate: **v0.5.1-prealpha-wp5.1-r8**
- r8 Source/tag commit: **4aff5756329c2fe013d78344859e0760c6a382ef**
- r8 Windows ZIP: **Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r8-win-x64.zip**
- r8 Artifact SHA-256: **3a003791043c067009250bf59da4d916e75eb6dc1b1ed0e93d54984a2d23eb21**
- Packaged target: **Windows x64**
- Release readiness: **FIELD BLOCKED**
- Unity line: **`6000.3`**, 기록된 Candidate test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source와 Packaged Candidate의 차이

[새 r8 사전 배포판](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r8)은 **2026-10-10**, 병합 커밋 **4aff5756329c2fe013d78344859e0760c6a382ef**에서 발행됐습니다. r7 이후 PR #209에서 수정한 Host Direct-Seed health, Existing-Active의 검증된 짧은 실행 경로, 잘못된 중첩 Managed root 거부가 **r8 배포 파일에 포함**됐습니다.

r8 Windows 게시 워크플로는 Runtime/Launcher/Staging/ZIP/Provenance 검증을 통과했습니다. 실제 게시 ZIP을 다시 내려받은 [Exact Release Validation #38019297086](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/38019297086)도 SHA-256·Manifest 개별 파일 Hash·한글/공백 경로 추출·Runtime/Launcher·Windows Path/Junction 테스트를 **통과**했습니다. 이것은 **배포 파일 자동 검증**이지 실제 두 PC의 Host/Guest 복구 성공 증거는 아닙니다.

기존 배포판은 변경하지 않았습니다. r5의 2026-08-31 물리 테스트, r6의 2026-10-03 결함 발견, r7의 정확한 ZIP 자동 검증과 혼합 r6 Host/r7 Guest 현장 성공은 모두 해당 바이트에 대한 역사적 증거로 유지됩니다.

r8 소스 커밋 이후 병합된 PR #217(SceneView 잠금 경고 다시 그리기)과 PR #219(Seed별 전송 측정/벤치마크)는 **r8 ZIP에 포함되지 않습니다.** 현재 main의 Source, Packaged ZIP, Unity 자동화, 물리 테스트 결과를 구분합니다. 이후 main 변경은 이미 게시된 r8 ZIP의 바이트나 기존 검증 결과를 소급 변경하지 않으므로 반드시 분리해서 취급합니다.

### r7-on-Host 후속 결함과 r8 현장 재검증 대상

[2026-10-04 r7 현장 후속 기록](PHYSICAL_FIELD_EVIDENCE_2026-10-04.md#later-r7-on-host-follow-up-new-blockers-exposed)에서는 Direct Project Peer가 없는데 Host Ready가 남아 Guest의 baseline_unavailable을 유발했고, 기존 검증된 프로젝트를 열 때 짧은 경로를 우회하면서 DirectoryNotFoundException이 발생했습니다. 또한 개별 Project UUID 디렉터리를 Managed root로 잘못 선택하는 경우의 중첩 UUID 위험도 확인했습니다.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209)는 2026-10-08에 병합되어 Direct-Seed health 감시, 검증된 Existing-Active 실행 Alias, 잘못된 Project root 거부를 추가했습니다. 이 변경은 이제 **r8 ZIP에 포함**되고 Exact Release Windows 검증도 통과했습니다. 다만 원래 Seed가 사라진 물리적 원인을 확정한 것은 아니며, 위 현장 결함이 정확한 r8 배포판에서 해결되는지는 **아직 재현·검증하지 않았습니다.** Release readiness는 **FIELD BLOCKED**입니다.

### r7에 포함된 post-r5 안정화와 r6 Field fix

r7에는 r5보다 최신이던 제한된 Behavior와 Field에서 발견된 재시도 수정이 포함됩니다.

- 사용자의 명시적 동의와 Windows UAC 승인 뒤 Coordinator/Seed용 좁은 Inbound rule을 만들 수 있는 Windows LAN Firewall onboarding. Rule은 Private profile과 `LocalSubnet`에 제한되고 TeamForge-owned reconciliation/cleanup 동작을 포함합니다.
- 선호/default Seed port가 사용 중이거나 Bind 불가능한 경우의 Startup recovery. Windows bind-context `EACCES`도 포함하며 한 번 OS-assigned port로 fallback하고 실제 선택된 endpoint를 광고합니다.
- OS-owned named-pipe live lock과 오래된 Writer용 permanent compatibility fence를 사용하는 Project identity 생성 직렬화/Windows crash recovery. 최근 Node 22/24 Windows identity-recovery job은 통과했으며, #182는 영구 Node 22 비호환이 입증된 상태가 아니라 간헐 CI 감시 Issue로 남아 있습니다.
- Guest managed-root 재시도는 TeamForge가 만든 정확한 Windows v2 `project-identity.lock` compatibility fence만 관리 Metadata로 인정합니다. 변조/손상/Link/과대 크기/비호환 Fence는 계속 Fail-closed입니다.
- Coordinator rejection cleanup, HTTP cancellation/deadline hardening, Host diagnostics context 개선, WebSocket client-role log, Launcher Invite와 `TF1` code 표현 개선, 현재 `TeamForge · Locked by <owner>` SceneView feedback. #79는 Visual feedback만으로 모든 transient Gizmo motion이 제거되는 것은 아니므로 계속 Open입니다.

Linux/macOS Project identity stale-lock recovery는 Windows 전용 구현 범위 밖에 남아 있습니다.

## 기능 상태

| 영역 | 현재 Source 상태 | 현재 Evidence 경계 |
| --- | --- | --- |
| Connected-user Presence | ✅ 구현 / 검증 경험 있음 | 물리 두 PC baseline에서 동작; 더 넓은 외부 테스트는 여전히 유용 |
| Selection / Editor awareness | ✅ 구현 / 검증 경험 있음 | 더 넓은 외부 테스트는 여전히 유용 |
| Transform synchronization | 🟡 구현 / 안정화 중 | Exact r5 두 PC late-join/contention recovery PASS; r7 Exact-package automation PASS; 더 넓은 물리 Coverage와 #79 UX 후속 작업이 남음 |
| Basic Locking / Ownership | 🟡 구현 / 안정화 중 | Exact r5 contention/recovery PASS; r7에 Foreign-lock SceneView feedback 포함; transient Edit 방지/명확성은 #79가 계속 추적 |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 구현 / 안정화 중 | 지원 subset은 실제 두 PC에서 검증 경험 있음; 더 넓은 Field coverage는 유용 |
| Project bootstrap / Collaboration Invite | 🟡 구현 / 안정화 중 | Exact r5 Saved Guest reconnect PASS; r7가 Windows Project identity crash recovery와 Guest fence-retry fix를 포함하고 Exact-package automation PASS; 물리 Process-loss/conflict recovery는 Pending |
| Direct P2P Project transfer | 🟡 구현 / 안정화 중 | Exact r5 `5091` Stop/Start + 실제 Transfer PASS; r7가 Firewall onboarding/unavailable-port fallback과 r6 Field에서 발견한 Guest retry fix를 포함; 실제 두 PC LAN lifecycle Evidence는 Pending |
| Diagnostics / recovery UX | 🟡 구현 / 안정화 중 | r7에 이후 Diagnostics/recovery 개선과 Privacy-safe support-bundle path 포함; 더 넓은 Field usability 검증은 유용 |
| Windows path resilience / Execution Alias | 🟡 구현 / 안정화 중 | Exact r5 실제 Long/Deep-path handoff PASS; Exact r7 Windows path/junction automation PASS; 악성/무관 Alias 거부는 Fail-closed coverage 유지 |
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

게시된 r7 Artifact는 추가로 Exact Release Validation run `37118580632`을 통과했습니다. Release download/hash identity, Release-manifest file hash, 한글/공백 경로 Fresh extraction, Staged public/source validation, Bundled Runtime/Node, Launcher fail-closed Runtime behavior, Exact-candidate Windows path-resilience/real-junction 검사가 모두 PASS했습니다. 이는 해당 자동 검사에 대한 Package evidence이며, 남아 있는 두 PC LAN/UAC/Process-loss/Realtime Field scenario를 대체하지 않습니다.

## 기록된 물리 두 PC Evidence

### 2026-10-03/04 r6 → r7 Field pass

Windows 물리 PC 두 대에서 진행한 r6 pass에서는 인증 없는 LAN Host의 Fail-closed 차단, External local package 거부, Windows Firewall onboarding, Rule 설정 후 Host Ready까지 실제로 확인했습니다. 당시 Host Unity가 이미 관리자 권한으로 실행 중이어서 일반 권한 상태에서 새 UAC Prompt가 뜨는지는 아직 별도 확인이 필요합니다.

첫 Guest 연결은 `coordinator_timeout`을 기록했고, 이후 재시도에서는 TeamForge가 직접 만든 Windows v2 `project-identity.lock` compatibility fence를 Guest destination validator가 Unmanaged content로 오인해 `destination_contains_unmanaged_content`가 발생했습니다. PR #200은 Arbitrary lock file을 허용하지 않고 정확한 TeamForge v2 fence 형식만 인정하도록 수정했고, Exact r7 Guest는 실제 r6 Managed root를 그대로 재사용하면서 이 Self-blocking 오류를 다시 일으키지 않았습니다.

남아 있던 Coordinator timeout은 이번 Run에서 Windows network policy로 분리되었습니다. Host Coordinator는 `0.0.0.0:5080`에서 Listen 중이었고 TeamForge Inbound rule은 의도대로 Private-only였지만, 실제 Host Wi-Fi profile이 Public이었습니다. 신뢰하는 LAN을 Private으로 바꾼 뒤 Guest TCP 5080이 성공했고, 같은 r7 흐름이 Publisher trust → Project receive → Unity 실행 → 사용자가 보고한 TeamForge 접속까지 진행되었습니다. 자세한 Evidence 경계는 `PHYSICAL_FIELD_EVIDENCE_2026-10-04.md`를 사용합니다.

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
- Exact r5 physical evidence는 실행된 r5 bytes와 Scenario를 증명할 뿐, r6/r7 전용 Networking/Identity behavior를 증명하지 않습니다.
- Exact r7 Automated Release validation은 실행된 r7 Artifact/Hash/Manifest/Extraction/Runtime/Launcher/Path 검사를 증명합니다. Mixed r6 Host / Exact-r7 Guest Field pass는 여기에 수정된 Guest retry와 Host Windows network profile을 바로잡은 뒤의 실제 LAN bootstrap 한 경로를 추가로 증명하지만, Exact r7 양쪽 PC 검증, 일반 권한 Fresh UAC/Firewall onboarding, Preferred-port fallback, 실제 Process-loss recovery, SceneView UX timing까지 증명하지는 않습니다.
- Exact r8 Windows Release Validation #38019297086은 게시된 r8 ZIP과 Hash에 대해 PASS입니다. 실제 두 PC Host/Guest 복구, UAC/Firewall, 포트 Fallback, Project Identity 강제 종료 복구, SceneView 입력 UX까지 증명하지는 않습니다.
- Product version만으로는 Byte identity가 되지 않습니다. Exact package evidence에는 정확한 Artifact filename과 SHA-256이 필요합니다.
- Bug Issue가 Closed라고 해서 같은 Subsystem의 모든 이후 구현까지 Package/Field evidence를 얻는 것은 아닙니다.
- Historical phase/work-state/evidence note는 당시 Snapshot에는 유효하지만 현재 Readiness에서는 이 페이지를 대체하지 않습니다.

## 남은 Release-readiness gate

TeamForge를 일반 설치 가능한 Alpha로 올리기 전에는 **위 r8 Release의 정확한 ZIP/SHA-256**으로 새로운 Windows 실물 테스트를 진행해야 합니다. r7은 역사적 증거이며, r7을 다시 테스트해도 PR #209의 r8 수정을 검증한 것이 아닙니다.

1. r8 Tag·소스 커밋·ZIP 이름·SHA-256·Unity 버전·Host/Guest PC 역할을 기록합니다. r8 ZIP을 재압축하거나 기존 자산을 덮어쓰지 않습니다.
2. **두 Windows PC 모두 Exact r8**을 사용해 새 Host → 서명된 Invite → Guest 수신 → 검증된 Active Project → Unity 실행 → Realtime 연결을 확인합니다. Host Stop/Start 후 새 Guest 전송도 테스트합니다.
3. Host가 Ready일 때 Direct Seed가 사라지는 상황을 안전하게 재현해 오래된 Ready가 취소되는지, Guest에 사실에 맞는 복구 안내가 나오는지 확인합니다.
4. 긴/깊은 경로에 있는 기존 Verified Active Project를 재실행해 검증된 짧은 경로를 사용하고 예전 Unity PackageCache DirectoryNotFoundException이 없는지 확인합니다. 개별 Project UUID 폴더를 Managed root로 선택하면 중첩 폴더를 만들지 않고 거부해야 합니다.
5. 일반 권한 Windows Host에서 Fresh UAC/Firewall onboarding과 Private + LocalSubnet 규칙 범위를 확인합니다. Public profile을 자동 개방하면 안 됩니다.
6. 선호 Seed 포트를 점유해 대체 포트 선택과 실제 연결을 검증하고 Stop/Start 이후 다시 전송합니다. 비정상 Process loss 뒤 Project identity 복구도 확인하되 모호하거나 충돌하는 Identity는 Fail-closed여야 합니다.
7. 실제 두 Editor에서 Presence/Transform/Hierarchy/Lock feedback을 확인합니다. r8 ZIP에는 이후 병합된 PR #217의 경고 Repaint 개선은 들어 있지 않으며 #79 UX 후속은 계속 유효합니다.
8. 간헐 Windows Node 22 Identity 이슈 #182를 감시하고, r5/r6/r7 역사적 Evidence와 새 r8 결과를 혼동하지 않습니다.
9. Install/Update/Uninstall 문서와 외부 테스터 검토를 계속 보완합니다. Server 재시작은 현재 Disconnect/Fail-closed/New-session recovery이지 영구 Session Persistence가 아닙니다.

Packaged/Source 검증 성공만으로 위 현장 테스트를 PASS로 바꾸지 않습니다.

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
