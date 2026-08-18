# TeamForge 로드맵

[English](ROADMAP.md) | **한국어** | [현재 상태](STATUS.ko.md)

> **Build together. Stay in sync.**
>
> *Zero-config first, never zero-control.*

이 로드맵은 TeamForge가 **어디로 발전하려고 하는지 보여주는 방향표**이며, 특정 기능의 출시 날짜나 구현을 보장하는 약속이 아닙니다. 테스트 결과, 기술적 제약, 보안 문제, 커뮤니티 피드백에 따라 우선순위와 설계는 달라질 수 있습니다.

지금 정확히 무엇이 구현되어 있고 무엇이 아직 막혀 있는지는 **[STATUS.ko.md](STATUS.ko.md)** 를 확인해 주세요. 이 로드맵은 현재 릴리스 준비 상태와 장기 개발 방향을 의도적으로 구분합니다.

## 상태 표시

- ✅ **프로토타입 존재** — 개발 테스트에서 실제로 동작한 구현이 있지만 아직 실험적일 수 있음
- 🟡 **부분 구현 / 안정화 중** — 일부 구현되었거나 안정성 / 현장 검증이 더 필요한 상태
- ⏳ **계획** — 방향에는 포함되어 있지만 아직 완성되지 않은 기능
- 🔬 **연구 / 장기 아이디어** — 구조와 실현 가능성이 아직 확정되지 않은 기능

## 0. 현재 기반 — 확장보다 먼저 안정화

현재 가장 중요한 목표는 기능을 무작정 늘리는 것이 아니라 이미 존재하는 기반을 더 안전하고 검증하기 쉽게 만들고, 다른 사람도 현재 상태를 정확히 이해할 수 있도록 하는 것입니다.

- ✅ 접속자 Presence
- ✅ Selection / Editor awareness 실험
- ✅ 위치, 회전, 크기 실시간 Transform 동기화
- 🟡 기본 오브젝트 Lock / Ownership 및 충돌 보호
- 🟡 같은 Scene의 Hierarchy 생성 / 삭제 / 이름 변경 / Reparent / Sibling order 동기화
- 🟡 Project bootstrap 및 Signed/validated Collaboration Invite 흐름
- 🟡 Direct P2P 프로젝트 전송
- 🟡 Chunk 전송, 무결성 검사, 중단 후 Resume/Retry, Staging, Activation, Recovery 실험
- 🟡 진단 및 복구 UX
- 🟡 Reconnect, mismatch, baseline, 동기화 실패 처리
- ✅ 공개 소스와 Source review 구조
- ✅ Server / Project Peer / Launcher runtime-loader / .NET Windows Launcher용 공개 CI
- ⏳ 안정적인 Unity EditMode 공개 CI gate
- ⏳ 의도한 end-to-end 흐름의 정확한 두 PC Windows 현장 검증 완료
- ⏳ 검증된 일반 사용자용 Packaged Alpha 배포
- ⏳ 프로젝트 제작자 이외의 외부 테스트 확대

**현재 개발 원칙:** 많은 종류의 오브젝트를 급하게 동기화하기 전에 신뢰성, 복구 가능성, 이해하기 쉬운 UX를 우선합니다.

## 1. 더 깊은 Scene 협업

TeamForge는 이미 Transform-only 실험 단계를 넘어 일부 same-Scene Hierarchy 동기화가 존재합니다. 다음 목표는 이 경로를 더 안정화하고 지원 범위를 신중하게 넓히는 것입니다.

- 🟡 Same-Scene GameObject 생성 / 삭제 동기화
- 🟡 Same-Scene GameObject 이름 변경 동기화
- 🟡 Same-Scene Reparent / Sibling order 동기화
- 🟡 Hierarchy operation과 Transform / Lock 사이의 충돌 처리
- ⏳ Component 추가 / 제거 동기화
- ⏳ Inspector / `SerializedProperty` 동기화
- ⏳ 더 명확한 Lock / Ownership / Conflict UX
- ⏳ 더 강한 Reconnect 및 authoritative resynchronization
- ⏳ Multiple Scene workflow
- ⏳ Cross-Scene 구조 작업
- ⏳ 큰 Hierarchy와 잦은 수정에서의 성능 개선

목표는 Unity에서 발생하는 모든 변경을 무조건 네트워크로 복사하는 것이 아닙니다. 각 변경에는 올바른 객체 식별, 순서, 검증, 충돌 규칙, 그리고 두 Editor의 상태가 어긋났을 때 안전한 복구 방법이 필요합니다.

## 2. Project / Prefab / Asset 협업

Scene만 동기화된다고 해서 두 Unity 프로젝트가 완전히 같은 상태가 되는 것은 아닙니다. 장기적으로는 Unity GUID와 참조 무결성을 보호하면서 Project / Asset 협업 범위를 넓히고 싶습니다.

- ⏳ Prefab 구조 / Override 협업
- ⏳ Asset 생성 / 삭제 / 이동 / 이름 변경
- ⏳ 현재 bootstrap 범위를 넘어서는 `.meta` / GUID 보존 및 mismatch 보호
- ⏳ Material 등 직렬화 Asset 변경 감지
- ⏳ Script / 프로젝트 파일 변경 감지
- ⏳ 상대 Peer에게 필요한 파일만 점진적으로 전송
- ⏳ 더 강한 Project identity / compatibility 검사
- ⏳ Peer 간 Package / Project 차이의 안전한 처리

Asset 동기화는 작은 오류 하나가 Unity 프로젝트 전체의 참조를 조용히 망가뜨릴 수 있기 때문에 안전성과 검증을 우선합니다.

## 3. 쉬운 참여와 유연한 네트워크

장기적으로 TeamForge의 일반 사용 흐름은 다음에 가까워지는 것이 목표입니다.

**Start Collaboration → 초대 → 필요한 Project 준비 → Join Collaboration**

현재 Host/Guest bootstrap과 진단 기반은 존재하지만, 현장 검증이 충분해지기 전에는 일반 사용자 설치 경로를 일부러 크게 홍보하지 않습니다.

- 🟡 더 간단한 Start / Join Collaboration UX
- 🟡 자동 설정과 진단 개선
- 🟡 LAN / Direct-address 협업 흐름
- ⏳ 검증된 Packaged Install / Update / Uninstall 경험
- ⏳ 같은 LAN이 아닌 환경에서도 실용적인 인터넷 협업
- 🔬 Direct P2P가 어려운 환경을 위한 Relay / Coordinator 보조 방식
- 🔬 Self-hosted 및 고급 네트워크 옵션
- ⏳ 더 강한 Peer identity 및 Authorization
- ⏳ 직접 네트워크를 조절하고 싶은 사용자를 위한 Advanced 설정

현재 TeamForge는 **WebRTC, ICE, STUN, TURN, Relay, 자동 NAT traversal을 제공하지 않습니다.** 현재의 P2P 표현이 이런 기능까지 지원한다는 의미로 읽히면 안 됩니다.

> **Zero-config first, never zero-control.**

## 4. 신뢰성, 기록, 복구

협업 도구에서 “대부분 동기화됩니다”는 충분하지 않습니다. 조용히 프로젝트 상태를 잃거나 손상시키는 것보다 명확하게 실패하는 편이 낫습니다.

- 🟡 Transfer Resume/Retry, Integrity verification, Staged activation, Safe-refusal 기반
- 🟡 Reconnect / Baseline mismatch / Stale-state 진단
- ⏳ Host disconnect / crash 복구 강화
- ⏳ 더 안전한 Persistent restart / reconnect
- ⏳ Persistent snapshot 또는 그에 준하는 복구 가능한 상태
- 🔬 Operation / Recovery journal
- 🔬 가능한 경우 Replay / Rollback 구조
- ⏳ 손상되거나 오래되었거나 맞지 않는 Project state 탐지 강화
- ⏳ 장시간 Soak / Stress test
- ⏳ 두 Editor를 넘어서는 Multi-user conflict / load test
- ⏳ 공개 CI / field testing에 적합한 반복 가능한 disposable A/B/C test setup

복구는 동기화가 망가진 뒤 붙이는 기능이 아니라 처음부터 핵심 기능으로 설계하는 것이 목표입니다.

## 5. 테스트와 Release 준비 상태

공개 소스 저장소와 동작하는 개발 Candidate가 있다고 해서 바로 일반 설치 가능한 Alpha가 되는 것은 아닙니다.

- ✅ Node/Server/Project Peer/Launcher source-level 경로의 공개 CI
- ✅ Repository Secret / Dependency / Code scanning 자동화
- ⏳ Unity EditMode를 안정적으로 실행하는 Unity-aware CI
- ⏳ 정확한 두 PC Windows end-to-end field checklist
- ⏳ 실제 공개할 정확한 Artifact를 사용한 fresh-install test
- ⏳ 재현 가능한 Packaged runtime / dependency provenance 및 integrity evidence
- ⏳ 전송 중단, reconnect, host/seed loss, mismatch state를 포함한 Failure / Recovery matrix
- ⏳ 명확한 일반 사용자 Install / Update / Uninstall 문서
- ⏳ 프로젝트를 broadly usable이라고 소개하기 전 외부 Tester 확보

현재 Release gate는 **[STATUS.ko.md](STATUS.ko.md)** 에 정리합니다.

## 6. 보안과 신뢰 경계

TeamForge는 네트워크 메시지와 프로젝트 파일 전송에 관여할 수 있기 때문에 보안 검토는 핵심 로드맵의 일부입니다.

- 🟡 인증 및 Session handling
- 🟡 Signed / validated Invitation 및 Project transfer 흐름
- 🟡 전송 콘텐츠의 무결성 검사
- 🟡 Path / Staging / Activation safety 기반
- ⏳ 더 강한 Peer identity 및 Authorization
- ⏳ 더 체계적인 Untrusted network input validation / fuzzing
- ⏳ Path traversal / Arbitrary file write hardening 지속
- ⏳ Archive / Project extraction / activation 검토 지속
- ⏳ 위험한 Deserialization 및 Command / Code execution 경로 방어
- ⏳ Secret / Token / Credential isolation review
- ⏳ Resource exhaustion 및 DoS 방어
- ⏳ 악성 또는 수정된 Unity Project / Package 처리 정책
- ⏳ 더 높은 품질의 Unity-aware C# static analysis
- ⏳ 프로젝트가 성숙한 이후 독립적인 보안 검토

자동 스캔에 경고가 없다는 사실은 유용하지만 전문적인 보안 감사를 완료했다는 뜻은 아닙니다.

## 7. 장기 협업 연구

아래 기능들은 흥미롭지만 가까운 시일 내 반드시 구현될 기능으로 보면 안 됩니다.

- 🔬 협업을 고려한 Shared Undo / Redo
- 🔬 잠시 Offline에서 편집한 뒤 안전하게 상태 합치기
- 🔬 상황에 따른 Operation-based synchronization 또는 CRDT 계열 구조
- 🔬 더 정교한 자동 Conflict merging
- 🔬 Session을 끊지 않고 Host / Publisher / Seed 역할 이전
- 🔬 더 큰 규모의 팀 지원
- 🔬 협업 기록 및 변경 내역 확인

실제로 유용하다는 근거가 생기기 전까지는 연구 방향으로 남겨둡니다.

## 제품 / 개발 원칙

### Build together. Stay in sync.

TeamForge의 중심은 단순히 파일을 다른 컴퓨터로 보내는 것이 아니라 사람들이 **함께 만드는 경험**을 더 자연스럽게 만드는 것입니다.

### 버전 관리를 없애려 하지 않습니다

Git, Unity Version Control 등 기존 VCS는 기록, 리뷰, 복구에 중요한 역할을 합니다. TeamForge는 그 위의 실시간 협업 계층을 개선하려고 합니다.

### 편리함보다 안전이 먼저입니다

안전한지 증명할 수 없다면 편의를 위해 프로젝트 상태를 조용히 덮어쓰기보다 명확하게 멈추는 편을 선택해야 합니다.

### 문제는 숨기지 않고 복구 가능하게 보여줍니다

두 Peer의 상태가 다르면 한쪽을 조용히 강제로 이기게 하기보다 무엇이 잘못되었는지 알리고 복구 경로를 제공하는 것이 목표입니다.

### 배포는 검증 뒤에 옵니다

설치 버튼이 편리해도 Package / Runtime / Field workflow가 불안정하다면 의미가 없습니다. 일반 사용자 설치 경로는 실제 배포할 Artifact가 준비 상태 gate를 통과한 뒤 홍보하는 것이 원칙입니다.

### AI 사용은 허용하지만 검증 없는 출력물을 목표로 하지는 않습니다

TeamForge 자체도 AI의 도움을 많이 받아 개발되고 있습니다. 기여는 AI 사용 여부가 아니라 정확성, 안전성, 테스트, 유지보수성, 유용성을 기준으로 평가합니다. 자세한 내용은 [CONTRIBUTING.md](../.github/CONTRIBUTING.md)를 확인해 주세요.

## 커뮤니티 피드백이 로드맵을 바꿀 수 있습니다

이 로드맵은 일부러 유연하게 유지합니다. 외부 테스터들이 Scene 기능 확대보다 Onboarding이 더 큰 문제라고 말하면 Onboarding이 먼저 올 수 있고, 어떤 기능이 데이터 무결성 위험을 지나치게 키우면 다시 설계하거나 미룰 수 있습니다.

그래서 초기의 부정적인 피드백도 중요합니다.

원하는 기능이나 만들지 말아야 한다고 생각하는 기능이 있다면 Issue 또는 Discussion에 의견을 남겨 주세요. [CONTRIBUTING.md](../.github/CONTRIBUTING.md)와 [SUPPORT.md](../.github/SUPPORT.md)를 참고할 수 있습니다.
