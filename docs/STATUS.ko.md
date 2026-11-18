# TeamForge 현재 상태

[English](STATUS.md) | **한국어** | [简体中文](STATUS.zh-Hans.md)

_게시 후보 정보 갱신: 2026-11-08 (UTC). 최신 후보는 r10입니다. 과거 r9 및 2026-11-04 r10 사용자 보고 실기기 결과가 있지만, 양쪽 PC의 r10 ZIP 해시와 남은 복구·오류 Field 검증은 독립 확인되지 않았습니다. 전체 Readiness는 FIELD BLOCKED입니다._

> [!WARNING]
> **Early Public Preview — 중요한 Unity Project의 유일한 사본이나 유일한 복구 수단으로 TeamForge를 사용하지 마세요.**
>
> 기존 r5~r9 기록은 각 불변 배포 파일에만 유효합니다. r9는 Windows Exact Release 자동 검증과 2026-10-20 두 PC 기본 협업·재접속 사용자 보고가 있습니다. r10도 게시 ZIP의 자동 Exact Release 검증은 통과했고 별도 두 PC 사용자 보고가 있으나, 양쪽의 설치 ZIP 해시·실제 네트워크 단절·전체 복구/실기기 검증은 아직 확인되지 않아 **FIELD BLOCKED**입니다. 중요한 프로젝트는 백업하세요.

이 파일은 **현재 기능과 Release readiness 주장에 대한 기준 Human-readable source**입니다. 다른 문서는 현재 blocker나 validation 상태를 별도로 복제하지 말고 이 문서를 링크해야 합니다.

정확한 Product/Runtime/Protocol 선택은 [`../release-contract.json`](../release-contract.json), Packaged byte identity와 superseded build 규칙은 [`../builds/README.md`](../builds/README.md), 상세 Bug 논의와 과거 재현 기록은 연결된 GitHub Issue를 사용하세요.

> **2026-10-20 r9 현장 결과:** Host/Guest Test Lab, 양방향 Transform, 생성·이름변경·삭제, 기본 Lock, Guest 재접속 후 이름·위치 복원은 사용자 보고상 PASS입니다. 포트 충돌·비정상 종료 등 전체 Field 검증은 아직 필요합니다. [영문 세부 현황](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).

## 현재 상태 한눈에 보기

### M1 소스 통합: Collider 속성 공동 편집

기존 WP6 PR을 재사용해 **서명된 Scene admission → Server Authority → WebSocket
→ Unity Collider 관찰·적용** 경로를 연결했습니다. 명시적 소스 opt-in이며 r10 ZIP에
포함된 기능이 아닙니다. 저장된 non-Prefab Box/SphereCollider의 trigger·center·
size/radius를 지원 대상으로 삼고 최초 실제 signed Scene bytes를 검증한 후에는
dirty Scene에서 서버 runtime ledger·공통 revision/history·GameObject lock을 사용합니다.
Collider Collaboration 창에서 참가·상태·자신의 조건부 Undo/Redo와 로컬 복구 검토함의
명시적 재제출을 제공합니다. 서버 승인·Editor 적용 보고·디스크 저장은 별도 상태입니다.

| 단계 | 실제 상태 |
| --- | --- |
| 구현 | 소스 경로 구현, 최종 통합 리뷰/PR 체크 필요 |
| 자동 검증 | 실제 Node WebSocket 성공·거절·중복·late join·재접속 및 signed source 검증 통과; 최종 SHA별 결과는 PR/checkpoint 기록 |
| Unity 통합 검증 | **로컬 NOT RUN** — 이 Linux 환경에 Unity 실행기가 없습니다. CI에 실제 Unity 1개+Node peer E2E와 exact NUnit/evidence gate를 추가했으며 결과 대기는 PASS가 아닙니다 |
| 패키지·현장 검증 | **M1 NOT RUN** — 새 배포/승격 없음, 기존 r10 증거 보존 |

현재는 Session당 Scene 하나, 최대 128개 메모리 보존 Session, 512 Collider/1536 속성,
유한한 ±100/0–100 범위를 제한합니다. 미지원 속성은 로컬 전용이고 Component 추가·삭제,
Prefab 및 Collider 소유 오브젝트/조상 삭제는 M2가 필요해 활성 M1 경로에서 거절됩니다.
해당 Scene 편집자는 호환 capability 협상·참가가 필요합니다. 모든 peer의 연결 종료 후에도
메모리 ledger는 남지만 **서버 재시작 시에는 소실**되며 durable 복구는 M4입니다.
로컬 미확정 값 보존은 서버 영속성 검증이 아닙니다. 두 Unity Editor·3인 late join·
save/reopen·8 Editor/1시간 soak·Windows exact artifact는 별도 미검증 항목입니다.

실행 설정은 [server README](../server/README.md), 다음 사용자 목표 M2 Component
추가·삭제와 M3 실제 Primitive는 [승인 로드맵](ROADMAP.ko.md)을 따릅니다.

- Product line: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- 최신 Published Packaged Candidate: **v0.5.1-prealpha-wp5.1-r10**
- r10 Source/tag commit: **693d3a9d647f9a511012f1ebba3209834531656e**
- r10 Windows ZIP: **Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r10-win-x64.zip**
- r10 Artifact SHA-256: **01afb269bd6235470bd75d1dda6a6c0119d0e21acea87087fe1115d0cd002f89**
- Packaged target: **Windows x64**
- Release readiness: **FIELD BLOCKED**
- Unity line: **`6000.3`**, 기록된 Candidate test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### Source와 Packaged Candidate의 차이

[최신 r10 사전 배포판](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r10)은 **2026-11-03 (UTC)**, 소스 커밋 **693d3a9d647f9a511012f1ebba3209834531656e**을 기준으로 게시됐습니다. 위 SHA-256은 GitHub Release에 기록된 값이며, 게시된 r10 ZIP은 [r10 Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102)를 통과했습니다. [r9 검증 #39147057920](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/39147057920)은 과거 r9 기록입니다. 자동 패키지 검증은 양쪽 물리 PC에 설치된 ZIP의 동일성과 현장 검증을 보증하지 않습니다.

2026-10-20 사용자 보고 실기기 결과: Host와 Guest의 Test Lab 기본 연결 PASS, 양방향 Cube Transform PASS, 같은 Scene의 오브젝트 생성·이름변경·삭제 PASS, 기본 Lock 충돌 PASS, Guest Unity를 종료한 동안 Host가 바꾼 이름·위치가 재접속 후 일치함을 PASS로 확인했습니다. 상세 기록은 [#301](https://github.com/Eun-si123/teamforge-unity-collab/issues/301), [#302](https://github.com/Eun-si123/teamforge-unity-collab/issues/302), [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67)에 있습니다. 새 오브젝트의 MeshRenderer·MeshFilter·Collider 등 일반 Component 복제는 여전히 미지원이며 [#303](https://github.com/Eun-si123/teamforge-unity-collab/issues/303)에서 추적합니다.

[2026-11-04 r10 두 PC 현장 보고](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md)에 따르면 Host Ready·서명된 Publisher 신뢰·Guest 전송 및 활성화·Unity 6000.3.21f1 실시간 접속·기본 Presence/Transform/Lock/Hierarchy·Host 재시작 복구·이어받기·늦은 접속·잘못된 코드 거부·긴 경로에서의 접속이 사용자 보고상 PASS였습니다. 하지만 Host·Guest 각각의 설치 ZIP 해시와 전체 단계별 로그는 독립 확인되지 않아 양쪽 PC의 정확한 r10 파일 검증으로 간주하지 않습니다. 헤드리스 Guest의 원격 관리가 끊길 수 있어 실제 Wi-Fi/NIC 단절 검사는 **미실행**([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457))이었고, r10 Launcher 중복 실행 결함이 관찰됐습니다. 이후 병합된 [PR #456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456)의 수정은 r10 ZIP에 소급 포함되지 않습니다.

r5~r9 배포판 및 그 시기의 테스트 결과는 역사적 증거로 보존합니다. r9 이후 r10 소스에 반영된 WP6 Component 기초·검증 변경 일부는 r10의 Server 빌드 대상에 포함됩니다. 반면 r10 소스 커밋 이후 추가된 WP6 변경은 이미 게시된 불변 r10 ZIP에 포함되지 않습니다. 현재 `main`의 변경은 이미 게시된 ZIP을 **소급 변경하지 않으며** 소스·배포판·실기기 증거는 분리해서 취급합니다. Seed 대체 포트 충돌, 비정상 종료 복구 등 아직 실기기 검증이 필요한 부분 때문에 전체 릴리즈 상태는 FIELD BLOCKED입니다.

### r7-on-Host 후속 결함과 당시 r8 재검증 대상 (과거 기록)

[2026-10-04 r7 현장 후속 기록](PHYSICAL_FIELD_EVIDENCE_2026-10-04.md#later-r7-on-host-follow-up-new-blockers-exposed)에서는 Direct Project Peer가 없는데 Host Ready가 남아 Guest의 baseline_unavailable을 유발했고, 기존 검증된 프로젝트를 열 때 짧은 경로를 우회하면서 DirectoryNotFoundException이 발생했습니다. 또한 개별 Project UUID 디렉터리를 Managed root로 잘못 선택하는 경우의 중첩 UUID 위험도 확인했습니다.

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209)는 2026-10-08에 병합되어 Direct-Seed health 감시, 검증된 Existing-Active 실행 Alias, 잘못된 Project root 거부를 추가했습니다. 이 변경은 r10 소스 커밋보다 앞서 병합됐으며, r10 ZIP 자체도 Exact Release Windows 자동 검증을 통과했습니다. 그러나 자동 검증만으로 원래 Seed가 사라진 원인을 확정하거나 위 세 결함이 정확한 r10 배포판의 실기기 환경에서 각각 해결됐다고 판단할 수는 없습니다. 이러한 부정 조건의 개별 현장 재검증은 **아직 미완료**입니다. Release readiness는 **FIELD BLOCKED**입니다.

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
| Component / Inspector synchronization | 🟡 M1 소스 opt-in | 제한된 Collider 속성 경로 구현; Unity·패키지·현장 검증 대기. 일반 Component Add/Remove와 임의 `SerializedProperty` sync는 계획 단계 |
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
- Exact r8 Windows Release Validation #38019297086과 r10 Exact Release Validation #41630492102는 각각의 게시 ZIP에 대한 자동 패키지 검증 PASS입니다. 다만 양쪽 PC의 설치 해시, 실제 네트워크 단절, UAC/Firewall, 포트 Fallback, Project Identity 강제 종료 복구, SceneView 입력 UX까지 증명하지는 않습니다.
- Product version만으로는 Byte identity가 되지 않습니다. Exact package evidence에는 정확한 Artifact filename과 SHA-256이 필요합니다.
- Bug Issue가 Closed라고 해서 같은 Subsystem의 모든 이후 구현까지 Package/Field evidence를 얻는 것은 아닙니다.
- Historical phase/work-state/evidence note는 당시 Snapshot에는 유효하지만 현재 Readiness에서는 이 페이지를 대체하지 않습니다.

## 남은 Release-readiness gate

TeamForge를 일반 설치 가능한 Alpha로 올리기 전에는 **위 r10 Release의 정확한 ZIP/SHA-256**으로 새로운 Windows 실물 테스트를 진행해야 합니다. r7~r9는 역사적 증거이며, 이전 배포판 테스트만으로 r10을 검증한 것이 아닙니다.

1. r10 Tag·소스 커밋·ZIP 이름·SHA-256과 **Host·Guest 각각의 설치 ZIP 해시**, Unity 버전 및 PC 역할을 기록합니다. r10 ZIP을 재압축하거나 기존 자산을 덮어쓰지 않습니다.
2. **두 Windows PC 모두 Exact r10**을 사용해 새 Host → 서명된 Invite → Guest 수신 → 검증된 Active Project → Unity 실행 → Realtime 연결을 확인합니다. Host Stop/Start 후 새 Guest 전송도 테스트합니다.
3. Host가 Ready일 때 Direct Seed가 사라지는 상황을 안전하게 재현해 오래된 Ready가 취소되는지, Guest에 사실에 맞는 복구 안내가 나오는지 확인합니다.
4. 긴/깊은 경로에 있는 기존 Verified Active Project를 재실행해 검증된 짧은 경로를 사용하고 예전 Unity PackageCache DirectoryNotFoundException이 없는지 확인합니다. 개별 Project UUID 폴더를 Managed root로 선택하면 중첩 폴더를 만들지 않고 거부해야 합니다.
5. 일반 권한 Windows Host에서 Fresh UAC/Firewall onboarding과 Private + LocalSubnet 규칙 범위를 확인합니다. Public profile을 자동 개방하면 안 됩니다.
6. 선호 Seed 포트를 점유해 대체 포트 선택과 실제 연결을 검증하고 Stop/Start 이후 다시 전송합니다. 비정상 Process loss 뒤 Project identity 복구도 확인하되 모호하거나 충돌하는 Identity는 Fail-closed여야 합니다.
7. 실제 두 Editor에서 Presence/Transform/Hierarchy/Lock feedback을 확인합니다. r8 ZIP에는 이후 병합된 PR #217의 경고 Repaint 개선은 들어 있지 않으며 #79 UX 후속은 계속 유효합니다.
8. 간헐 Windows Node 22 Identity 이슈 #182를 감시하고, r5~r9 역사적 Evidence와 새 r10 관찰 결과를 혼동하지 않습니다. 원격 관리 연결을 끊지 않는 안전한 네트워크 장애 시험(#457) 전에는 Guest Wi-Fi/NIC 단절을 PASS로 취급하지 않습니다.
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
