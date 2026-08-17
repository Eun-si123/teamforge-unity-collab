# Phase 1 구현·테스트 보고서

- 작성일: 2026-08-02 (Asia/Seoul)
- 저장소 버전: `0.2.0`
- 목표 Unity: Unity 6.3 LTS (`6000.3.x`)
- 샘플 기준 Editor: `6000.3.21f1`, changeset `c02631ffc030`
- 상태: **핵심 Presence 수직 흐름 Unity 실기 확인 / Server 잔여 자동 검증 보강 완료 / Unity 성능·EditMode 일부 미확인**

## 사용자 실제 환경 검증

사용자가 Unity `6000.3.21f1`과 미니 PC Docker 서버에서 다음을 직접 확인했다.

- UPM Package Load와 Collaboration 창
- Docker 서버 연결과 Bearer Token 인증
- 같은 Project ID/Session ID의 두 Editor 참가자 표시
- 선택 정보 동기화와 선택 해제
- Frame Selection과 Go to Camera
- Disconnect/재접속 시 목록 갱신
- 서버 재시작 후 자동 재접속과 Presence 복구

이 결과는 사용자가 제공한 실제 검증 근거이며, 현재 Codex 실행 환경에서 Unity/Docker를 다시 실행했다는 의미는 아니다.

## 구현한 기능

- Project ID + Session ID로 격리된 사용자 Registry
- 안정 사용자 ID, 표시 이름, `#RRGGBB` 색상
- Presence Snapshot, 입장, 전체 상태 갱신, 퇴장
- Scene 이름/GUID, 선택 GameObject 이름/`GlobalObjectId`
- Scene View Camera 위치·회전·피벗·크기·Orthographic 상태
- 변경 Threshold, 설정 가능한 Sampling Rate, Heartbeat
- 원격 선택 Wireframe/이름표, Frame Selection, Go to Camera
- Assembly Reload/재접속 시 같은 사용자 ID의 오래된 연결 대체
- 잘못된 문자열·색상·숫자·사용자 위조 업데이트 거부
- Phase 0 Client에 Presence Event를 보내지 않는 기능 협상
- Health 응답의 현재 Session/Presence Member 수

Presence 수신은 Scene Object를 읽어 표시할 뿐 값을 수정하거나 Scene Dirty/Undo를 만들지 않는다.

## 주요 변경 파일

| 영역 | 파일 |
| --- | --- |
| Server Protocol/Validation | `server/src/protocol.mjs` |
| Server Session Registry | `server/src/teamforge-server.mjs` |
| Server 자동 테스트 | `server/test/server.test.mjs` |
| 실제 흐름 Smoke | `server/scripts/smoke.mjs` |
| Unity DTO | `Editor/Protocol/TeamForgeProtocol.cs` |
| Unity 연결 Router | `Editor/Connection/TeamForgeConnectionService.cs` |
| Unity Presence 모델 | `Editor/Presence/TeamForgePresenceModel.cs` |
| Unity Object Identity | `Editor/Presence/TeamForgeObjectIdentity.cs` |
| Unity Sampling/Scene 표시 | `Editor/Presence/TeamForgePresenceService.cs` |
| Unity UI/Settings | `Editor/UI/TeamForgeWindow.cs`, `Editor/Settings/TeamForgeConnectionSettings.cs` |
| Unity 테스트 | `Tests/Editor/TeamForgeProtocolTests.cs`, `TeamForgePresenceRegistryTests.cs`, `TeamForgeGlobalObjectIdProbeTests.cs`, `TeamForgeInputValidatorTests.cs` |
| 설계/실행 문서 | `docs/architecture.md`, `docs/protocol-v1.md`, `docs/decisions/phase-1.md`, `docs/manual-test-checklist.md` |

새 Unity Source와 폴더에는 고유 `.meta` GUID를 함께 추가했다.

## 버전과 실행 환경

- 실제 Node.js: `v24.14.0`
- 실제 npm: `11.9.0`
- Server 선언 최소 Node.js: 20
- WebSocket: `ws 8.21.1`, Lockfile 고정
- 사용자 실제 Unity Editor: **`6000.3.21f1` 핵심 시나리오 통과**
- 현재 Codex 환경 Unity Editor: **없음**
- 실제 C# Compiler/.NET SDK: **없음**
- 사용자 Docker 환경: **미니 PC 서버 연결/Bearer/재시작 복구 통과**
- 현재 Codex 환경 Docker: **없음**

## 실행한 명령과 결과

| 명령 | 결과 |
| --- | --- |
| Phase 1 시작 전 `npm test` | 성공: Phase 0 Server 7/7 + 저장소 검증 |
| `npm --prefix server run check` | 성공: Node Entry/Server Syntax |
| `npm --prefix server test` | 성공: Server 11/11 |
| 최종 `npm test` | 성공: Server 11/11 + 86 files / 17 C# sources / Protocol v1 검증 |
| `npm run smoke` | 성공: Health, Legacy Hello/Pong, Presence Snapshot/Update, 최종 관측 RTT 0.53ms |
| `npm --prefix server audit --omit=dev` | 성공: 알려진 취약점 0개 |
| `UNITY_EDITOR=... ./scripts/run-unity-tests.sh` | 미실행: Unity Editor 없음 |

## Server 자동 테스트 결과

통과한 11개 시나리오:

1. Health와 연결/Session/Presence 수치
2. 기존 Hello 뒤 상관관계 Pong
3. Hello 이전 Ping 거부
4. Protocol Version 불일치 종료
5. 선택적 Bearer Token
6. 배포별 Health/WebSocket Path
7. 연결별 Rate Limit
8. Presence Snapshot → Join → Update → Leave
9. Project/Session 격리
10. 다른 사용자 ID 위조 Update 거부 후 연결 유지
11. 동일 안정 사용자 ID 재접속이 오래된 Presence 대체

기존 Phase 0 Hello에는 `supportsPresence`가 없으며 Ack 직후 Ping을 보내도 중간 Snapshot 없이 Pong을 받는 테스트를 유지했다.

## Phase 2 작업에서 보강한 Phase 1 회귀 검증

`0.3.0` Server의 23개 자동 테스트에는 기존 11개 시나리오에 더해 같은 Session의 세 Editor Presence Burst, Phase 1 Client에 Transform/Lock Event를 보내지 않는 Capability 격리, 잘못된 숫자·Identity·사용자 ID 충돌/동일 ID 연결 교체, Hello Timeout과 WebSocket 생존 확인을 포함했다. `TeamForgePresenceSafetyTests.cs`에는 Presence Registry의 잘못된 Snapshot 원자적 거부와 선택 정보 수신이 Scene Dirty/Undo를 만들지 않는 계약을 추가했다.

Server 자동 검증은 통과했지만, 새 Unity EditMode Source는 현재 실행 환경에 Unity Editor가 없어 실행하지 못했다. Presence 송신 빈도·수천 Object Scene·장시간 세 Editor 성능도 측정하지 않았으므로 Phase 1의 실기 근거와 미확인 항목을 계속 분리한다.

## Unity EditMode 테스트 준비 상태

작성한 테스트 Source는 다음을 다룬다.

- 기존 URI/WS/WSS 변환과 입력 검증
- Ping과 중첩 Presence DTO의 `JsonUtility` Round-trip
- 안정 User ID와 HTML 색상 검증
- Registry Snapshot/Upsert/Leave와 잘못된 Snapshot 원자적 거부
- 저장 Object ID의 복제·부모 변경·Scene Reload 안정성
- 새 Object Identity API의 ID 생성과 역해석

이 환경에서는 Unity Test Runner를 실행하지 못했다. 저장소 검증은 모든 C# 파일의 문자열/주석을 제외한 구분자 균형, 금지 Instance ID 사용, `.meta` 존재/중복 GUID, Package/Protocol/Version 일치를 확인한다. 이는 Unity Compiler 대체가 아니다.

## 개발 중 실패와 수정

- 첫 `npm --prefix server ci`는 npm 기본 Cache `/root/.npm`을 만들 권한이 없어 실패했고 `node_modules`가 부분 정리됐다. `/tmp/teamforge-phase1-npm-cache`를 지정한 Clean Install로 즉시 복구했다. Lockfile/Source 변경은 없었다.
- 첫 최종 저장소 검증은 새 규칙이 `presence_update` 문자열을 실제 처리 파일이 아닌 `server/src/protocol.mjs`에서 찾도록 잘못 작성되어 실패했다. 검사 대상을 `server/src/teamforge-server.mjs`로 고친 뒤 전체 `npm test`가 통과했다.

## 성공한 시나리오

- Legacy Phase 0 연결과 Phase 1 Client의 동시 호환
- 같은 Session의 Server 권한 Presence 순서
- 다른 Project/Session으로 정보 누출 방지
- 전체 상태 Heartbeat를 통한 최신값 갱신
- 재접속 중 Presence 중복 방지
- 입력 크기/Rate/Auth 보호와 사용자 ID 위조 거부
- Health → Legacy Hello/Ping/Pong → Presence Hello/Snapshot/Update 실제 Socket Smoke
- UPM/asmdef/manifest/Lockfile/Version 정적 일관성

## 실패 또는 남은 실기 검증

| 시나리오 | 현재 상태 | 다음 검증 |
| --- | --- | --- |
| Unity Package Compile/창 | 사용자 실기 통과 | Phase 2 Package에서 재확인 |
| Unity EditMode Test | Source 작성, 실제 실행 미확인 | Test Runner/Batch Script |
| 두 Editor Join/Leave | 사용자 실기 통과 | 자동/장시간 반복은 후속 |
| 원격 선택/해제 | 사용자 실기 통과 | 수천 Object 성능은 미측정 |
| Frame/Go to Camera | 사용자 실기 통과 | Orthographic 세부 행렬은 별도 기록 없음 |
| Assembly Reload | 서버 재시작/자동 재접속 실기 통과 | Script Recompile 자체는 명시적 결과 없음 |
| Presence Scene Dirty/Undo | EditMode Source 추가, 실행 미확인 | Unity Test Runner에서 실행 |
| 잘못된 입력/ID 충돌 UI | 서버 자동 검증만 통과 | Unity 수동 오류 표시 확인 |
| Presence 성능 | Rate/Threshold 구현, 미측정 | TX 빈도와 Profiler 관측 |
| Prefab/Additive/Scene 이동 | 미검증 | Object ID 행렬 확장 |
| LAN/Docker | 미니 PC Docker 연결 통과 | 주소/OS/RTT 세부값은 기록 없음 |
| WSS/Reverse Proxy | 미검증 | 실제 Proxy/TLS 환경 시험 |

## 발견한 제한과 대응

**원래 계획:** 모든 선택 GameObject를 다른 Editor에서 강조한다.

**발견한 예외:** 저장되지 않은 Object에는 Editor 간 공유 가능한 안정 `GlobalObjectId`가 없다.

**영향:** 새 Object는 이름만 보이고 Frame/강조할 수 없다.

**선택한 대응:** Null/임시 ID를 전송하지 않고 명시적으로 기능을 비활성화한다.

**검토한 대안:** Hierarchy Path, Instance ID, Scene에 Metadata Component 자동 삽입.

**남은 한계:** 변경된 Roadmap의 Phase 4 생성 동기화 전에는 새 Object Presence가 제한된다.

**원래 계획으로 되돌릴 수 있는 조건:** Server 승인 협업 UUID를 가진 생성 Operation이 구현될 때.

실제 Unity를 실행하지 못했으므로 Unity 6.3 Runtime 결함을 발견했다고 주장하지 않는다. 사용 API는 Unity 공식 Scripting API의 `GlobalObjectId`, `EditorSceneManager`, `SceneView`, `Handles` 계약에 맞춰 작성했다.

## 기술적 부채와 남은 문제

- Phase 1 핵심 Compile/Editor Lifecycle은 사용자 환경에서 통과했지만 EditMode 자동 테스트 결과 파일은 아직 없다.
- Presence Registry는 메모리 전용이며 Server 재시작 뒤 Client 재접속이 필요하다.
- 두 프로젝트가 `UserSettings`를 복제하면 같은 사용자 ID가 서로를 대체한다.
- Remote Follow Mode는 해제 UX가 정해지지 않아 제외했다.
- Object Resolve Cache는 현재 소규모 팀 기준이며 긴 세션의 ID 교체/Scene 전환 후 정리 정책을 더 다듬을 수 있다.
- 원격 Selection Frame은 로컬 Selection을 바꾸므로 그 결과가 본인의 Presence로 전송된다.
- Client 수신 안전 한도는 1 MiB 상수이며 대규모 Session Snapshot Chunking이 없다.
- 인증 Token은 로컬 평문이고 역할/권한/초대가 없다.
- 현재 공유 Bearer Token은 개별 사용자 ID를 증명하지 않으므로, Token을 아는 Client는 알려진 사용자 ID로 재접속을 시도할 수 있다. 공개 배포 전 사용자별 인증 Claim과 Server-side ID Binding이 필요하다.

## 요구사항에서 변경한 내용

- 서버/Transport/UI 선택은 Phase 0의 Node + 표준 WebSocket + UI Toolkit을 유지했다. Phase 1에서 이를 바꿀 실측 근거가 없었다.
- Protocol Version은 2로 올리지 않고 기능 협상으로 v1을 확장했다. 기존 Envelope/메시지가 호환되기 때문이다.
- 팀원 Follow 대신 Frame Selection과 단발 Go to Camera를 제공했다. 상세 판단은 `docs/decisions/phase-1.md`에 기록했다.
- Presence 영속 DB는 추가하지 않았다. Scene 정확성과 무관한 일시 상태이며 재접속으로 재구성 가능하다.

## Phase 1 보고 시점의 미구현 범위와 현재 상태

Phase 1 보고 시점에는 Transform 동기화, 오브젝트 Lock/Lease, Operation ID/Revision과 Snapshot이 없었다. 이 가운데 저장 Baseline Object의 Transform/Lock/메모리 Snapshot은 현재 Phase 2 `0.3.0` Source에 구현됐다. 생성·삭제·이름·활성·부모·형제 순서, 누락 Operation 복구, 영속 Snapshot/History, Prefab/Additive 완전 지원은 여전히 후속 Phase 범위다.

## 후속 상태

Phase 1 잔여 Server 검증과 Unity 안전 테스트 Source를 보강한 뒤 Phase 2 Transform/Lock Source를 구현했다. Phase 1 성능과 Unity EditMode 실행은 완료된 것으로 표시하지 않으며 `docs/known-issues.md`와 `docs/manual-test-checklist.md`에서 계속 추적한다.
