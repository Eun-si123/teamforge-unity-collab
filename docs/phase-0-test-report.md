# Phase 0 구현·테스트 보고서

- 작성일: 2026-08-02 (Asia/Seoul)
- 저장소 버전: `0.1.0`
- 상태: **서버 Ping/Pong MVP 검증 완료 / Unity Editor 실행 검증 대기**

## 구현한 기능

- Editor 전용 UPM 패키지 `com.eunsung.teamforge`
- UI Toolkit Collaboration 창
- 사용자 입력 Server Address + 상대 WebSocket 경로 조합
- `http → ws`, `https → wss` 변환과 URL 검증
- 사용자 이름, Project ID, Session ID, 선택적 Bearer Token
- Connect Timeout, 수동 Disconnect, 자동 재접속, 최대 Backoff, 로그 수준
- WebSocket Hello/Hello Ack, Ping/Pong, 단조 시계 RTT
- Background I/O → Unity Main Thread Dispatch Queue
- 연결 Epoch를 이용한 오래된 Callback 무효화
- Assembly Reload 전 Transport 종료 및 재연결 의도 복원
- 로컬 `UserSettings` 설정 저장
- Server Health Check, 입력 검증, 메시지 크기/빈도/연결 수 제한, 선택적 인증
- Dockerfile/Compose 배포 예시
- Server 자동 테스트, Unity EditMode 테스트 소스, Object ID Probe, 저장소 정적 검증

## 실제 생성·변경 파일

총 74개 파일을 정적 검증했다. 핵심 파일 묶음은 다음과 같다.

| 영역 | 위치 |
| --- | --- |
| Unity Package | `unity-package/com.eunsung.teamforge/` |
| Unity 연결 상태 머신 | `Editor/Connection/TeamForgeConnectionService.cs` |
| Unity Transport | `Editor/Transport/ClientWebSocketTransport.cs` |
| Unity UI | `Editor/UI/TeamForgeWindow.cs` |
| Unity 테스트 | `Tests/Editor/` |
| Node Session Host | `server/src/` |
| Server 테스트 | `server/test/server.test.mjs` |
| Unity 샘플 프로젝트 | `unity-project/` |
| Protocol/결정/호환성 문서 | `docs/` |
| 검증 스크립트 | `scripts/` |

Unity Asset GUID 안정성을 위해 패키지의 C#·asmdef·폴더 `.meta` 파일도 포함했다.

## 사용한 버전

- 목표 Unity: Unity 6.3 LTS (`6000.3.x`)
- 샘플 기준: Unity `6000.3.21f1`, changeset `c02631ffc030`
- 실제 Unity 실행: **미실행 — 작업 환경에 Unity Editor 없음**
- Node.js: `v24.14.0`
- npm: `11.9.0`
- `ws`: `8.21.1`, `package-lock.json` 고정
- Docker: **미실행 — 작업 환경에 Docker 없음**

## 실행한 주요 명령과 결과

| 명령 | 결과 |
| --- | --- |
| `npm --prefix server --cache /tmp/teamforge-npm-cache install` | 성공, dependency 1개 설치·lockfile 생성 |
| `npm --prefix server --cache /tmp/teamforge-npm-cache ci` | 성공, lockfile만으로 Clean Install 재현 |
| `npm --prefix server test` | 성공, 7/7 pass |
| `npm --prefix server run smoke` | 성공, Health/Hello/Pong 모두 true, 최종 관측 RTT 0.39ms |
| `npm test` | 성공, Server 7/7 + Repository validation |
| `npm --prefix server run check` | 성공, Server entry/module syntax pass |
| `npm --prefix server --cache /tmp/teamforge-npm-cache audit --omit=dev` | 성공, 알려진 취약점 0개 |
| `node scripts/validate-repository.mjs` | 성공, 74 files / 13 C# sources / protocol v1 |

npm이 이 실행 환경의 기본 `/root/.npm`을 만들 수 없어 첫 조회가 실패했다. 프로젝트나 사용자 환경에 값을 고정하지 않고, 이후 명령에서 쓰기 가능한 작업 전용 Cache `/tmp/teamforge-npm-cache`를 지정해 해결했다. 코드 결과에는 영향을 주지 않는다.

## 자동 테스트 결과

```text
tests 7
pass 7
fail 0
duration_ms 177.482281
```

통과한 Server 시나리오:

1. Health가 Protocol Version과 현재 연결 수를 반환
2. Hello 승인 후 상관관계가 맞는 Pong 반환
3. Hello 이전 Ping을 명시적으로 거부
4. Protocol Version 불일치를 오류 처리하고 연결 종료
5. 선택적 Bearer Token이 미인증 Upgrade를 401로 거부하고 올바른 Token은 허용
6. Health/WebSocket 경로를 배포 환경에 맞게 변경하고 기본 경로를 거부
7. 연결별 메시지 빈도 제한을 넘으면 오류를 전달하고 연결 종료

스모크 테스트는 실제 Ephemeral Port에 HTTP/WebSocket Server를 열어 Health → Hello → Ping → Pong → Close를 한 프로세스 흐름으로 확인했다.

## Unity 테스트 준비 상태

작성한 EditMode 테스트:

- HTTP/HTTPS/WS Base URL과 상대 Path의 WS/WSS 변환
- 잘못된 Scheme, 상대 주소, URL 내 Credential/Query 거부
- `JsonUtility` Protocol DTO Round-trip
- Protocol Version 불일치 거부
- 사용자/Project/Session 입력 검증
- 저장된 Scene Object의 `GlobalObjectId`가 부모 변경·Scene Reload 뒤 유지되는지 검증
- 복제 Object가 원본과 다른 `GlobalObjectId`를 받는지 검증

Object ID Probe는 `Assets/__TeamForgePhase0Tests`에 고유 이름의 임시 Scene을 Additive로 만들고 `finally`에서 Scene과 폴더를 정리한다. 기존 열린 Scene을 교체하거나 저장하지 않는다.

Unity가 설치된 환경에서 실행할 명령:

```bash
UNITY_EDITOR=/absolute/path/to/Unity ./scripts/run-unity-tests.sh
```

수동 절차는 `docs/manual-test-checklist.md`에 체크리스트로 분리했다.

## 성공한 시나리오

- 사용자 환경 IP/도메인 없이 Localhost 기본값으로 서버 기동
- Port/Path/Auth/Size/Rate/Connection Limit 환경 설정
- Health Check
- 인증 없음/있음의 WebSocket Upgrade
- Hello와 Protocol Version Gate
- Ping/Pong Request Correlation
- 잘못된 순서와 Version 오류 처리
- Server 종료 후 테스트 자원 정리
- UPM/asmdef/manifest JSON 파싱
- Unity 6000.3 Version 범위와 샘플 Patch 기록 확인
- Server/Unity Protocol 상수 일치 확인
- 모든 C# Source의 기본 Lexical/Delimiter 정적 검사
- Package Source/asmdef `.meta` 존재 확인

## 실패 또는 아직 검증하지 못한 시나리오

| 시나리오 | 상태/이유 | 다음 검증 |
| --- | --- | --- |
| Unity Package 실제 Compile | 미실행, Unity Editor 없음 | 6000.3.21f1에서 샘플 열기 |
| Collaboration 창 Render | 미실행 | UI Toolkit 창 열기·Dock·입력·Theme 확인 |
| Unity Client → Node Server Ping | 미실행 | 같은 PC에서 Connect/Ping/Disconnect |
| Assembly Reload 후 재연결 | 미실행 | 연결 중 C# 수정·Recompile |
| Unity 재시작 | Phase 0은 의도적 자동 Resume 미지원 | 정책 확정 후 별도 구현/테스트 |
| 두 PC / LAN / WSS / Reverse Proxy | 미실행 | Windows 2대 + Ubuntu Server 행렬 |
| Docker Image Build/Health | 미실행, Docker 없음 | Ubuntu Server에서 `docker compose up --build` |
| GlobalObjectId Probe | 테스트 소스 작성, 미실행 | Unity EditMode Test Runner |
| Scene Presence/Transform/Revision | 범위 밖, 아직 미구현 | Phase 1/2/4 |

## 발견한 Unity 제한과 임시 대응

실제 Editor를 실행하지 못했으므로 런타임 제한을 발견했다고 주장하지 않는다. 공식 Unity 6.3 문서에서 확인한 설계 경계는 다음과 같다.

- `ScriptableSingleton` + `FilePath`는 Assembly Reload와 Editor Session 사이 직렬화 상태 저장을 지원한다.
- `AssemblyReloadEvents`는 Reload 전/후 경계를 제공한다.
- `GlobalObjectId`는 저장 Scene Object에 Scene Asset GUID를 포함하지만, 새로 생성되어 아직 공유되지 않은 Object의 공통 Network ID 문제를 단독으로 해결하지 않는다.
- Unity 6.3 기본 API Compatibility Level은 .NET Standard 2.1이다.

따라서 Phase 0은 Scene API를 건드리지 않고, Reload 때 Socket을 유지하려 하지 않으며, Transport를 닫고 연결 의도만 복원한다.

## 요구사항에서 조정한 내용

### 서버 기술

**원래 계획:** ASP.NET Core/SignalR을 우선 후보로 기술 검증.

**발견한 예외:** 작업 환경에 .NET SDK가 없고 Node 24만 있어 ASP.NET 구현은 빌드·실행 근거를 만들 수 없었다.

**영향:** Server 구현 언어가 C#이 아닌 JavaScript가 됨. Wire Protocol과 Unity Client는 영향 없음.

**선택한 대응:** 표준 WebSocket을 유지한 Node+`ws` 서버를 실제 테스트 가능한 첫 구현으로 선택.

**검토한 대안:** .NET 미검증 Source만 작성, 직접 WebSocket Frame 구현, 외부 Unity DLL.

**남은 한계:** 향후 Operation/DB Model에서 ASP.NET의 장점이 커질 수 있음.

**원래 계획으로 되돌릴 수 있는 조건:** 같은 Protocol Contract로 ASP.NET Host 테스트가 더 높은 유지보수성/운영성을 입증할 때 Server 폴더만 교체 가능.

### Unity 실제 빌드

**원래 계획:** Unity 6.3 LTS에서 Package Compile, EditMode Test, Editor 수동 연결까지 수행.

**발견한 예외:** 설치된 Unity 실행 파일과 C# Compiler가 없으며 이 환경에서 Unity License/대용량 Editor 설치를 수행할 수 없음.

**영향:** Unity 측 결과는 Source+정적 검증 단계이며, Phase 0 전체 완료 판정은 보류.

**선택한 대응:** 정확한 `ProjectVersion.txt`, 로컬 UPM 참조, Batch Test Script, EditMode Test와 Object ID Probe를 제공하고 미실행 상태를 명시.

**검토한 대안:** Unity가 실행된 것처럼 추정 보고, 다른 Unity Version 사용.

**남은 한계:** API Signature/Editor Lifecycle의 실제 Compile·동작 여부는 확인 전.

**원래 계획으로 되돌릴 수 있는 조건:** Unity 6000.3.21f1이 설치된 Windows/Linux/macOS 환경에서 준비된 명령을 실행하면 됨.

## 기술적 부채

- Connection Profile은 단일 설정으로 시작했으며 아직 목록형 Profile이 없다.
- 인증 Token은 로컬 평문 저장이다. 외부 공개 전 OS Credential Store 경계가 필요하다.
- JSON Codec은 작은 Phase 0 DTO에 맞춰져 있으며 복잡한 Operation Union에는 재검토가 필요하다.
- 재접속 뒤 Revision 복구는 아직 없다. 영속 복구는 변경된 Roadmap의 Phase 5 Protocol에서 다룬다.
- Client 수신 안전 한도 1 MiB는 현재 코드 상수다. Snapshot 도입 전 설정/Chunking 정책이 필요하다.
- CI Matrix와 실제 WSS Certificate/Proxy Test가 없다.

## 아직 구현하지 않은 기능

Presence, 원격 선택 표시, Transform, 생성/삭제/이름/부모, Lock/Lease, Operation Revision, Snapshot, 누락 Operation 복구, Scene 저장 정책, History는 아직 구현하지 않았다. Phase 0 Client는 Scene Object를 읽거나 수정하지 않는다.

## 다음 단계

가장 먼저 Unity 6000.3.21f1 PC에서 Compile → EditMode Test → Node Server 연결 → Script Recompile 복구를 실행해야 한다. 이 Gate가 통과하면 Phase 1 Presence를 시작하고, GlobalObjectId Probe 결과를 바탕으로 Phase 2 Object Registry/Transform Operation 설계를 확정한다.
