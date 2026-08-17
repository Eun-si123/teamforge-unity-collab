# Phase 3 v0.4.1 안정화 Patch 보고서

## 결론

v0.4.1 Source 수정과 가능한 Node/정적 자동 검증은 완료됐다. 확정된 Embedded Package 누락은 실제 저장소의 TeamForge Package를 이용한 Publish→Sync→Active 회귀로 수정 근거를 확보했고, Direct Transfer는 실제 HTTP 429/Retry-After, 150개 이상 Chunk, 503/Reset/Timeout, Peer 전환과 Resume 시험을 추가했다.

그러나 이 실행 환경에는 Unity와 Docker가 없어서 새 ZIP의 Unity `6000.3.21f1` Compile/EditMode/Menu/Coordinator 실기와 Docker Build는 실행하지 못했다. 따라서 v0.4.1은 **자동 검증 완료·수동 Release Gate 대기**이며 Phase 4를 시작할 수 없다.

## 확정된 버그

### Embedded Package 누락

v0.4.0 수집기는 `Assets`, `ProjectSettings`, Package manifest/lock, 그리고 `Packages/manifest.json`에 선언된 내부 `file:` Package만 Root로 삼았다. `Packages/com.example.package/package.json` 형태의 direct Embedded Package를 별도로 열거하지 않아 TeamForge 자체가 Manifest 생성 전에 빠졌다.

Manifest/Chunk/Activation 검증은 이미 수집된 File만 검증했으므로 누락을 독립적으로 발견하지 못했고, Package가 없는 상태로도 `Sync Complete`가 가능했다. 전송 또는 Active materialization 단계가 File을 버린 문제는 아니다.

## 원인 가설과 증거 수준

### 116/142 Direct Transfer 실패

정확한 현장 원인은 미확정이다. 당시 실패 로그에 HTTP Status/Attempt가 없어 Rate Limit이라고 단정하지 않는다.

다만 v0.4.0 코드는 Seed의 fixed 1초 120 req/s 제한에 descriptor/manifest/inventory를 포함하고, 기본 병렬도 6에서 첫 오류 뒤 대기 없이 같은 Peer를 즉시 한 번 더 요청했다. 동일 구조를 자동 재현하자 117개 Chunk 검증 뒤 HTTP 429 두 번과 `direct_transfer_unavailable`이 발생했다. 새 Store에서는 concurrency 1도 같은 경계에서 실패했고, 1초 뒤 같은 Store를 Resume하면 concurrency 6으로 완료됐다. 따라서 수동 재시험의 `--concurrency 1` 성공은 병렬도 자체보다 이미 검증된 116 Chunk 재사용으로 남은 요청이 제한 아래가 된 효과일 수 있다.

Rate Limit은 강한 재현 가설이지만 현장 사건의 확정 원인은 아니다. 일시 5xx, Reset, Timeout도 정식 Retry 대상으로 포함했다.

## 실제 수정

### Embedded/Local Package 수집

- `Packages` direct child 중 regular `package.json`이 있는 Package를 dependency 선언과 무관하게 포함
- Project Root 내부의 정규화된 안전한 `file:` Package 포함
- Package 내부 Editor/Runtime/Tests/Documentation/`.meta` 포함
- Package 이름/버전/File/Byte/Chunk Publish Preview 요약
- 수집 결과와 별도의 direct Embedded `package.json` Coverage 검사
- `Packages/manifest.json`/`packages-lock.json`을 Publish와 Activation에서 regular/유효 JSON으로 필수화
- 결정론적 Path 정렬, 대소문자 충돌, 중복 Path/Chunk 방지 유지

### 경로·Secret 방어

- 절대/UNC/Drive-relative/Traversal Local Package 거부
- lexical containment뿐 아니라 realpath containment 및 모든 중간 Symlink/Junction 거부
- 외부 Local Package Fail-Closed 유지
- `.env`, Key/Token 이름, TeamForge Owner Identity JSON 거부/제외
- 내부 Local Package File을 Manifest `kind: package`로 분류

임의 이름의 일반 텍스트에 숨긴 모든 Secret을 탐지하는 DLP Scanner는 아니다. 제품 Token/Owner Key는 계속 Payload Root 밖의 환경 변수/UserSettings/관리 Private Metadata에 둬야 한다.

### Direct Transfer 안정성

- 일시 HTTP: 408, 425, 429, 500, 502, 503, 504
- 일시 Network: Timeout, Reset과 제한된 Fetch/Socket 오류
- `Retry-After` delta/date와 Server의 정밀 millisecond Hint 처리
- 100 ms 시작 지수 Backoff, 최대 5초, 20% Jitter, 초기 포함 최대 4회
- 기본 병렬도 4와 Peer별 10 ms 요청 시작 간격
- 단일 Seed는 일시 오류 한 번으로 즉시 실패하지 않고 Cooldown 뒤 제한 재시도
- 다중 Seed는 다른 사용 가능한 Peer로 새 요청 전환
- 손상 Chunk 폐기, 검증 Chunk 재사용, Failure Staging/Active Pointer 불변 유지
- Chunk Hash Prefix/Peer/Status/Error/Attempt/Wait/Switch/Resume/Remaining만 포함하는 Secret-free 진단

Wire Protocol, Transfer Protocol, Manifest Schema는 모두 `1`을 유지한다. Product Version만 `0.4.1`이며 signed Descriptor는 exact Product Version을 요구한다.

## `(GetStatus)` 조사

TeamForge Editor/Tests C# 전체에서 `UnityEditor.Progress`, `Progress.Start/Report/Finish/Remove/GetStatus`, Search Import 완료 callback 사용은 0건이다. TeamForge가 Progress ID를 직접 만들거나 보존하는 실행 경로가 없어 잘못된 Progress 순서를 수정할 Source 근거가 없다.

Unity Issue Tracker에는 새 Project의 첫 Background Task 종료 뒤 같은 계열 메시지가 발생하는 공개 사례가 있다. 이는 Unity 내부에서도 발생 가능하다는 정황일 뿐 Unity `6000.3.21f1`의 이번 사례 원인을 확정하지 않는다. Package 제거 A/B와 두 번째 실행 비교를 못 했으므로 최종 판정은 **원인 미확정, 기능 영향 없음으로 관측**이다. Console 메시지를 숨기거나 강제로 제거하는 코드는 추가하지 않았다.

## 읽기 전용 병렬 검토

| 역할 | 범위 | 통합에서 발견·반영한 사항 |
| --- | --- | --- |
| Node Path/Security | File Root, traversal, symlink, Secret | 중간 Junction 탈출, traversal, missing lock, Owner Identity JSON, Local Package kind 공백을 Lead가 재현 후 수정 |
| P2P Retry/Rate | Rate window, concurrency, retry/failover | 117 Chunk 429 재현, concurrency 1 해석 오류, Retry-After/진단/상태 보존을 반영 |
| Unity Lifecycle | Progress, reload, Package/Menu Test | Progress API 0건, 원인 미확정 판정, PackageInfo/Assembly/Menu EditMode Source 추가 |

검토자는 저장소 File을 수정하지 않았다. Lead가 모든 변경을 적용하고 전체 Test를 다시 실행했다.

## 남은 기술 부채와 보안 제한

- Direct HTTP는 신뢰된 LAN/Tailscale/VPN 대상이며 자동 TLS/NAT Traversal/Relay가 없다.
- CLI UX는 개발자용이고 Project가 없는 참가자도 Node Sidecar가 필요하다.
- Owner Key Rotation/Ownership Transfer는 자동화되지 않았으며 fail-closed다.
- Coordinator는 RAM Metadata만 유지하며 Project Payload를 저장하거나 Relay하지 않는다.
- Unity 첫 Import `GetStatus` A/B 원인 판정이 남았다.
- Unity/Docker/Windows Junction 실기 및 v0.4.1 두 PC E2E가 남았다.

## Phase 4 시작 가능 여부

**불가.** Embedded Node 회귀와 Retry/Resume 자동 시험은 통과했지만 새 ZIP의 Unity Compile, TeamForge 창, Coordinator Connected/RTT와 실제 Tailscale Resume가 아직 미실행이다. [수동 체크리스트](phase-3-v0.4.1-manual-test-checklist.md)를 완료하고 사용자가 별도로 승인해야 한다.


## 2026-08-04 Unity field hotfix addendum

User manual testing exposed two additional Phase 3 release defects after the original final archive was produced: Unity 6000.3.21f1 CS0104 in `TeamForgeEditorSurfaceTests.cs`, and ambiguous Bootstrap wording after the final Seed sidecar exits. The current working candidate fully qualifies the intended Package Manager API and adds a distinct `BaselineAvailableNoSeed` state plus exact UI/test coverage. See `phase-3-v0.4.1-unity-hotfix-report.md`.
