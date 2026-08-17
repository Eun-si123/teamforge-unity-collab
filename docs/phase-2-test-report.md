# Phase 2 구현·테스트 보고서

- 작성일: 2026-08-02 (Asia/Seoul)
- 저장소/Package/Server 버전: `0.3.0`
- 목표 Unity: Unity 6.3 LTS (`6000.3.x`)
- 우선 검증 Editor: `6000.3.21f1`, changeset `c02631ffc030`
- Wire Protocol: Server `1` / Unity `1`
- 상태: **Source와 Server 자동 회귀 통과 / Unity Compile·EditMode·두 Editor 실기 Gate 미실행**

## 결과 요약

Phase 1의 Ping/Pong과 Presence 계약을 유지하면서 저장된 Baseline Scene GameObject의 `localPosition`, `localRotation`, `localScale`을 Server Revision 순서로 전파하고 GameObject 전체 Lease Lock으로 직렬화하는 Phase 2 수직 흐름을 구현했다. Server 자동 테스트, 실제 Local Socket Smoke, 정적 Repository 검증은 통과했다. 현재 환경에는 Unity Editor와 Docker가 없어 Unity Package의 실제 Compile/EditMode/두 Editor 동작과 Docker Image Build는 완료로 표시하지 않는다.

Phase 4의 생성·삭제·이름·활성·부모·형제 순서는 구현하지 않았으며 이 보고 뒤 자동으로 진행하지 않는다.

## Phase 1 잔여 검증 결과

사용자는 Unity `6000.3.21f1`과 미니 PC Docker/Bearer 환경에서 Package/창, 같은 Session의 두 Editor 참가자, 선택/선택 해제, Frame Selection, Go to Camera, Disconnect/재접속, Server 재시작 후 Presence 복구를 실제 확인했다.

이번 작업에서는 Server 23개 회귀에 다음 Phase 1 잔여 항목을 추가·유지했다.

- 같은 Session 세 Editor Presence Burst
- 잘못된 Camera 숫자와 다른 사용자 Identity 거부
- 동일 안정 User ID 재접속과 오래된 연결 대체
- 같은 Session의 Phase 1 Client에 Transform/Lock Event를 보내지 않는 Capability 격리
- Hello Timeout과 WebSocket Ping/Pong 생존 확인 뒤 Presence/Lock 정리
- `TeamForgePresenceSafetyTests.cs`의 잘못된 Snapshot 원자적 거부와 Scene Dirty/Undo 비변경 계약

Server 자동 검증은 통과했지만 Unity EditMode Source는 실행하지 못했다. 수천 Object, 장시간 세 Editor, 실제 송신 빈도와 Profiler 성능도 미측정이다.

## 구현한 기능

- `supportsTransformSync`/`transformSyncEnabled` Capability 협상
- 저장·공유 Baseline Object/Parent의 `GlobalObjectId` 식별
- 단일 선택 Local Position/Rotation/Scale, 기본 10Hz 제한과 Final Send
- Server 권한 Session Revision과 Operation ID 전체 Payload 멱등성
- GameObject 전체 Lock, Lease 갱신/거부/명시 해제/Disconnect·Timeout 정리
- 늦은 참가자의 활성 Session Transform/Lock Memory Snapshot
- 원격 적용 Scope와 재전송 억제
- 원격 Target의 stale Undo 제거, 다른 Object Undo 격리, 실제 변경 시 Scene Dirty
- Scene 안 Prefab Instance Override 기록
- Dirty Snapshot, Protocol/Lock/Lease 오류의 Object 단위 Conflict 차단
- Clean Baseline을 `SessionState`에 보존해 단순 재접속/Assembly Reload 때 자동 확대 방지
- 다중 선택, Prefab Stage, 새/미저장 Object, Parent/Scene Drift 안전 차단
- Session Object/Lock/Snapshot, Socket 발신 Buffer, Hello/Heartbeat 상한
- Manual Disconnect 전 Final Transform/Lock Release Queue Drain
- UI의 Session Revision, Lock/Conflict/Diagnostics 상태와 Acquire/Release 조작

## 변경 파일

Phase 1 고정 ZIP과 비교해 Root, 문서, Server, Unity Package, Validation Project가 변경됐다. 상세 파일 목록은 [Phase 2 상태 문서](phases/phase-2.md)의 `구현·변경 파일`을 기준으로 한다.

| 영역 | 주요 변경 |
| --- | --- |
| Root/검증 | `README.md`, `package.json`, `scripts/validate-repository.mjs` |
| 상태/설계/배포 | `docs/roadmap.md`, `project-state.md`, `architecture-decisions.md`, `known-issues.md`, `deployment.md`, `phases/phase-0.md`, `phase-1.md`, `phase-2.md`, 본 보고서와 기존 테스트/호환/Protocol 문서 |
| Server | 설정/Protocol/Session Host, Docker/Compose, Smoke, 23개 Test, Package/Lockfile |
| Unity 연결/UI | Connection, Transport, Settings, Protocol DTO, Presence 경계, UI |
| Unity Transform | `Editor/TransformSync` 모델/서비스와 `.meta` |
| Unity Tests | Protocol 확장, Presence Safety, Transform/Lock/Baseline/Undo/Prefab Test Source |
| Validation Project | `unity-project/README.md`; `ProjectVersion.txt`는 `6000.3.21f1` 유지 |

삭제한 기존 Project Source는 없다. Phase 1 ZIP은 Rollback 기준선으로 그대로 보존했다.

## 설계 결정과 이유

| 결정 | 이유 | 단점/교체 조건 |
| --- | --- | --- |
| Protocol v1 가산 Capability | Phase 0/1 Envelope와 의미를 깨지 않음 | 호환 불가능한 Envelope 변경 때 Version 증가 |
| Server 전역 Revision + Operation ID | 순서와 재전송 멱등성을 명시 | 현재 메모리 전용; Phase 5 Log 필요 |
| GameObject Lease Lock | 세 명 MVP에서 가장 예측 가능한 충돌 단위 | 선택과 편집 구분이 거침; UX 측정 후 변경 |
| Clean Saved Baseline만 허용 | 임시 ID/Hierarchy 불일치로 다른 Object를 바꾸지 않음 | 새 Object/Parent 변경은 Phase 4까지 차단 |
| 원격 값을 일반 Undo에 넣지 않음 | 원격 작업이 로컬 Undo 순서를 오염시키지 않음 | 해당 Target의 과거 Undo는 제거됨 |
| Dirty 불일치 자동 덮어쓰기 금지 | 미저장 사용자 값을 보존 | 자동 Merge 없음; Phase 5 Diff/Resync 필요 |
| 유한 Snapshot/Lock/Buffer/Heartbeat | 무제한 메모리·연결 Slot 소비 방지 | 큰 Scene은 Chunking/Paging 필요 |

상세 근거와 교체 조건은 [Architecture Decisions](architecture-decisions.md)의 D-201~D-208에 기록했다.

## 실행 환경

- Node.js: `v24.14.0`
- npm: `11.9.0`
- Server 선언 최소 Node.js: 20
- `ws`: `8.21.1`, Lockfile 고정
- 현재 환경 Unity Editor/.NET C# Compiler/Docker: 없음
- 사용자 Phase 1 실기 Unity: `6000.3.21f1`
- 사용자 Phase 1 실기 Server: 미니 PC Docker + Bearer Token

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `npm ci --cache /tmp/teamforge-phase2-cache... --prefer-online` | 성공: Lockfile 기준 1 Package Clean Install |
| `npm --prefix server run check` | 성공: Node Entry/Server Syntax |
| `npm --prefix server test` | 성공: 23/23, 실패/Skip 0 |
| `npm run smoke` | 성공: Health, Legacy Hello/Pong, Presence, Transform Snapshot, Lock Grant, Revision 1 Transform, Lock Release; 관측 RTT 0.28ms |
| `npm --prefix server audit --omit=dev` | 성공: 알려진 취약점 0개 |
| 최종 `npm test` | 성공: Server 23/23 + 103 Source files / 21 C# / Protocol v1 |
| `UNITY_EDITOR=... ./scripts/run-unity-tests.sh` | 미실행: Unity Editor 없음 |
| `docker compose build` | 미실행: Docker 없음 |

첫 Clean Install은 환경의 npm 기본 Cache `/root/.npm` 접근으로 `ENOENT` exit 254가 발생했다. 새 작업 전용 `/tmp` Cache를 `--cache`로 명시한 재시도는 성공했고, 그 상태에서 전체 Server Test/Smoke/Audit를 실행했다. Source나 Lockfile를 우회하거나 변경하지 않았다.

## Server 자동 테스트 23개

1. Health와 Connection/Session/Presence/Lock/Transform 수치
2. Hello 뒤 상관관계 Ping/Pong
3. Hello 전 Ping 거부
4. Protocol Version 불일치 종료
5. 선택적 Bearer Token
6. 배포별 Health/WebSocket Path
7. 연결별 Rate Limit
8. Presence Snapshot/Join/Update/Leave
9. Project/Session Presence 격리
10. 잘못된 Presence Camera/Identity 거부
11. 동일 안정 User ID 재접속 교체
12. Transform Snapshot 협상과 같은 Session Phase 1 호환
13. Lock 직렬화, Transform, Operation 멱등성
14. 늦은 참가자의 최신 Revision/Transform/Lock
15. 잘못된 숫자·위조·Future Revision·Operation ID 충돌 거부
16. Lease Timeout과 다른 Editor 재획득
17. 동일 User ID 교체 시 Lock 해제
18. 세 Editor Presence Burst
19. Transform/Connection Lock Resource Limit
20. Snapshot Byte Limit과 Revision 원자성
21. Lock Owner의 stale Session Base 정책
22. Hello 누락 Connection Slot 회수
23. non-Pong Client 종료와 Lock 정리

## Unity EditMode 테스트 Source

- Protocol Snapshot Round-trip
- Transform Capture/값 비교/중첩 Remote Apply Scope
- 원격 Apply Dirty/No-op, Target Undo 격리와 stale Undo 제거
- Prefab Instance Override Save/Reopen
- Clean Baseline, 새 Object 제외, Parent 일치, Snapshot/Restore, 재접속 Baseline 비확장
- Lock Registry Snapshot 원자성, Quaternion 안전 처리
- Presence Registry 안전성과 Selection 수신의 Scene Dirty/Undo 비변경

이 Source는 Unity Compiler/Test Runner 결과가 아니다. 저장소 Validator는 JSON, `.meta`/GUID, C# 문자열·주석 제외 Delimiter, 금지 Instance ID, Version/Protocol 정합성을 검사할 뿐 Unity Compile을 대체하지 않는다.

## 최종 저장소 검증

최종 `npm test`는 Server `23/23`(실패·취소·Skip 0)과 Repository `103 source files / 21 C# sources / Protocol v1` 검증을 통과했다. Validator는 Root/Server/Lockfile/UPM `0.3.0`, Server/Unity Protocol `1`, Unity `6000.3.x`, 필수 상태·Roadmap·Phase 문서, JSON, `.meta`/GUID, C# 구조를 함께 확인했다. 배포 ZIP과 동반 Checksum은 Source 수에서 제외한다.

## 서브 에이전트 사용과 통합

- Server/Protocol 보안·동시성 검토: 읽기 전용
- Unity Compile/Lifecycle/Undo/Dirty 검토: 읽기 전용
- Release/문서/배포/호환성 검토: 읽기 전용
- 세 검토자는 파일을 수정하지 않았고, 주 에이전트가 공통 Protocol/Revision 계약 아래 수정·통합·전체 테스트를 직접 수행했다.

검토에서 Capability 전 수신 적용, Parent/Scene Drift Final Send, Lease Race, Dirty Snapshot Live Overwrite, stale Undo, Prefab Stage, 재접속 Baseline 확대, Operation ID 충돌, Session/Buffer 무제한, Hello/Heartbeat 부재, Docker Health 경로 불일치를 발견해 수정했다. 최종 Unity 읽기 전용 재검토에서는 정적으로 재현 가능한 Critical/High 문제가 남지 않았지만 실제 Unity 실행 Gate는 그대로 남아 있다.

## 성공한 시나리오

- Phase 0 Hello/Ping/Pong 회귀
- Phase 1 Presence/Identity/Session 격리와 같은 Session Capability 호환
- 두 Editor Lock 경쟁, Lease 만료, 종료/동일 ID 교체 정리
- Transform 승인 Revision, 멱등 재전송, 잘못된 Operation 원자적 거부
- 늦은 참가자 Memory Snapshot
- Resource/Snapshot/Rate/Connection/Heartbeat 상한
- Local Process의 실제 WebSocket 수직 Smoke
- Root/Server/Lockfile/UPM Version과 Server/Unity Protocol 정합성

## 실패·미확인 항목

| 항목 | 상태 | 다음 검증 |
| --- | --- | --- |
| Unity `0.3.0` Compile | 미실행 | `6000.3.21f1` Console Error 0 |
| Unity EditMode 전체 | Source만 작성 | Test Runner/Batch Script 결과 XML |
| 두 Editor Transform/Lock | 미실행 | Manual Checklist G~L |
| Undo/Dirty/Prefab 실기 | 미실행 | Save/Reopen, 다른 Object Undo, Prefab Mode/Instance |
| Assembly Reload/재접속 Baseline | 미실행 | Dirty/Clean/새 Object 행렬 |
| 장시간 3 Editor/수천 Object | 미측정 | Profiler, 실제 TX Rate/연결 시간 |
| 고 RTT 즉시 Disconnect | 미측정 | Final Transform/Release 관측 |
| Docker Image/Custom Health Path | 미실행 | Compose Build/Health |
| 실제 `0.2 ↔ 0.3` Binary 조합 | 미실행 | 양방향 Compatibility Matrix |
| WSS/Reverse Proxy | 미실행 | 목표 Proxy/TLS 환경 Smoke |

## 알려진 문제와 기술 부채

- Lock 인계 뒤 stale Session `baseRevision`은 현재 Lock Owner라면 허용되어 오래된 값이 최신 Object 상태를 덮을 수 있다. Object Revision/Lock Token이 필요하다.
- 활성 Session Transform/Lock/Revision은 메모리 전용이며 Server 재시작/마지막 사용자 퇴장 뒤 소실된다.
- Revision Gap 조회, Operation Log, 영속 Snapshot과 Merge는 Phase 5 범위다.
- 선택 자체가 Lock을 얻으므로 탐색과 편집의 구분이 거칠다.
- 원격 확정 Target의 기존 로컬 Undo History는 제거된다.
- 첫 합류에 보존 Baseline이 없는 Dirty Scene, 새/미저장 Object, Parent/Scene 변경, 다중 선택, Prefab Stage는 동기화하지 않는다.
- 공유 Bearer Token은 User ID 소유권을 증명하지 않으므로 신뢰되지 않은 인터넷 공개에 적합하지 않다.
- Scene 최초 Baseline에서 Object별 `GlobalObjectIdSlow`를 사용하므로 수천 Object 연결 성능은 미측정이다.

전체 목록은 [Known Issues](known-issues.md)를 기준으로 유지한다.

## 서버/클라이언트 호환성

| Client → Server | 기대 기능 | 검증 수준 |
| --- | --- | --- |
| Phase 0 → `0.3.x` | Hello/Ping/Pong | Server 자동 테스트 |
| Phase 1 `0.2.x` → `0.3.x` | Presence만 | 같은 Session Capability 자동 테스트; 실제 Binary 미실행 |
| Phase 2 `0.3.x` → `0.2.x` | Presence 유지, Transform 미지원 | Source Capability 설계; 실제 Binary 미실행 |
| Phase 2 `0.3.x` → `0.3.x` | Presence + Transform + Lock | Server 자동/Socket Smoke; Unity 실기 미실행 |

## 업데이트와 롤백

모든 Editor Disconnect → Scene/프로젝트와 `.meta` Backup → Server 교체 → Unity Package 교체 → Compile/EditMode → 별도 Test Session 순서를 따른다. Phase 2 Memory Snapshot은 Server 교체 때 사라지므로 각 Editor의 의도한 최종 Transform을 먼저 비교해야 한다.

Rollback 기준은 `Unity-TeamForge-Phase1-v0.2.0.zip`, SHA-256 `4cbfb07c0dd095350af6fc591e619f45f6160ae9801f6fcaf1f4c592e6f01941`이다. 현재 폴더를 덮어쓰지 않고 새 경로에 풀어 `npm ci && npm test` 뒤 `0.2.0` Server/Package를 함께 교체한다. 상세 명령은 [Deployment](deployment.md)에 있다.

Phase 2 Source 배포본은 `Unity-TeamForge-Phase2-v0.3.0.zip`으로 제공한다. 자기 자신의 Checksum을 포함할 수 없으므로 동반 `.zip.sha256` 파일과 최종 인계 보고에 SHA-256을 기록한다.

## 다음 Phase 시작 조건

Phase 2 구현과 자동 검증은 완료됐지만 Unity `6000.3.21f1` Compile/EditMode/두 Editor 실기 검증은 아직 완료되지 않았다. 사용자가 2026-08-03 Phase 3 착수에 한해서만 이 Gate를 기다리지 않는 1회성 예외를 명시적으로 승인했다. 위 실패·미확인 표와 수동 체크리스트는 유지하며 실기 결과가 도착하면 이 보고서에 별도로 반영한다. 이 예외는 Phase 4 이후 Gate를 자동 해제하지 않는다.
