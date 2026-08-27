# TeamForge 로드맵

[English](ROADMAP.md) | **한국어** | [현재 상태](STATUS.ko.md)

> **Build together. Stay in sync.**
>
> *Zero-config first, never zero-control.*

이 로드맵은 TeamForge의 **개발 방향**을 설명하며 특정 날짜나 기능 구현을 보장하는 약속이 아닙니다. 테스트 결과, 기술적 제약, 보안 문제, 커뮤니티 피드백에 따라 우선순위는 바뀔 수 있습니다. 지금 실제로 구현/검증/차단된 상태는 [STATUS.ko.md](STATUS.ko.md)를 기준으로 합니다.

## 상태 표시

- ✅ **존재 / 자동화됨** — 기능이 구현되었거나 해당 자동 검증 경로가 존재함
- 🟡 **부분 구현 / 안정화 중** — 구현은 존재하지만 신뢰성 또는 Field 검증이 더 필요함
- ⏳ **계획** — 방향에는 포함되지만 아직 지원 기능으로 구현되지 않음
- 🔬 **연구 / 장기 아이디어** — 구조와 실현 가능성이 아직 확정되지 않음

## 0. 현재 기반 — 안정화하면서 신중하게 확장

기존 초기 프로토타입보다 기반은 크게 강해졌지만 WP5.1은 여전히 FIELD BLOCKED입니다.

- ✅ 접속자 Presence
- ✅ Selection / Editor awareness
- 🟡 위치/회전/크기 실시간 Transform 동기화 — 일반 두 PC 사용은 동작하며 #68/#74 계열은 Draft PR #76에 Targeted patch가 들어갔습니다. 동일 PC A/B contention recovery와 A/B/C Late Join은 PASS했고 실제 두 PC contention 재검증이 남아 있습니다.
- 🟡 Server-authoritative Object Lock / Ownership 및 충돌 보호 — 정상 Contention은 동작하며 PR #76이 Foreign-owner/`lock_required` ordering과 Stale protected-conflict recovery를 수리했습니다. Physical field closure는 아직 남아 있습니다.
- 🟡 Same-Scene Hierarchy 생성 / 삭제 / 이름 변경 / Reparent / Sibling order
- 🟡 Project bootstrap 및 Signed/validated Collaboration Invite
- 🟡 Direct P2P Project Peer 전송, Chunking, Integrity, Resume/Retry, Staging, Activation, Seed/Failover 기반
- 🟡 Diagnostics, Mismatch handling, Recovery UX
- 🟡 Windows Path resilience / Managed short execution workspace
- ✅ Server / Project Peer / Runtime loader / Windows Launcher Public source CI
- ✅ 관련 PR과 `main` Push에서 Unity 6000.3.21f1 EditMode + Real-server E2E 자동화
- ✅ Deterministic Multi-peer Authority / Recovery Chaos 자동화
- ✅ WP5.1 r2 Candidate를 새 Artifact로 Rebuild/Publish하는 자동 Workflow
- 🟡 실제 두 PC Fresh-Guest baseline/realtime 흐름은 성공했습니다. #67–#71은 PR #81에 Draft fix가 들어갔지만 각 Windows Field rerun이 남아 있습니다.
- 🟡 Coordinator network interruption/reconnect는 Unity 재시작 없이 실제 Field에서 복구 확인
- ✅ PR #81 Local EditMode: 일반 Local Editor에서 실행 가능한 143 / 143 PASS, CI 전용 Real-server E2E 2개는 의도적으로 Local Ignore되고 GitHub Actions에서 PASS
- ⏳ Blocker Field validation 후 Exact-candidate Fresh-install / Fresh-project 검증
- ⏳ 일반 사용자용 Packaged Alpha 승격
- ⏳ 프로젝트 제작자 이외의 외부 테스트 확대

**현재 개발 원칙:** 폭넓은 동기화 범위를 늘리기 전에 신뢰성, 복구 가능성, 명확한 Authority, 이해 가능한 UX를 우선합니다.

## 1. 바로 다음 작업 — Core fix를 Field에서 검증한 뒤 Scene sync 확장

2026-08-22 실제 두 PC 테스트로 상태가 “Field path가 거의 증명되지 않음”에서 “Baseline path는 동작하지만 구체적인 Release-blocking failure가 확인됨”으로 바뀌었습니다. 이제 해당 실패들에는 Targeted Draft patch가 있으므로, 새로운 Sync surface보다 **실제 Windows workflow에서 패치를 검증하는 것**이 먼저입니다.

### 현재 안정화 우선순위

- 🟡 **#67 Saved-Scene reconnect** — PR #81은 엄격한 Production handoff 검증이 끝난 뒤 Verified reconnect identity를 저장하고, 정확히 같은 Project/Session/Baseline/Canonical path일 때만 Saved Scene hash drift를 허용합니다. Fresh/Unverified Join은 계속 Fail-closed입니다. Local/Automation PASS, Physical saved-Guest reopen은 남아 있습니다.
- 🟡 **#68 / #74 Rapid Transform / Lock protected-conflict 계열** — PR #76이 Foreign-owner/`lock_required` ordering과 First-snapshot dirty-Scene ambiguity를 모두 패치했습니다. CI/Unity automation, 동일 PC A/B contention recovery, A/B/C Late Join이 PASS했습니다. 남은 Gate는 실제 두 PC A/B contention 재검증입니다.
- 🟡 **#69 Receive shutdown exception safety** — PR #81은 Launcher/runtime Dispose 중 Pending bridge request를 Handled `runtime_shutdown` 경로로 정리합니다. 실제 Receive → Close → Restart/Resume Windows test가 남아 있습니다.
- 🟡 **#70 Windows Firewall / Seed onboarding** — PR #81은 Production Seed를 Dynamic `--port 0` 대신 고정 TCP `5091`로 바꿔 좁은 Fixed-port Firewall rule을 사용할 수 있게 했습니다. 실제 LAN Seed/Receive + Restart/Rebind 검증이 남아 있습니다.
- 🟡 **#71 Execution-alias Guest handoff** — PR #81은 승인된 Windows Reparse-point alias가 정확한 Canonical Active Project로 Resolve되는 경우에만 허용하고 Retarget/Unrelated alias는 거부합니다. 실제 Long/Deep-path Launcher handoff rerun이 남아 있습니다.
- ⏳ 수정 뒤 Exact intended candidate에서 관련 Physical two-PC / Windows scenario 재실행

#68/#74의 다음 필수 Physical scenario는 B가 먼저 같은 Object의 Lock/Transform authority를 가진 상태에서 A가 SceneView에서 반복적으로 Contention을 만들고, A의 Active drag 중에는 강제 Snap이 없어야 하며, 놓은 뒤 최신 Authoritative B Transform으로 수렴하고 이후 Lock/Transform 조작도 정상이어야 합니다.

#67/#69/#70/#71의 Field closure도 명확하게 확인합니다. Saved Guest reconnect는 정확히 같은 Verified identity에서만 성공해야 하고, Receive 종료는 Unhandled CLR dialog 없이 재시작/Resume 가능해야 하며, Seed는 `5091`에 안정적으로 Bind되어 LAN에서 동작해야 하고, 정상 ExecutionAlias는 허용되지만 Retargeted alias는 계속 거부되어야 합니다.

Server process 전체 재시작은 현재도 **Disconnect/Fail-closed/Recovery UX** 관점에서 확인할 가치는 있지만 RAM-backed Authority이므로 기존 Session/Lock/Hierarchy/Transform state가 사라지는 것은 예상 동작입니다. Persistent restart recovery는 별도 미래 기능입니다.

### 안정화 이후 제안 WP6 방향

다음 주요 Scene collaboration 확장은 수리/검증된 Transform/Hierarchy/Lock State machine 위에서 동작해야 합니다.

- ⏳ 하나의 GameObject에 같은 타입 Component가 여러 개 붙는 경우까지 고려한 Stable Component identity 정의
- ⏳ 의도적으로 제한된 지원 Component 집합부터 Component Add 동기화
- ⏳ Authority / Lock 검사를 포함한 Component Remove 동기화
- ⏳ 제한된 Property shape부터 Inspector / `SerializedProperty` 변경 동기화
- ⏳ Component/Property operation의 Revision, Ordering, Replay/Idempotency, Stale-state, Rejection 규칙
- ⏳ Undo / Rejection / Reconciliation 후 Local Inspector state가 남지 않는 복구
- ⏳ Reconnect 및 Authoritative resynchronization
- ⏳ 첫 구현부터 Deterministic Unity E2E / Chaos 테스트 포함

처음부터 Unity의 모든 Property를 무작정 직렬화해서 보내는 방식은 피해야 합니다. Object reference, Managed reference, Array/List, Nested structure, Custom drawer, Prefab override, Arbitrary MonoBehaviour data는 각각 명시적인 Identity/Safety 규칙이 필요합니다.

## 2. 기반 이후의 더 깊은 Scene 협업

- 🟡 Same-Scene GameObject Create/Delete/Rename/Reparent/Order 안정성 강화
- 🟡 Transform/Hierarchy/Lock Contention 및 Reconciliation
- ⏳ 더 명확한 Lock / Ownership / Conflict UX
- 🟡 더 강한 Reconnect / Authoritative resynchronization 기반 — PR #81에 Strict Verified Saved-Guest reconnect가 추가됐고 Field validation은 남아 있음
- ⏳ WP6 계약이 검증된 이후 더 넓은 Component/Property 지원
- ⏳ Multiple Scene workflow
- ⏳ Cross-Scene 구조 작업
- ⏳ 큰 Hierarchy와 잦은 수정에서의 성능 개선

목표는 Unity에서 생기는 모든 변경을 그대로 네트워크로 복사하는 것이 아닙니다. 각 Operation에는 Identity, Ordering, Validation, Authority, Conflict rule, 그리고 두 Editor가 어긋났을 때의 안전한 Recovery path가 필요합니다.

## 3. Project / Prefab / Asset 협업

Scene 동기화만으로 두 Unity Project가 완전히 같은 협업 상태가 되는 것은 아닙니다. 장기적으로 다음을 검토할 수 있습니다.

- ⏳ Prefab Structure / Override 협업
- ⏳ Asset Create/Delete/Move/Rename
- ⏳ Bootstrap 범위를 넘어서는 `.meta` / GUID 보존 및 Mismatch protection
- ⏳ Material 및 기타 Serialized Asset 협업
- ⏳ Script / Project file 변경 awareness
- ⏳ 상대 Peer에게 필요한 파일만 점진적으로 전송
- ⏳ 더 강한 Project Identity / Compatibility 검사
- ⏳ Peer 간 Package / Project 차이의 안전한 처리

Asset 동기화는 작은 Identity 오류도 프로젝트 전체 Reference를 조용히 망가뜨릴 수 있어 높은 위험 영역으로 취급합니다.

## 4. 쉬운 참여와 유연한 네트워크

장기적인 일반 사용 흐름은 다음에 가까워지는 것이 목표입니다.

**Start Collaboration → 초대 → 필요한 Project 준비 → Join Collaboration**

Host/Guest bootstrap과 Diagnostics 기반은 존재하지만 Field validation이 충분해지기 전에는 일반 사용자 설치 경로를 적극적으로 홍보하지 않습니다.

- 🟡 더 간단한 Start / Join Collaboration UX
- 🟡 자동 Setup / Diagnostics 개선
- 🟡 LAN / Direct-address 협업 흐름 — PR #81의 Stable Seed TCP `5091`은 Firewall onboarding을 반복 가능하게 만드는 패치이며 Field validation은 남아 있음
- ⏳ 검증된 Install / Update / Uninstall 경험
- ⏳ 같은 LAN이 아닌 환경에서도 실용적인 Internet collaboration
- 🔬 Direct P2P가 어려울 때 Relay / Coordinator-assisted connectivity
- 🔬 Self-hosted / Advanced networking options
- ⏳ 더 강한 Peer identity / Authorization
- ⏳ 고급 사용자용 Manual networking controls

현재 TeamForge는 **WebRTC, ICE, STUN, TURN, Relay, 자동 NAT traversal을 제공하지 않습니다.**

## 5. 신뢰성, 기록, 복구

- 🟡 Transfer Resume/Retry, Integrity verification, Staged activation, Safe-refusal 기반
- 🟡 Reconnect / Baseline mismatch / Stale-state diagnostics — PR #81은 First Join strictness를 유지하면서 Exact Verified Saved-Guest reconnect를 추가했고 Physical validation은 남아 있음
- ✅ 현재 Protocol invariant를 검증하는 Deterministic Authority / Recovery Chaos
- 🟡 Coordinator network interruption / Automatic reconnect는 실제 두 PC에서 확인
- 🟡 좁은 Transform lock-contention recovery는 Targeted EditMode coverage + 동일 PC A/B recovery PASS + A/B/C Late Join PASS를 확보했고 Physical two-PC closure는 남아 있음
- 🟡 Launcher Receive-shutdown race handling이 PR #81에 패치됐고 Interruption/Resume Field test는 남아 있음
- ⏳ Host disconnect / Crash recovery 강화
- ⏳ 안전한 Persistent server/session restart behavior
- ⏳ Persistent snapshot 또는 이에 준하는 Recoverable state
- 🔬 Operation / Recovery journal
- 🔬 가능한 경우 Replay / Rollback 구조
- ⏳ Corrupted / Stale / Mismatched Project state 탐지 강화
- ⏳ Long-running Soak / Stress test
- ⏳ 두 Editor를 넘어서는 Multi-user conflict / Load test
- ⏳ CI/Field에서 반복 가능한 Disposable A/B/C Unity test-project setup

Recovery는 동기화가 망가진 뒤 붙이는 기능이 아니라 처음부터 핵심 기능으로 설계합니다.

## 6. 테스트와 Release 준비 상태

자동 검증 기반은 2026-08-21 크게 확장됐고 실제 두 PC Evidence는 2026-08-22 추가됐습니다. 2026-08-25에는 PR #76에 #68/#74 Focused regression coverage가, PR #81에 #67/#69/#70/#71 Core blocker regression coverage가 추가됐습니다. PR #81 head `8f285ac0ad62202c1d09546948b175804dac69f3`에서 일반 CI run #188과 Unity Tests run #67이 모두 PASS했습니다.

같은 Branch의 Local Unity Test Runner는 총 145개를 발견했고 일반 Local Editor에서 실행 가능한 143개는 모두 PASS했습니다. GitHub Actions command-line switch가 필요한 Real-server E2E 2개는 Local에서 의도적으로 Ignore됐습니다. Standard A/B/C Test Lab Late Join도 Hierarchy/Transform 수렴, Protected conflict 0, Join 이후 편집 동기화까지 PASS했습니다.

- ✅ Node/Server/Project Peer/Runtime-loader/Launcher Public source CI
- ✅ Unity `6000.3.21f1` EditMode Workflow
- ✅ Real-server Unity Authority E2E
- ✅ Real-server Unity Lock-contention E2E
- ✅ Project Transfer Resume E2E
- ✅ Deterministic Authority + Recovery Chaos suites
- ✅ PR #76의 #68/#74 Recovery + First-snapshot dirtiness Focused regression coverage
- ✅ PR #81의 #67/#69/#70/#71 Focused regression coverage
- ✅ Local Test Runner 143 / 143 Runnable tests PASS, CI-only E2E 2개는 Local Intentional Ignore
- ✅ Standard A/B/C Late Join convergence + Post-join editing PASS, Protected conflict 0
- ✅ WP5.1 r2 Rebuild/Stage/Hash/Publish automation
- 🟡 Physical two-PC Fresh-Guest baseline/realtime flow 동작 기록
- 🟡 Coordinator network disconnect/retry/reconnect 동작 기록
- ⏳ Physical two-PC #68/#74 A/B contention 재검증
- ⏳ Physical Windows #67 Saved Guest reconnect 재검증
- ⏳ Physical Windows #69 Receive Close/Restart/Resume 재검증
- ⏳ Physical LAN #70 Stable Seed `5091` / Firewall 재검증
- ⏳ Physical Long-path #71 ExecutionAlias handoff 재검증
- ⏳ Intended candidate에서 Post-fix exact two-PC Windows field closure
- ⏳ Exact intended artifact Fresh-install test
- ⏳ Release closure용 Exact-candidate Unity evidence 보존
- ⏳ 남은 Host/Server/Seed/Process-loss 및 Mismatch/Safe-refusal Field matrix
- ⏳ 일반 사용자용 Install / Update / Uninstall 문서
- ⏳ Broad usability를 주장하기 전 외부 Tester 확보

현재 Release gate와 Evidence 경계는 [STATUS.ko.md](STATUS.ko.md)를 기준으로 합니다.

## 7. 보안과 신뢰 경계

- 🟡 Authentication / Session handling
- 🟡 Signed / Validated Invitation 및 Project Transfer
- 🟡 Transferred content Integrity verification
- 🟡 Path / Staging / Activation safety 기반
- 🟡 Verified reconnect / ExecutionAlias identity checks에 Strict regression coverage 추가, Physical field validation은 남아 있음
- ⏳ 더 강한 Peer Identity / Authorization
- ⏳ 체계적인 Untrusted network input validation / Fuzzing
- ⏳ Path traversal / Arbitrary file write hardening 지속
- ⏳ Archive / Project extraction / Activation review 지속
- ⏳ Unsafe deserialization 및 Command/Code execution path 방어
- ⏳ Secret / Token / Credential isolation review
- ⏳ Resource exhaustion / DoS resistance
- ⏳ Malicious 또는 Modified Unity Project / Package 처리 정책
- ⏳ 더 높은 품질의 Unity-aware C# static analysis
- ⏳ 프로젝트가 성숙한 이후 Independent security review

자동 스캔과 Green test는 Evidence이지 전문 보안 감사를 대신하지 않습니다.

## 8. 장기 협업 연구

- 🔬 Collaboration-aware Shared Undo / Redo
- 🔬 Temporary offline editing 후 Safe reconciliation
- 🔬 상황에 따른 Operation-based synchronization / CRDT 계열 구조
- 🔬 Advanced conflict merging
- 🔬 Session 중단 없이 Host / Publisher / Seed migration
- 🔬 Larger-team scalability
- 🔬 Collaboration history / Change inspection

일부 아이디어는 Unity Data model에 맞지 않거나 복잡도 대비 가치가 낮을 수 있으므로 실제 효용이 검증될 때까지 연구 방향으로 둡니다.

## 제품 / 개발 원칙

### Version control을 대체하지 않습니다

Git, Unity Version Control 등은 History, Review, Backup, Recovery에 중요합니다. TeamForge는 그 위의 Live collaboration layer를 개선하는 것을 목표로 합니다.

### 편리함보다 안전이 먼저입니다

TeamForge가 안전하다고 증명할 수 없는 상태에서 편의를 위해 Project state를 조용히 덮어쓰거나 만들어내면 안 됩니다.

### 실패는 보이고 복구 가능해야 합니다

State가 어긋났을 때 한쪽을 조용히 강제로 이기게 하기보다 명확한 Diagnostic과 Recovery path를 제공하는 것을 우선합니다.

### 배포는 검증 뒤에 옵니다

정확한 Packaged workflow가 아직 FIELD BLOCKED라면 Installer가 예뻐도 일반 사용자 배포 준비가 끝난 것은 아닙니다.

### AI 사용은 가능하지만 검증 없는 출력물을 목표로 하지 않습니다

TeamForge는 AI 도움을 많이 받아 개발됩니다. 변경 사항은 AI 사용 여부가 아니라 Correctness, Safety, Testing, Maintainability, Usefulness로 평가합니다.

## 커뮤니티 피드백이 로드맵을 바꾸는 방식

이 로드맵은 의도적으로 유연합니다. 테스트 결과 Onboarding이 더 큰 문제라면 우선순위를 바꿀 수 있고, 새로운 Sync 기능이 Data integrity 위험을 지나치게 높이면 범위를 줄이거나 재설계하거나 미룰 수 있습니다.
