# TeamForge 로드맵

[English](ROADMAP.md) | **한국어** | [현재 상태](STATUS.ko.md)

> **Build together. Stay in sync.**
>
> *Zero-config first, never zero-control.*

이 로드맵은 **방향을 설명하며 출시 날짜나 기능 구현을 보장하지 않습니다.** 현재 blocker, PR, CI run, Field validation 상태를 별도로 복사해 유지하지 않습니다. 현재 구현/검증/차단/패키지 상태는 **[STATUS.ko.md](STATUS.ko.md)** 를 확인하세요.

## 개발 우선순위

TeamForge는 대체로 다음 원칙 순서로 개발합니다.

1. **기능 범위보다 신뢰성 우선** — 더 많은 Unity 상태를 동기화하기 전에 기존 협업 경로가 예측 가능하게 복구되어야 합니다.
2. **명시적인 Authority와 Identity** — Peer가 Ownership, Object identity, Conflict 결과를 조용히 추측하지 않아야 합니다.
3. **안전하게 실패하고 복구 가능하게** — 상태가 어긋났을 때 조용한 Project 손상보다 보이는 진단과 복구 경로를 우선합니다.
4. **일반 경로는 단순하게, 고급 경로는 검토 가능하게** — Host/Guest 사용은 쉬워지되 Networking/Trust/Recovery 경계는 숨기지 않습니다.
5. **배포는 검증 뒤에** — Installer 완성도가 Exact-artifact Field evidence를 대신하지 않습니다.

## 지금 — 현재 Packaging/Evidence 경계를 마무리하고 좁은 Component 협업 시작

### 선택한 배포 후보의 검증과 남은 실기기 과제 완료

최신 공개 후보, 정확한 배포 파일의 식별 정보와 남은 출시 검증 과제는 [STATUS.ko.md](STATUS.ko.md)가 관리합니다. 소스 체크아웃에는 배포 파일보다 새로운 변경이 있을 수 있으며, 검증 결과는 실제 테스트한 배포 파일과 시나리오에만 해당합니다.

선택한 배포 파일을 일반 설치 가능한 알파 후보로 올리기 전에는 남은 실기기 과제를 검증하고, 이전의 정확한 두 PC 검증 결과는 원래 적용 범위 안에서 보존해야 합니다. 과거 검증이 없었던 것처럼 이미 끝난 시나리오를 기계적으로 반복하거나, 소스 CI를 새로운 패키지의 실기기 검증으로 취급하지 않습니다.

현재 검증 방향:

- 좁고 확인 가능한 Rule scope와 Cleanup behavior를 포함한 Fresh Windows LAN Firewall onboarding;
- Preferred Seed-port unavailable/collision fallback과 실제 Advertised endpoint reachability;
- Abnormal process loss 뒤 Windows Project identity recovery와 Conflict/Ambiguity의 Fail-closed 유지;
- Exact Packaged Artifact에서 Host Stop/Start 및 Fresh Guest Direct Project transfer;
- 새 Packaging/Integration 변경이 자기 Evidence를 갖도록 Fresh extraction Host → Guest → Realtime collaboration smoke path;
- 폭넓은 Reliability 주장을 하기 전 Project creator 외 사용자/Reviewer의 추가 Testing.

현재 정확한 Evidence와 남은 Release gate의 상세 내용은 이 Roadmap이 아니라 [STATUS.ko.md](STATUS.ko.md)가 소유합니다.

### WP6: 좁은 Component / Inspector 기반

다음 큰 Scene collaboration 확장은 기존 Authority/Identity/Recovery model을 우회하지 않고 확장해야 합니다.

첫 단계 방향:

- 같은 Type Component가 여러 개 있는 경우까지 포함하는 안정적인 Component identity 정의;
- 제한된 지원 범위에서 Component Add/Remove 동기화;
- 좁게 정의한 Inspector / `SerializedProperty` 형태 동기화;
- Revision, Ordering, Replay/Idempotency, Stale-state, Rejection 규칙;
- Local Inspector state가 stale하게 남지 않는 Undo/Rejection/Reconciliation;
- Reconnect 후 Authoritative Component/Property state 복구;
- 첫 구현부터 Deterministic Unity E2E 및 Conflict/Recovery test 추가.

첫 구현부터 모든 Unity Property를 무작정 직렬화하지 않습니다. Object reference, Managed reference, Array/List, Nested structure, Custom drawer, Prefab override, 임의 MonoBehaviour data는 지원 전에 명시적인 Identity와 Safety rule이 필요합니다.

## 다음 — 더 깊은 Scene 협업

좁은 Component/property contract가 검증된 뒤에는 다음을 검토합니다.

- 더 넓고 안전한 Component/property coverage;
- 더 명확한 Lock / Ownership / Conflict UX;
- 더 강한 Reconnect / Authoritative resynchronization;
- Multiple-Scene workflow;
- Explicit identity rule을 가진 Cross-Scene structural operation;
- 큰 Hierarchy와 잦은 Edit에 대한 Performance 작업;
- Local/Field에서 재사용 가능한 Disposable A/B/C Unity test 환경.

목표는 Unity 변경을 전부 무작정 보내는 것이 아닙니다. 각 Operation에는 Identity, Ordering, Validation, Authority, Conflict rule, Safe recovery path가 필요합니다.

## 이후 — Project, Prefab, Asset 협업

장기적으로 다음을 검토할 수 있습니다.

- Prefab structure / override collaboration;
- Asset create/delete/move/rename;
- Bootstrap 이후에도 유지되는 `.meta` / GUID mismatch protection;
- Material 및 다른 Serialized Asset 협업;
- Script / Project-file change awareness;
- 필요한 데이터만 보내는 Incremental transfer;
- 더 강한 Project identity / compatibility 검사;
- Peer 사이 Package/Project 차이의 안전한 처리.

Asset synchronization은 작은 Identity 오류도 Unity Project 전체 Reference를 조용히 손상시킬 수 있어 높은 위험 영역으로 취급합니다.

## 이후 — 더 쉬운 Onboarding과 유연한 Networking

장기적인 일반 경로는 다음에 가까워지는 것을 목표로 합니다.

**Start Collaboration → 누군가 초대 → 필요한 것을 자동 준비 → Join Collaboration**

방향:

- 더 단순한 Start / Join Collaboration UX;
- 더 나은 자동 Setup / Diagnostics;
- 쉬운 LAN / Direct-address workflow;
- 검증된 Install / Update / Uninstall 경험;
- 한 LAN 밖에서도 실용적인 Internet collaboration;
- 더 강한 Peer identity / Authorization;
- Advanced Manual / Self-hosted networking control.

### Connectivity 연구

다음은 아직 Research 방향입니다.

- Direct P2P가 불가능할 때 Relay / Coordinator-assisted connectivity;
- 실제 가치가 있을 때 WebRTC / ICE / STUN / TURN;
- Explicit Trust를 약화시키지 않는 Peer discovery;
- Security model이 조용히 바뀌지 않는 Observable transport fallback.

현재 지원 기능이 아닙니다. 현재 Networking 경계는 [STATUS.ko.md](STATUS.ko.md)와 [architecture.md](architecture.md)를 따릅니다.

## 이후 — Reliability, History, Recovery

장기 방향:

- 더 나은 Host disconnect / crash recovery;
- Durable Server/Session restart behavior;
- Persistent Authoritative snapshot 또는 동등한 Recoverable state;
- Operation / Recovery journal;
- 가능한 범위의 Replay / Rollback;
- Stale/Corrupted/Mismatched Project 감지 강화;
- Long-running Soak/Stress test;
- 더 큰 Multi-user conflict/load test.

Recovery는 Synchronization이 망가진 뒤에 추가하는 부가 기능이 아니라 First-class feature로 취급합니다.

## 이후 — Security / Trust hardening

보안은 한 번 끝나는 Milestone이 아니라 계속되는 작업입니다.

- 더 강한 Peer identity / Authorization;
- 체계적인 Untrusted network-input validation / Fuzzing;
- Path traversal / Arbitrary file write hardening;
- Archive / Project extraction / Activation review;
- Unsafe deserialization / Command / Code-execution path review;
- Secret/Token/Credential isolation;
- Resource exhaustion / DoS resistance;
- Malicious/Modified Unity Project/Package 처리;
- 더 강한 Unity-aware C# static analysis;
- 프로젝트 성숙 뒤 Independent security review.

자동 보안 스캔과 Green test는 Evidence이지 Professional security audit이 아닙니다.

## 연구 — 고급 협업 모델

다음은 가치와 Unity 적합성이 확인되기 전까지 Research입니다.

- Collaboration-aware shared Undo / Redo;
- Temporary offline editing 후 Safe reconciliation;
- 필요한 곳의 Operation-based synchronization / CRDT-like approach;
- Advanced conflict merge;
- Session을 끊지 않는 Host / Publisher / Seed migration;
- Larger-team scalability;
- 더 풍부한 Collaboration history / Change inspection.

일부는 Unity data model과 맞지 않거나 복잡도에 비해 가치가 낮을 수 있습니다.

## 연구 보강 — 새 기능 확대보다 기존 아이디어 강화 (2026-10-14)

**아이디어 보강안일 뿐이며 구현·프로토콜 도입·출시 약속·우선순위 변경이 아닙니다.** 위에서 다룬 WP6, 프로젝트 전송, 연결, 안전성 및 자동화 방향을 구체화합니다. 실제 구현/검증 상태는 [STATUS.ko.md](STATUS.ko.md)가 관리합니다.

| 기존 방향 | 강화 후보 | 구현 검토 전 반증·안전성 기준 |
| --- | --- | --- |
| Component / Inspector 협업 | 첫 Property 편집을 GameObject/Component/Property ID, Revision, Operation ID, Lock/Lease 권한으로 제한한 **작은 원자적 작업**으로 취급합니다. 거부 시 대상만 복구하고 Unity Undo/Redo와 Domain Reload를 별도 장애 시나리오로 다룹니다. | 두 Editor가 충돌하고 한쪽이 재연결한 뒤 이전 작업이 중복 도착해도 무관한 로컬 편집이나 Prefab override를 되돌리지 않아야 합니다. 처음에는 허용된 Property 한 종류만 비교합니다. |
| 세션 영속성·복구 | 현재 메모리 기반 Authority와 **세션 세대(Epoch) 차단 + 권위 있는 Snapshot + 크기 제한 Journal** 조합을 비교합니다. 이전 승인 상태의 복원과 작업의 재실행은 분리합니다. | 검증·전파·응답·저장 사이에서 Coordinator를 종료/재시작해도 이전 세대의 소유자나 작업이 새 세션을 변경해서는 안 됩니다. 응답이 없다고 성공을 추측하지 않습니다. |
| P2P 초기 전송 | **검증 가능한 증분 Manifest·Chunk 재사용**을 검토하되 Unity `.meta`/GUID, Root 경계, 서명·해시와 원자적 활성화를 보존합니다. | `.meta` 변경·Asset 이름 변경·캐시 청크 변조·활성화 중단 상황에서 정확한 프로젝트만 복원하거나 안전하게 거부해야 합니다. 무결성이 속도보다 우선입니다. |
| 인터넷 연결 대안 | 우선 LAN/WAN 직접 연결 실패 유형을 구분하고, 실제 도달성 한계가 확인될 때만 ICE/STUN/TURN, 주소 체계 전환 또는 별도 인증 Relay를 비교합니다. 연결 발견과 Peer 인증은 독립적입니다. | Symmetric NAT, UDP 차단, 주소 변경, Relay 불능을 비용 한도와 함께 시험합니다. STUN 성공이나 연결 후보 정보만으로 P2P 전송 성공 또는 신뢰할 수 있는 Peer라고 판단하지 않습니다. |
| 자동화·진단 | Host/Guest 환경 점검과 복구 가능한 오류에 대해 **제안 → 검증 → 안전한 경우만 실행 → 결과 확인/되돌리기**를 검토합니다. 방화벽·자격 증명·신뢰 변경은 사용자가 확인할 수 있도록 합니다. | 오래된 Ready 상태, 만료된 Invite, 틀린 Endpoint, 모호한 Project Root에서도 광범위한 방화벽 개방, 거부된 Identity 재사용, 사용자 변경사항 덮어쓰기를 허용하지 않습니다. |
| 오프라인 편집·CRDT/OT | 전체 CRDT를 도입하기 전에 **작업 종류별 충돌 해결**을 비교합니다. 단순 Property는 병합 가능해도 삭제·Reparent·Asset GUID·Prefab 충돌은 명시적 권한 또는 사용자 판단이 필요할 수 있습니다. | 오프라인 작업의 순서 뒤바뀜·중복·충돌을 재생해 일관된 충돌 보고와 원본 복구가 가능해야 합니다. Unity Object Reference를 지키지 못하는 병합은 제외합니다. |

**균형 원칙:** 이미 지원되는 Host/Guest 및 Scene 흐름을 먼저 강화하고, 신규 후보는 기존 복구 방식이나 Git/VCS 같은 더 단순한 대안과 비교합니다. 정확성, 이해 가능성, 장애 복구, 자원 비용, 반복 검증을 함께 판단합니다. **아이디어 기록은 개발 착수 지시가 아닙니다.**

## Product / Engineering 원칙

### Version control을 보완합니다

Git, Unity Version Control과 다른 VCS는 History, Review, Backup, Recovery에 계속 중요합니다. TeamForge는 Live collaboration을 개선하려는 것이지 이를 대체하려는 것이 아닙니다.

### Safety before magic

안전을 증명할 수 없는 상태에서 편리함을 이유로 Project state를 조용히 덮어쓰거나 만들어내지 않습니다.

### 보이게 실패하고 복구 가능하게

상태가 어긋나면 한쪽을 조용히 강제하기보다 명확한 Diagnostic과 Recovery path를 우선합니다.

### Distribution follows validation

정확한 Packaged workflow가 검증되지 않았다면 예쁜 Installer가 그것을 대신하지 않습니다.

### AI assistance는 허용하지만 Unverified output이 목표는 아닙니다

TeamForge는 AI 도움을 많이 받습니다. 변경은 AI 사용 여부가 아니라 Correctness, Safety, Testing, Maintainability, Usefulness로 판단합니다.

## Feedback이 Roadmap을 바꾸는 방식

이 Roadmap은 의도적으로 유연합니다. Testing에서 Onboarding이 Scene sync 확대보다 큰 문제로 드러나면 우선순위가 바뀔 수 있고, 어떤 Sync 기능이 Data-integrity risk를 과도하게 만든다면 범위를 줄이거나 재설계하거나 미룰 수 있습니다.

현재 구현/Readiness 상태는 이 Roadmap에서 추측하지 말고 **[STATUS.ko.md](STATUS.ko.md)** 와 관련 GitHub Issue를 사용하세요.
