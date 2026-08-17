# Phase 3 v0.4.1 Test Report

## 판정

- Source/Node 자동 검증: 통과
- Unity `6000.3.21f1` Compile/EditMode: 미실행(Unity Editor 없음)
- Docker Compose/Image Build: 미실행(Docker CLI 없음)
- v0.4.1 실제 Windows/Tailscale 두 PC E2E: 미실행
- Phase 4 Gate: 닫힘

## 환경

| 항목 | 값 |
| --- | --- |
| 날짜/Timezone | 2026-08-04 / Asia/Seoul |
| OS | Ubuntu 24.04.3 LTS, Linux 6.12.13 x86_64 |
| Node | v24.14.0 |
| npm | 11.9.0 |
| 사용자 실제 Node 기준 | v24.18.1; 이번 자동 실행 Runtime과 다름 |
| 목표 Unity | 6000.3.21f1 |
| 제품 | 0.4.1 |
| Realtime/Transfer/Manifest | 1 / 1 / 1 |
| Git | 저장소 아님; `git status`, `git log` exit 128 |

## 자동 테스트 결과

| 영역 | 명령 | Pass | Fail | Skip | 결과 |
| --- | --- | ---: | ---: | ---: | --- |
| Server | `cd server && npm test` | 37 | 0 | 0 | 통과 |
| Project Peer | `cd project-peer && npm test` | 47 | 0 | 0 | 통과 |
| Server Syntax | `cd server && npm run check` | 4 modules | 0 | 0 | 통과 |
| Project Peer Syntax | `cd project-peer && npm run check` | 31 modules | 0 | 0 | 통과 |
| Server Smoke | `cd server && npm run smoke` | 1 flow | 0 | 0 | Ping/Presence/Transform/Lock/Project Snapshot 통과 |
| Project Peer Smoke | `cd project-peer && npm run smoke` | 1 flow | 0 | 0 | Direct Descriptor/Manifest/Inventory/Payload, `serverRelayUsed=false` |
| Root Integration | `npm test` | Server 37 + Peer 47 + Validator | 0 | 0 | 통과 |
| Repository Validator | `npm run validate` | 165 files / 29 C# sources | 0 | 0 | Protocol v1 통과 |
| Server Audit | `npm audit --omit=dev` | 0 vulnerabilities | 0 | 0 | 통과 |
| Project Peer Audit | `npm audit --omit=dev` | 0 vulnerabilities | 0 | 0 | 통과 |

Root `npm test`는 Server/Peer/Repository Validator를 한 번 더 실행해 모두 통과했다. Release ZIP fresh extract 결과는 ZIP 생성 뒤 이 보고서에 추가한다.

## 핵심 v0.4.1 회귀 근거

### Embedded Package

- direct/unlisted `Packages/com.example.embedded/package.json`, Editor/Runtime/`.meta` 포함
- Embedded File 변경 시 File/Chunk/Manifest Hash 변경
- Package 삭제 시 다음 Revision에서 제거
- Project 내부 `file:` Package 포함 및 `kind: package`
- Root 밖/절대/UNC/Drive-relative/Traversal `file:` Package 거부
- 중간 Symlink/Junction 탈출 거부
- missing `packages-lock.json` Publish/Activation 거부
- Owner Identity JSON 거부와 Token 이름 제외
- 독립 Embedded Coverage 검사에서 package.json 누락 시 `embedded_package_missing_from_manifest`
- 실제 저장소 `unity-package/com.eunsung.teamforge`를 Source의 Embedded Package로 복사한 Publish→Sync→Active 통과, Active package.json name/version `com.eunsung.teamforge`/`0.4.1` 확인
- Sync Active에 Scene/Cube 대응 Fixture가 있고 `Library`, `UserSettings`, `.env`가 없음

### Direct Transfer

- 실제 HTTP Server 429가 `Retry-After`를 보내며 단일 Seed가 Cooldown 뒤 완료
- 408/425/429/500/502/503/504 Client 일시 오류 분류
- 인위적 429/503/ECONNRESET/Timeout 제한 재시도
- Metadata descriptor/inventory 일시 오류 재시도
- Timeout Seed에서 다른 Seed로 전환
- 150개 이상 고유 64 KiB Chunk, 단일 Rate-Limited HTTP Seed, 병렬도 12 완료
- Process 종료 등가 실패 뒤 같은 ChunkStore Resume, 기존 3개 검증 Chunk 요청 0회
- 손상 Chunk 폐기 뒤 다른 Peer 요청
- 모든 Peer 영구 오류에서 안전 실패, 같은 Peer+Chunk 재시도 0회
- Failure 뒤 Worker settle, 반환 뒤 Write/Progress 0회
- 진단/Error details에서 Bearer/Private Key/raw body/Endpoint query Secret 비노출
- 실패 Staging과 기존 Active Pointer 불변 Test 통과

### Phase 0~2 회귀

Server 37개 Test와 Smoke가 Legacy Hello/Ping/Pong, Presence, Transform Snapshot/Revision, Lock/Lease, Disconnect/Heartbeat, Project Capability 격리를 통과했다. Unity Phase 2 실기 Gate는 기존대로 미완료다.

## 실행 중 발견하고 수정한 실패

### npm ci 환경 실패

첫 plain `npm ci`는 이 Sandbox의 기본 npm cache `/root/.npm`을 만들 수 없어 Server/Peer 모두 exit 254였다.

```text
npm error code ENOENT
npm error syscall mkdir
npm error path /root/.npm
npm error enoent ENOENT: no such file or directory, mkdir '/root/.npm'
```

저장소 밖의 분리된 임시 cache를 사용해 재실행했고 두 Package 모두 exit 0이었다.

```bash
env npm_config_cache=/tmp/teamforge-server-npm-cache npm ci
env npm_config_cache=/tmp/teamforge-peer-npm-cache npm ci
```

### Project Peer Smoke Fixture 실패

새 `packages-lock.json` 필수 정책 뒤 Smoke Fixture가 lock 파일을 만들지 않아 `required_packages_lock_missing`으로 한 번 실패했다. Product Source 우회가 아니라 Fixture에 정상 Unity Package Lock JSON을 추가했고 재실행은 통과했다.

### Server Canonical Hash Fixture

Product Version을 0.4.1로 올리면서 Canonical Descriptor Hash가 바뀌었다. 실제 계산값 `da30f0851174a913ba452039205d0fd4490bc453802ccb58d37794f12dfdc2e8`로 Cross-implementation Fixture를 갱신한 뒤 37/37을 통과했다.

### Retry Test의 1 ms 경계 단정

첫 Root 통합 재실행에서 Product 동작은 완료됐지만 인위적 custom sleep 배열이 정확히 37 ms 이상이어야 한다는 Test 단정이 wall-clock 경과 1 ms 때문에 한 번 실패했다. 구조화 진단의 `retryInMilliseconds >= 37` 단정과 실제 HTTP 429 완료 Test는 정상이었다. 취약한 wall-clock 단정만 제거하고 진단 정책/실제 HTTP 근거를 유지한 뒤 Target Test와 Root 전체를 재실행해 47/47 및 통합 통과를 확인했다.

## `(GetStatus)` 조사 결과

다음 검색은 일치 0건이었다.

```bash
rg -n 'UnityEditor\.Progress|\bProgress\s*\.(Start|Report|Finish|Remove|GetStatus)|SearchService|PackageManager\.Events' \
  unity-package/com.eunsung.teamforge/Editor unity-package/com.eunsung.teamforge/Tests
```

TeamForge가 Progress ID를 직접 생성·조회했다는 Source 근거가 없다. Package 제거 A/B와 두 번째 실행 비교는 Unity가 없어 미실행이다. 판정은 `원인 미확정, 기능 영향 없음으로 관측`이다.

## 수동 시험 결과 구분

### 사용자 제공 v0.4.0 결과

Publish, Signed Invite, Direct P2P, Hash 검증, Fingerprint 승인, Active/Scene/Cube, Coordinator/RTT, 중단 Resume가 실제 환경에서 성공했다. 원본 v0.4.0 수집기는 Embedded TeamForge Package를 누락했고, 임시 수집 정책 변경 뒤 142 Chunk/Package/창/연결을 확인했다. 116/142 일시 실패의 현장 원인은 로그 부족으로 미확정이다.

### v0.4.1 수동 결과

없음. [v0.4.1 수동 체크리스트](phase-3-v0.4.1-manual-test-checklist.md)의 모든 항목은 미통과 상태다.

## 미실행 명령과 이유

| 항목 | 명령/방법 | 상태/이유 |
| --- | --- | --- |
| Docker Compose | `cd server && docker compose config` | Docker CLI 없음, exit 127 |
| Docker Image | `cd server && docker build ...` 또는 Compose build | Docker CLI 없음 |
| Unity Compile | `Unity.exe -batchmode -nographics -projectPath <active> -quit ...` | Unity 실행 파일 없음 |
| Unity EditMode | `Unity.exe -runTests -testPlatform EditMode ...` | Unity 실행 파일 없음 |
| TeamForge Menu 실제 등록 | Active를 Unity로 열어 Window Menu 실행 | Unity 없음; Test Source만 추가 |
| Library/UserSettings 없는 첫 Import | 새 Active Unity 첫 실행 | Node 사전 상태만 검증, Unity 실행 미실행 |
| GetStatus Package 제거 A/B | 두 Active 일회용 복사본 첫/둘째 실행 비교 | Unity 없음 |
| Windows Junction | 외부 Junction Package 탈출 | Linux symlink/junction 등가 자동 회귀 통과, Windows 실기 미실행 |
| Tailscale v0.4.1 | 사용자 Coordinator/Seed Endpoint 실제 재시험 | 외부 사용자 환경 접근/승인 없음 |

## Release ZIP

ZIP 이름은 `Unity-TeamForge-Phase3-v0.4.1.zip`이다. 최종 SHA-256, Archive 무결성, fresh extract Test 결과는 ZIP 생성 후 기록한다.

## 최종 Gate

자동 Test에서 치명적·높음 등급 회귀는 발견되지 않았다. 하지만 Unity Compile/Menu/Coordinator와 실제 v0.4.1 Resume가 미실행이므로 Phase 3 v0.4.1 Release Gate는 아직 닫혀 있고 Phase 4를 시작하지 않는다.


## 2026-08-04 Unity field hotfix addendum

- User field reproduction: Package Test Assembly enabled → CS0104 `PackageInfo` ambiguity.
- User field retest after qualification: additional compile errors not observed; final clean candidate Unity Batch/EditMode remains NOT RUN here.
- Repository validator: PASS at 176 files / 29 C# / protocol v1.
- `.mjs` syntax: 42/42 PASS.
- Dependency-independent Project Peer tests: 38/38 PASS (manifest/path 9, direct transfer 11, swarm 13, transport/process 5).
- Real modified Embedded Package manifest coverage: PASS, 79/79 package source paths included.
- Full root npm gate: NOT RUN because this container's npm mirror returned 404 for locked `ws@8.21.1`, and direct public registry access was unavailable.


### Fresh-extract hotfix candidate evidence

- Candidate source inventory: 176 files, 29 C# sources, 42 `.mjs`, protocol v1.
- Source-to-fresh-extract per-file SHA-256 comparison: 176/176 PASS.
- Fresh repository validator: PASS.
- Fresh `.mjs` syntax: 42/42 PASS.
- Fresh dependency-independent suites: 38/38 PASS.
- Locked `npm ci` default route: environment 404 for `ws@8.21.1`.
- Explicit public-registry attempt did not obtain a response within the execution limit and was terminated; no dependency or lockfile was changed.
- Full root test/smoke/audit and Unity Batch/EditMode remain unclaimed until the bundled Windows validation script passes.
