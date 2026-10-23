# TeamForge 로드맵

[English](ROADMAP.md) | **한국어** | [현재 상태](STATUS.ko.md)

> **Build together. Stay in sync.**
>
> *Zero-config first, never zero-control.*

이 로드맵은 **방향을 설명하며 출시 날짜나 기능 구현을 보장하지 않습니다.** 현재 blocker, PR, CI run, Field validation 상태를 별도로 복사해 유지하지 않습니다. 현재 구현/검증/차단/패키지 상태는 **[STATUS.ko.md](STATUS.ko.md)** 를 확인하세요.

## 프로젝트의 핵심 목표와 열린 기술적 선택지

**변하지 않는 목표:** Unity Editor에서 프로젝트 복사와 전달의 부담을 줄이면서 여러 사람이 안전하고 이해하기 쉽게 협업하도록 돕는 것입니다. 신뢰, 프로젝트 무결성, 명확한 권한 관계와 복구 가능성을 지킵니다. 이는 **정해진 기능 목록이나 특정 아키텍처, 에이전트의 발상과 능력을 제한하는 규칙이 아닙니다.**

현재 작업에서 폭넓은 탐색이 허용되었다면 에이전트와 기여자는 기존 Phase의 경계를 재검토하고, 새로운 협업 기능과 프로토콜·알고리즘·구조를 발굴하고, 불필요한 복잡성을 대체하며, 이 로드맵에 없던 접근도 검토할 수 있습니다. Phase·기술 스택·네트워크 방식·UI 패턴·기존 아이디어 목록은 영구적인 한계가 아니라 재평가할 수 있는 가설입니다. 익숙하지 않은 제안이라는 이유만으로 배제하지 않되, 새롭다는 이유만으로 도입하지도 않습니다.

실제 사용자 문제와 검증 가능한 근거를 중심으로 판단하고, 가능하면 작고 되돌릴 수 있는 실험과 테스트, 더 단순한 대안 또는 변경하지 않는 대안을 비교합니다. 보안·권한·식별·무결성·정직한 검증은 유지합니다. 제품의 근본적인 목적 자체를 바꾸는 제안은 임의로 시행하지 않고 사용자에게 선택을 요청합니다. 이 문단은 기존 **선택적 추가 탐색 정책**이나 릴리스·비용·파괴적 작업 승인 요건을 변경하지 않습니다.

## 개발 우선순위

TeamForge는 대체로 다음 원칙 순서로 개발합니다.

1. **기능 범위보다 신뢰성 우선** — 더 많은 Unity 상태를 동기화하기 전에 기존 협업 경로가 예측 가능하게 복구되어야 합니다.
2. **명시적인 Authority와 Identity** — Peer가 Ownership, Object identity, Conflict 결과를 조용히 추측하지 않아야 합니다.
3. **안전하게 실패하고 복구 가능하게** — 상태가 어긋났을 때 조용한 Project 손상보다 보이는 진단과 복구 경로를 우선합니다.
4. **일반 경로는 단순하게, 고급 경로는 검토 가능하게** — Host/Guest 사용은 쉬워지되 Networking/Trust/Recovery 경계는 숨기지 않습니다.
5. **배포는 검증 뒤에** — Installer 완성도가 Exact-artifact Field evidence를 대신하지 않습니다.

## 균형 잡힌 사용자 경험 — 다양한 환경의 설계 원칙 (2026-10-14)

**구현 기능이나 출시 우선순위 변경이 아닌 설계 원칙입니다.** TeamForge는 지원 환경에서 유용하고 예측 가능하게 동작하도록 **성능/지연, 안정성/복구, 보안/프로젝트 무결성, 네트워크/OS 호환성, 편의성/고급 사용자 제어, CPU/RAM/통신량/호스팅 비용**을 함께 고려합니다. WebSocket, HTTP/2·3, QUIC, P2P, Relay나 특정 속도 지표가 목적 자체는 아닙니다. **균형은 모든 항목에 항상 동일 가중치를 준다는 뜻이 아닙니다.** 인증·권한·Identity·무결성·명시적 동의·기존 프로젝트 보호는 속도와 맞바꿀 수 없는 필수 조건입니다.

| 판단 단계 | TeamForge에서 적용하는 기준과 예시 |
| --- | --- |
| **실제 지원 능력 확인** | Host/Guest OS, 방화벽/LAN/VPN/NAT, Project Seed의 도달성, Coordinator 인증, 양쪽 프로토콜 협상 가능 여부를 먼저 확인합니다. 주소 발견·포트 매핑·기능 광고는 신뢰나 실제 도달성의 증명이 아닙니다. |
| **잘 작동하는 단순한 경로 유지** | 기존 Server-authoritative WebSocket 실시간 협업과 별도의 검증된 Direct HTTP 프로젝트 전송을 기준선으로 유지합니다. 대안은 측정된 장점, Capabilities 및 하위 호환성이 확인된 경우에만 검토하며 새롭다는 이유로 전환하지 않습니다. |
| **관련된 품질을 동시에 비교** | 편집 반영 p95/p99, Host/Guest 참가 시간, 검증된 프로젝트 전송 시간·바이트, 자원 비용, 오류율, 호환성과 사용자 조작 부담을 함께 평가합니다. 속도가 빨라도 잘못된 편집 적용·보안 노출·메모리·패키징 문제가 늘면 개선으로 단정하지 않습니다. |
| **가능한 기능은 유지하며 안전하게 축소** | 원격 연결이 끊겨도 Unity 자체 로컬 편집은 기존 방식대로 가능할 수 있습니다. 그러나 **TeamForge의 오프라인 변경 자동 동기화가 구현됐다는 의미는 아닙니다.** 검증된 Active 프로젝트를 보호하고 연결/충돌 상태를 알리며, 지원되는 범위에서만 인증된 Revision/Snapshot 기반 복구를 사용합니다. |
| **실패·복구를 증거로 검증** | Transport ACK는 편집 수락의 증명이 아니며 수신 Chunk도 활성화된 Project가 아닙니다. 연결 복구·Host/Seed 손실·중복 및 늦은 편집·해시/Identity 불일치·NAT/UDP 제한·취소·다중 Peer를 **정확한 테스트 배포 파일 기준**으로 비교합니다. 가능한 경우 수동/기존 안전 경로를 남깁니다. |
| **이유가 보이는 사용성** | 일반 Host/Guest 시작 절차는 간단하게 만들되, 지원되는 고급 네트워크·복구 설정에는 실제 적용 상태, 변경 이유, 제약과 복귀 방법을 보여줍니다. 미구현 자동화나 동작하지 않는 설정은 제공하지 않습니다. |

**새 프로토콜·기능의 채택 판단:** 실제 사용자 문제가 재현되는가? OS/네트워크/상대 Peer와 보안 조건이 충족되는가? 현재 WebSocket/HTTP, 권위 있는 Snapshot, 서명 Manifest만 보강하는 간단한 대안은 없는가? 인증·Revision·Lock·GUID·해시·원자적 활성화가 유지되는가? 실패 시 되돌릴 수 있는가? 같은 작업·권한 조건에서 정상 환경과 제한/복구 환경을 각각 비교하고, 좋지 않은 결과도 남깁니다.

기존 [개발 우선순위](#개발-우선순위)를 약화시키지 않으면서 **모든 중요한 품질을 함께 검토**하기 위한 기준입니다. 실제 구조는 [architecture.md](architecture.md), 현재 기능과 실기기 검증 상태는 [STATUS.ko.md](STATUS.ko.md), 정확한 패키지·프로토콜 선택은 `release-contract.json`이 관리합니다. 완료된 Phase를 다시 열거나 NAT 자동 연결, WebSocket over HTTP/2·3, WP6 Component 동기화, 전체 오프라인 협업, 영구 Session 복구가 구현된 것으로 취급하지 않습니다.

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
- Reconnect 후 Authoritative Component/Property state 복구 (현재 구조·속성 변경의 재시도·연결·락 검사는 네트워크와 분리된 기반 실험이며, 실제 변경 승인·적용·복구를 수행하지 않습니다);
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

이미 구현된 검증 청크 재사용, 연결 시도별 상태 분리, Seed 시작 실패 정리,
검증부터 활성화 확정 직전까지의 취소 처리, 정확한 승인 메타데이터 기반 복구,
공유 캐시 보존과 수신 작업별 제어를 기반으로 확장합니다. 이 기반은 현재
Host/Guest 흐름의 복구를 개선하며, 영구 Session 이력과 오프라인 변경의
재조정은 별도의 향후 기능으로 남습니다.

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

## 연구 발굴 — 추가 프로토콜·동기화 대안 (2026-10-14)

**후보 기술 조사 목록이며 구현·배포·의존성 도입·WP6/실기기 검증 우선순위 변경이 아닙니다.** 기존 로드맵의 ICE/STUN/TURN, CRDT, 증분 전송 같은 포괄적인 방향을 구체적인 기술 선택지로 확장했습니다. 현재 실제 지원 상태는 [STATUS.ko.md](STATUS.ko.md)를 따릅니다.

| 새로 검토한 기술 | 기존 아이디어와 다른 점 | 단점·안전 조건·최소 비교 실험 | 재검토 |
| --- | --- | --- | --- |
| **libp2p Circuit Relay v2 + DCUtR** ([프로토콜](https://github.com/libp2p/specs/blob/master/relay/DCUtR.md), [JS 구현](https://libp2p.github.io/js-libp2p/modules/_libp2p_dcutr.html)) | Relay를 통해 먼저 연결한 뒤 양쪽 NAT Hole Punching을 동기화하고 Direct로 전환하는 방식. ICE/WebRTC 전체 스택을 도입하지 않고도 비교할 수 있는 구체적 P2P 대안. | 최초 Relay의 가용성·신뢰성·운영비가 필요하고 NAT 종류에 따라 실패할 수 있음. 현재 직접 연결, DCUtR, ICE 대안을 Symmetric NAT/UDP 차단 환경에서 독립 비교. **발견된 IP만으로 Peer 신원 인증 금지.** | **B** 실제 연결 실패 시 |
| **WebRTC DataChannel / SCTP Partial Reliability** ([RFC 8831](https://www.rfc-editor.org/rfc/rfc8831.html)) | 권한이 필요한 편집은 Reliable/Ordered로, Presence·Selection·Camera 등의 수명이 짧은 업데이트는 Unordered/제한된 재전송으로 나누는 후보. | SCTP/DTLS/ICE 도입·배포 비용이 증가함. Lock·권한·프로젝트 데이터와 확정 편집에는 Unreliable 금지. 현재 WebSocket과 지연/손실/큰 메시지 상황을 비교하고 인증·Operation ID를 유지. | **B/C** 실제 Head-of-Line 문제 시 |
| **FastCDC + VCDIFF/rsync** ([FastCDC](https://www.usenix.org/conference/atc16/technical-sessions/presentation/xia), [RFC 3284](https://www.rfc-editor.org/rfc/rfc3284), [rsync](https://rsync.samba.org/tech_report/)) | 기존 증분 프로젝트 전송의 구체적인 후보. 파일 앞부분에 데이터가 삽입되어도 변경되지 않은 영역을 재사용하거나 비슷한 Asset 버전의 차이만 전송할 수 있음. | `.meta`/GUID, 서명된 프로젝트 버전, 원본 Base 해시, 디코딩 자원 상한, 최종 해시, 원자적 활성화 필수. 실제 Unity Asset로 전체 복사/고정 Chunk/CDC/Delta 비교; Active 프로젝트 제자리 패치 금지. | **B** 전송량 문제 시 |
| **Rateless IBLT / 집합 차이 조정** ([SIGCOMM 2024](https://dspace.mit.edu/entities/publication/a6315819-c34a-4a2c-8218-e811d665dff3)) | 큰 Asset/Chunk 목록 전체를 교환하기 전에 누락된 ID 집합만 간결하게 알아내는 후보. 여러 Seed 또는 오프라인 재동기화에 활용 가능. | Sketch만으로 데이터 무결성·권한을 증명할 수 없음. 서명 Manifest·인증·메모리 상한·실패 시 단순 목록 전환 필수. Full list/Merkle/IBLT를 실제 차이 크기별로 비교. | **C** 대규모에서 |
| **SPAKE2+ PAKE 초대 인증** ([RFC 9383](https://www.rfc-editor.org/rfc/rfc9383.html)) | 사람이 입력하기 쉬운 짧은 Join Code로 안전하게 **페어링**할 수 있을지 검토. 기존 재사용 가능 서버 토큰과 다른 모델이며, 기존 서명 Invite를 곧바로 대체하는 것이 아님. | 짧은 Code는 온라인 추측 방지·시도 제한·만료·Peer/Server Identity Binding·멤버십 권한이 반드시 필요. SPAKE2+의 사전 등록 모델이 일회성 초대에 적합한지도 확인. 기존 고엔트로피 서명 Capability와 비교하고 자체 암호 설계 금지. | **B/C** 초대 UX/보안 과제 시 |
| **Messaging Layer Security (MLS)** ([RFC 9420](https://www.rfc-editor.org/rfc/rfc9420.html)) | Coordinator/Relay가 협업 내용을 알 필요가 없을 때 그룹 구성원 변동에 따른 End-to-End 암호화와 Key Epoch 관리를 검토하는 정식 프로토콜 후보. | MLS는 Scene Revision·Lock·Project 서명·사용자 Identity를 대신하지 않음. 상태 복원·오프라인 재합류 복잡함. 지금처럼 소규모 팀에서는 기존 인증 세션과 비교하고 명확한 위협 모델이 생길 때만 검토. | **C** 장기 보안 모델 |
| **Merkle Anti-entropy / Causal Diff 힌트** (기존 자료구조·동기화 기법, 별도 표준 아님) | 재연결한 Editor가 서버의 권위 있는 Snapshot/Revision과 어디가 다른지 확인하고 필요한 영역만 받는 방법. 오프라인 변경의 인과관계는 충돌 진단에 활용. | Tree Hash는 불일치를 알려줄 뿐 누가 맞는지 결정하지 않음. Epoch·Authority·GUID·충돌 거부/복구 규칙 유지. Full Resync와 제한된 Tree Diff+Journal을 비교; Hierarchy 자동 병합은 별도 검증. | **B/C** 재연결 비용 문제 시 |

**프로젝트 간 재사용 연구:** FastCDC/VCDIFF/IBLT 같은 알고리즘은 BetterNet 검증된 파일과 TeamForge 서명 Manifest에서 **각각 별도로 성능 비교**할 수 있습니다. 사용자 데이터·인증·네트워크 서비스·프로토콜을 합친다는 의미는 아닙니다.

**B/C는 구현 순서가 아니라 조사 재개 조건**입니다. B는 현재 측정된 문제를 해결할 때 작게 비교, C는 비용/보안 의존성이 큰 장기 연구입니다. 지금의 정확한 배포 패키지 검증과 좁은 WP6 Authority/Recovery가 우선입니다. 나중에 구현을 결정할 때는 최신 표준 상태 및 실패한 비교 결과도 함께 확인합니다.

## 연구 — 이전 TeamForge Phase에서 놓쳤을 수 있는 대안 (2026-10-14)

**아이디어 조사 전용입니다.** Phase 1 Presence, Phase 2 편집/Lock, Phase 3 Project Bootstrap/P2P와 WP5/WP6 복구의 선택지를 과거 단계까지 살펴봅니다. 과거 배포파일·프로토콜 버전·검증 결과를 변경하거나 새 라이브러리 도입을 확정하지 않습니다. 현재 지원 기능의 기준은 [STATUS.ko.md](STATUS.ko.md)입니다.

| 과거 Phase / 기회 | 구체적 대안 | 기대 효과와 도입하지 않아야 하는 이유 |
| --- | --- | --- |
| **Phase 1: Host/Guest 주소 입력** | [mDNS (RFC 6762)](https://www.rfc-editor.org/rfc/rfc6762.html) + [DNS-SD (RFC 6763)](https://www.rfc-editor.org/rfc/rfc6763.html) | 같은 LAN에서 Host의 서비스 주소를 자동 *발견*하는 후보. 수동 입력과 Windows 사설/공용망·Guest Wi-Fi·VLAN·VPN 환경을 비교. **발견은 신원 인증·초대 권한의 증명이 아님.** Host 지문/Invite 확인·수동 대안·민감한 광고 데이터 금지가 필요하며 인터넷 자동 발견 기술은 아님. |
| **Phase 3: Direct Seed 포트·NAT** | [PCP 포트 제어 (RFC 6887)](https://www.rfc-editor.org/rfc/rfc6887.html), 수동 개방 및 향후 ICE/DCUtR와 비교 | Relay 운영 비용을 부담하기 전, 지원 공유기에서 임시 매핑을 요청하는 방법. 모든 공유기/CGNAT에서 작동하지 않고 Peer 신원을 알려주지도 않음. **명시적 동의·범위·만료/갱신·원상복구·외부 도달성 확인 없이 자동 포트 개방 금지.** |
| **Phase 3: 한 Project를 여러 Guest에게 배포** | [NORM Reliable Multicast (RFC 5740)](https://www.rfc-editor.org/rfc/rfc5740.html) 대 기존 유니캐스트/청크 재사용 | LAN 멀티캐스트가 되는 환경에서 같은 서명 Project의 반복 전송량을 줄일 수 있는지 비교. Wi-Fi 멀티캐스트는 느리거나 차단될 수 있고 프로토콜 비용이 큼. 수신자 1/2/4/8명에 대해 Host 전송량·완료 시간·각 Guest 해시 무결성·패킷 손실 복구/전력 비교. 인증과 서명은 별개로 유지. |
| **Phase 2: 편집 제어 메시지와 대량 전송** | [HTTP Priority (RFC 9218)](https://www.rfc-editor.org/rfc/rfc9218.html) 및 제한된 앱 큐 | 향후 협조 가능한 HTTP/2·HTTP/3 서버에서 Control/Bulk 요청의 우선순위를 표시할 수 있음. **개별 WebSocket 프레임을 이 표준으로 우선순위화할 수는 없음.** 현재 WebSocket+HTTP 분리 및 큐 제한과 먼저 비교하고 서버가 신호를 무시할 가능성을 고려. |
| **Phase 3: TCP 전송의 마지막 구간 지연** | [RACK-TLP (RFC 8985)](https://www.rfc-editor.org/rfc/rfc8985.html) | 새 P2P 프로토콜을 추가하기 전에 OS TCP의 Tail Loss 복구가 이미 효율적으로 동작하는지 관찰. 마지막 Chunk 지연·재전송·연결 끊김을 비교. 앱 와이어 프로토콜이 아니며 Windows/Linux 커널 설정을 무작정 수정하라는 의미가 아님. |
| **WP5: 주소 변경·연결 전환** | [QUIC 연결 마이그레이션 (RFC 9000 §9)](https://www.rfc-editor.org/rfc/rfc9000.html#section-9) 및 [TAPS API (RFC 9622)](https://www.rfc-editor.org/rfc/rfc9622.html) | *향후* 협조 가능한 전송 계층을 검토할 때 연결 유지와 기존 재인증·재접속·Snapshot 복구 중 무엇이 나은지 비교. TAPS의 Require/Prohibit 모델은 필수 보안 조건을 명확히 하는 참고가 될 수 있음. 현재 WebSocket/Direct HTTP에 자동 적용되지 않으며 OS/VPN과 Peer 인증을 우회해서는 안 됨. |
| **WP5/6: 원인 파악이 어려운 오류** | [qlog (2026-07 IETF 초안)](https://datatracker.ietf.org/doc/draft-ietf-quic-qlog-main-schema/) 및 현재 흐름의 구조화된 Trace | Host/Guest/Seed의 Session Generation·Request/Operation ID·Revision·Lock·거부 이유·재연결을 연결해 원인 추적. qlog는 **QUIC/H3를 실제로 사용할 때만** 검토; Scene 내용·Access Code·Token은 로그 금지, 보존량 제한과 비식별화 검증 필수. |
| **WP6: 편집 재전송/중복과 지연 최적화** | [HTTP 0-RTT 재생 위험 (RFC 8470)](https://www.rfc-editor.org/rfc/rfc8470.html) 및 **Operation 멱등성·상태 모델 검증** (TLA+/PlusCal은 표준 전송 프로토콜이 아닌 검증 도구) | Epoch가 바뀌거나 Lock이 만료됐을 때 늦은 편집, 재시도, 대상별 Undo가 결합해도 Authority가 무너지지 않아야 함. 상태 머신에서 재현하고 속도만 위해 변경 작업을 재생 가능한 0-RTT로 기본 전송하지 않음. Transport ACK와 Unity 편집 확정은 구분. |

### Phase 간 활용과 중단 조건

- **기존 기술부터 비교:** 현재 Windows TCP 동작, WebSocket·Direct HTTP, 서명 Manifest, 대상별 복구, Session Authority, 실기기 검증 관문.
- **저비용 후보:** LAN 발견과 사용자 확인을 통한 Join, 요청 큐 관리, 원인 추적 Trace 및 소규모 다중 Guest 전송 비교.
- **고비용 후보:** 명시적으로 허용한 PCP, NORM, QUIC 마이그레이션, ICE/DCUtR/WebRTC, 더 복잡한 상태 복제. 실제 장애·간단한 대안·안전한 복귀·성능상 이득이 확인될 때만 검토.
- **반드시 구분:** 주소 발견 ≠ 인증, 포트 매핑 ≠ 인터넷 도달성, 전송 ACK ≠ 확정된 Unity 변경, Delta/Multicast 수신 ≠ 신뢰할 수 있는 프로젝트 활성화.
- **현 상태 유지:** WP6 Component 사전 검증은 Live Inspector 동기화가 아니고, r8 패키지의 두 PC 검증 상태도 변경하지 않습니다. 연구 후보는 개발 착수 지시가 아닙니다.

## 연구 — 추가 전송·오프라인 메타데이터 대안 (2026-10-14)

**아이디어 비교 전용. 코드·프로토콜 버전·의존성·배포 또는 현재 검증 상태는 변경하지 않습니다.** 앞선 문서에서 다룬 ICE/DCUtR, QUIC 마이그레이션, NORM, FastCDC/VCDIFF/IBLT, MLS, PAKE와 중복하지 않고 **WebSocket 연결 방식, 인증된 청크 요청, 압축된 상태 데이터, 만료 가능한 비동기 메시지**를 살펴봅니다. Scene 편집 권한·ID와 서명 Project 무결성은 항상 우선하며, 실제 상태는 [STATUS.ko.md](STATUS.ko.md)를 따릅니다.

| 후보 / 공식 출처 | 적용 가능한 부분 | 제약 및 작은 비교 실험 |
| --- | --- | --- |
| **HTTP/2·HTTP/3 위 WebSocket (RFC 8441/9220)** — [H2](https://www.rfc-editor.org/rfc/rfc8441.html), [H3](https://www.rfc-editor.org/rfc/rfc9220.html) | WP5 인터넷 연결/프록시 호환성. 현재 WebSocket 애플리케이션 메시지를 유지한 채 Extended CONNECT 경로가 가능한지 검토. | 클라이언트·프록시·Node 런타임·TLS가 모두 지원해야 함. 현재 H1 WebSocket과 연결 실패·복구·메시지 순서·부하 비교 후, 이득이 없으면 변경하지 않고 H1 유지. WebTransport가 자동 지원되는 것은 아님. |
| **IPFS Bitswap 1.2 Have/DontHave/Wantlist** — [프로토콜](https://specs.ipfs.tech/bitswap-protocol/) | Phase 3에서 여러 **인증된 Seed/Guest**가 검증된 Project 청크를 공유하는 전략. 기존 직접 전송 및 Merkle/IBLT의 *보유 목록 비교*와 별도 평가. | 청크를 갖고 있다고 배포 권한이 생기지 않음. 공개 DHT·프로젝트 CID 광고·비인가 Wantlist 금지. 2~4명으로 중복 전송량·누락 청크·잘못된 블록·Seed 이탈 비교. 최종 Manifest 서명, .meta/GUID와 안전한 활성화 유지. |
| **Zstandard 사전 압축 + HTTP Compression Dictionary Transport** — [RFC 8878](https://www.rfc-editor.org/rfc/rfc8878.html), [RFC 9842](https://www.rfc-editor.org/rfc/rfc9842.html), [RFC 9659](https://www.rfc-editor.org/rfc/rfc9659.html) | Phase 3/5에서 반복되는 비밀이 없는 Project Manifest·상태 HTTP 응답, 향후 소유자가 통제하는 메타데이터의 전송량을 줄일 수 있음. | RFC 9842는 클라이언트 지원이 균일하지 않음. HTTP zstd Window는 RFC 9659의 8 MiB 상한 적용. 사전 ID·원본 해시·압축 해제 메모리 한도 유지, Secret과 공격자 입력을 함께 압축 금지. Plain/gzip/zstd/dictionary 실험; 이미 압축된 Asset은 효과가 작을 수 있음. |
| **CBOR (RFC 8949)** — [RFC](https://www.rfc-editor.org/rfc/rfc8949.html) | WP6의 미래 좁은 허용 목록 기반 Property Operation을 기존 JSON 메시지와 비교할 바이너리 표현 후보. | 자체로 권한 확인·Unity 참조 무결성을 보장하지 않음. 형식 버전·알 수 없는 필드·Canonical 인코딩·Fuzzing 필요. 압축 JSON과 크기·CPU·호환성 비교 후 결정; 현재 v1 메시지는 변경하지 않음. |
| **MQTT 5 Session Expiry / Message Expiry** — [OASIS 표준](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html) | 장기적으로 *권위 있는 편집이 아닌* 협업 알림, 초대 만료, 오프라인 중 받은 선택적 이벤트를 관리하는 후보. | 별도 인증 Broker·ACL·저장 한도가 필요. MQTT QoS는 Unity 편집의 Exactly-once 확정이 아님. 오래된 이벤트가 새 Session에 적용되지 않도록 하고, 현재 Snapshot/재연결 방식과 독립 비교. |

**판단 기준:** 지금 문제의 원인이 인증·Revision·Project GUID·Host 상태 또는 정확한 배포 패키지의 복구 실패라면 프로토콜 교체로 해결되지 않을 수 있습니다. 언제나 기존 방식을 기준선으로 측정하고, 장점이 확인되지 않으면 추가하지 않습니다. 여기 기록한 기술은 개발 착수 지시가 아닙니다.

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
