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

## 지금 — 현재 기반의 Field closure + 좁은 Component 협업 시작

### 현재 안정화 Line의 실제 Windows Field closure

현재 소스에는 알려진 WP5.1 Windows Field blocker의 Targeted fix가 들어 있습니다. 일반 설치 가능한 Alpha로 Promote하기 전에는 의도한 Post-fix Packaged Candidate에서 [STATUS.ko.md](STATUS.ko.md)에 적힌 실제 Windows scenario를 다시 검증해야 합니다.

주요 항목:

- 정상 Collaborative Scene 저장 후 Saved Guest reconnect;
- 빠른 Transform / Lock contention recovery;
- Receive 중단 / Launcher shutdown 및 resume;
- 반복 가능한 LAN Seed / Firewall onboarding;
- Long/Deep Windows path Execution Alias handoff;
- Exact intended artifact에서 Fresh Host → Guest → Realtime collaboration rerun.

### WP6: 좁은 Component / Inspector 기반

현재 안정화 기반 위에서 다음 큰 Scene collaboration 확장은 기존 Authority/Identity/Recovery model을 우회하지 않고 확장해야 합니다.

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
