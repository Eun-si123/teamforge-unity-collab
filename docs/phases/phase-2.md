# Phase 2 — Transform Sync and Object Lock

- 상태: 완료 — Source/Server 자동 검증 및 사용자 제공 Unity `6000.3.21f1` 수동 Gate 통과
- 버전: `0.3.0`
- Wire Protocol: Server `1` / Unity `1` 가산 Capability
- 목표 Editor: Unity 6.3 LTS (`6000.3.x`), 검증 우선 Patch `6000.3.21f1`

## 범위와 제외 범위

구현 범위:

- Clean Saved Scene Baseline의 단일 GameObject
- `localPosition`, `localRotation`, `localScale`
- 기본 10Hz 중간 상태와 선택/수동 Disconnect 전 Final Send
- Server 권한 Session Revision, 전체 Payload Operation ID 멱등성
- GameObject 전체 Lease Lock, 갱신/거부/해제/Timeout
- 활성 Session의 최신 Transform/Lock Memory Snapshot
- 원격 적용 재전송 억제, Prefab Instance Override, Scene Dirty, Target Undo 격리
- Dirty Snapshot/Protocol Error/Lease Loss Conflict의 Object 단위 안전 차단

명시적 제외:

- 생성/삭제/이름/활성/부모/형제 순서(Phase 4)
- 다중 선택 Transform, Prefab Stage, Baseline 뒤 생성/미저장 Object
- 일반 Component/Asset/Code
- 영속 Operation Log, 누락 Revision 조회, Server Restart 복구(Phase 5)

## Message/Revision 계약

- Hello/Ack: `supportsTransformSync` / `transformSyncEnabled`
- Lock: `lock_request`, `lock_granted`, `lock_denied`, `lock_state_changed`, `lock_release`, `lock_released`
- Transform: `transform_update`, `transform_applied`, `transform_snapshot`
- 승인된 Update만 Session Revision을 증가시킨다.
- 같은 Operation ID와 같은 전체 의미 Payload는 멱등이다. 다른 Payload 재사용은 `operation_id_conflict`다.
- Future `baseRevision`은 거부한다. Lock Owner의 stale Session Base는 10Hz/RTT Pipeline을 위해 허용한다.
- Phase 0/1 Client에는 협상하지 않은 Presence/Transform Event를 보내지 않는다. Unity도 Ack 전/미협상 수신을 연결 오류로 처리한다.

## 안전 정책

- 연결 시 Clean Scene Object/Parent를 Baseline으로 캡처하고 Assembly Reload 동안 `SessionState`로 보존한다.
- Baseline 뒤 생성 Object, Parent/Scene 변경, 다중 선택, Prefab Stage는 전송하지 않는다.
- Clean Scene Snapshot은 Server 우선이다. 연결 시 이미 Dirty인 Scene의 다른 값은 자동 덮어쓰지 않고 해결 대기 상태로 둔다.
- 원격 값은 새 Local Undo를 만들지 않는다. 같은 값이어도 Target의 과거 Undo를 제거해 stale Local 값의 부활을 막는다. 값이 다를 때만 Scene을 Dirty로 표시한다.
- Lock/Operation 오류나 Lease Deadline에서 미확정 Local 값은 보존하되 해당 Object의 자동 송신과 Lock을 차단한다.
- Manual Disconnect는 Final Transform/Lock Release를 먼저 Queue하고 Transport Send Gate를 Drain한 뒤 Close한다.

## 구현·변경 파일

Root/검증:

- `README.md`, `package.json`, `scripts/validate-repository.mjs`

상태/설계/배포/보고:

- `docs/architecture.md`, `docs/architecture-decisions.md`, `docs/compatibility.md`
- `docs/project-state.md`, `docs/known-issues.md`, `docs/deployment.md`, `docs/roadmap.md`
- `docs/phases/phase-0.md`, `docs/phases/phase-1.md`, `docs/phases/phase-2.md`
- `docs/manual-test-checklist.md`, `docs/phase-1-test-report.md`, `docs/phase-2-test-report.md`, `docs/protocol-v1.md`

Server:

- `server/.env.example`, `server/Dockerfile`, `server/compose.yaml`, `server/README.md`
- `server/package.json`, `server/package-lock.json`
- `server/src/config.mjs`, `server/src/protocol.mjs`, `server/src/teamforge-server.mjs`
- `server/scripts/smoke.mjs`, `server/test/server.test.mjs`

Unity Package:

- `unity-package/com.eunsung.teamforge/package.json`, `README.md`, `CHANGELOG.md`, `Documentation~/index.md`
- `Editor/Connection/TeamForgeConnectionService.cs`
- `Editor/Presence/TeamForgePresenceService.cs`
- `Editor/Protocol/TeamForgeProtocol.cs`
- `Editor/Settings/TeamForgeConnectionSettings.cs`
- `Editor/Transport/ClientWebSocketTransport.cs`
- `Editor/UI/TeamForgeWindow.cs`
- `Editor/TransformSync.meta`, `Editor/TransformSync/TeamForgeTransformModel.cs[.meta]`, `TeamForgeTransformSyncService.cs[.meta]`
- `Tests/Editor/TeamForgeProtocolTests.cs`
- `Tests/Editor/TeamForgePresenceSafetyTests.cs[.meta]`
- `Tests/Editor/TeamForgeTransformModelTests.cs[.meta]`

Validation Project:

- `unity-project/README.md`

## 자동 테스트 결과

- `npm test`: Server `23/23` 통과
- Repository Validator: `103 source files`, `21 C# sources`, Server/Unity Protocol `v1`, Version `0.3.0` 정합성 통과
- `npm run smoke`: Health, Legacy Hello/Pong, Presence, Transform Snapshot, Lock Grant, Revision 1 Transform, Lock Release 통과; 관측 RTT 0.28ms
- Server Test는 Phase 0 Ping, Phase 1 Presence/Identity/3-Editor Burst, Phase 2 Capability/Lock/Lease/Revision/Dedup/Snapshot/Resource Limit/Hello Timeout/WebSocket Heartbeat를 포함한다.

Unity EditMode Test Source:

- Transform Capture/Validation/Remote Apply/No-op Dirty
- Target Undo 격리와 stale Undo 방지
- Prefab Instance Override Save/Reopen
- Clean Baseline, 새 Object 제외, Parent Baseline, Snapshot/Restore
- Lock Registry Atomic Validation
- Presence가 Scene Dirty/Undo를 만들지 않는 계약

Phase 2 작성 당시 자동 환경에서는 Unity Editor Test를 실행하지 못했지만, 이후 사용자가 제공한 Unity `6000.3.21f1` 수동 결과로 Phase 1/2 Gate는 통과했다. 현재 v0.4.1 안정화 Host에도 같은 Editor가 설치돼 있으나 Host Launch 승인/Usage 차단으로 새 Batch Process는 시작되지 않았으며, 이는 완료된 Phase 2 수동 Gate를 되돌리지 않는다.

## 서브 에이전트 사용과 통합

- 사용: 예
- 역할: Server Security/Concurrency, Unity Compile/Lifecycle/Undo/Dirty, Release/Docs/Compatibility의 세 가지 읽기 전용 검토
- 파일 경계: 서브 에이전트는 파일을 수정하지 않았고 주 에이전트가 모든 수정·통합·전체 테스트를 수행
- 통합에서 발견·수정: Connect 재진입 Stack Overflow, Capability 전 수신 적용, Parent/Scene 잘못된 Final Send, Protocol Error 대상 오인, Lease Renewal/상실 Race, Dirty Snapshot 후 Live Overwrite, stale Undo, Prefab Stage, 미저장 새 Object ID, Assembly Reload Baseline 손실, Server Memory/Buffer/Idle Connection 상한, Operation ID Payload 충돌, Docker Health 경로

## 추가 보강/장기 행렬

- 실제 10Hz/RTT/장시간 3 Editor 성능
- Prefab Instance Override 및 Prefab Stage 차단의 독립 세부 결과 기록
- Script Recompile/Network Disconnect 중 Dirty Baseline/Conflict UX
- Manual Disconnect의 극단적 Network 지연 Ack 보장
- 실제 `0.2 Client ↔ 0.3 Server` 양방향 Binary 조합
- 현재 안정화 Host의 Docker Image Build와 Custom Health Path Container 상태 (`NOT RUN`: Docker 없음)
- 사용자별 인증/권한과 영속 Recovery는 현재 범위 밖

## 업데이트/롤백

[deployment.md](../deployment.md)의 Backup → Disconnect → Server/Package 교체 → Compile/EditMode → Test Session 순서를 따른다. Phase 1 Rollback Archive와 SHA-256도 같은 문서에 기록했다. Phase 2 Server 상태는 메모리 전용이므로 교체 전에 각 Editor의 Scene을 검토해야 한다.

## Gate 이력과 다음 Phase

구현과 자동 검증 뒤 사용자는 2026-08-03 Phase 3 착수에 한해 Phase 2 실기 Gate를 먼저 해제했다. 이후 제공된 수동 결과로 Phase 1/2 Gate는 통과 상태가 됐다. 기존 체크리스트는 당시 개별 관측 범위를 보존한다. 이 이력은 Phase 3 Gate나 Phase 4를 자동 해제하지 않으며, Phase 3 v0.4.1 수동 검증과 새 사용자 승인 없이는 Phase 4를 시작하지 않는다.
