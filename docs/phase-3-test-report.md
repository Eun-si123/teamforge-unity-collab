# Phase 3 Test Report

- 판정: **구현 및 자동 검증 완료, Unity 6.3/LAN 실기 검증 대기**
- 제품 버전: `0.4.0`
- Realtime Protocol: `1`
- Project Transfer Protocol: `1`
- Manifest Schema: `1`
- 목표 Unity: `6000.3.x`; Sample 기록 `6000.3.21f1`
- 보고 기준일: 2026-08-03 (Asia/Seoul)

## Gate와 상태

Phase 2는 구현·자동 검증 완료, Unity 6.3 실기 검증 대기 상태를 유지한다. 사용자가 Phase 3 착수에 한해서만 1회성 Gate 예외를 승인했으며 Phase 2 수동 체크리스트는 삭제하거나 통과 처리하지 않았다. 이 예외는 Phase 4 Gate를 해제하지 않는다.

Phase 3은 Source 구현과 현재 환경에서 가능한 Node/정적 자동 검증을 완료했다. Unity Compile/EditMode, 실제 두 PC Direct 전송, Docker/Reverse Proxy는 실행 환경에 도구가 없어 통과로 기록하지 않는다. Phase 4는 시작하지 않았다.

## 실행 환경

| 항목 | 결과 |
| --- | --- |
| OS/시간대 | Linux Container / Asia/Seoul |
| Node.js | `v24.14.0` |
| npm | `11.9.0` |
| 선언 최소 Node.js | 20 |
| Unity Editor | 설치되지 않음 |
| .NET SDK/C# Compiler | 설치되지 않음 |
| Docker | 설치되지 않음 |
| Git | 현재 작업 디렉터리가 Git 저장소가 아님; 최근 Commit/Git diff 없음 |
| 대체 변경 기준 | `Unity-TeamForge-Phase2-v0.3.0.zip`, SHA-256 `a16b73bfe393a7526f4abe7b04514f0754b3c36e09df5ec21fee19dab8b3dbb4` |

## 실행한 명령과 결과

| 명령 | 실제 결과 |
| --- | --- |
| `npm --prefix server run check` | 성공 |
| `npm --prefix server test` | **37/37 통과**, 실패/취소/Skip 0 |
| `npm --prefix server run smoke` | Health, Ping/Pong, Presence, Transform, Lock, Project Snapshot 성공 |
| `npm --prefix server audit --omit=dev` | 취약점 0 |
| `npm --prefix project-peer run check` | **31개 Module** 구문 검사 성공 |
| `npm --prefix project-peer test` | **35/35 통과**, 실패/취소/Skip 0 |
| `npm --prefix project-peer run smoke` | Descriptor/Manifest/3 Chunk Direct HTTP 성공, `serverRelayUsed=false` |
| `npm --prefix project-peer audit --omit=dev` | 취약점 0 |
| Server/Project Peer `npm ci --ignore-scripts` | Lockfile 기준 각각 1 Dependency Clean Install 성공 |
| Clean Install 뒤 `npm test && npm run smoke` | 전체 재통과 |
| `node scripts/validate-repository.mjs` | **158 files / 28 C# sources / Protocol v1** 검증 성공 |
| Phase 3 ZIP `unzip -t` | 189 Entry 압축 무결성 성공 |
| Phase 3 ZIP 새 경로 추출→양쪽 `npm ci`→Root Test/Smoke | 전체 재현 성공 |
| `UNITY_EDITOR=... ./scripts/run-unity-tests.sh` | 미실행: Unity 없음 |
| `docker compose build` | 미실행: Docker 없음 |

npm은 실행 환경에 남아 있는 `http-proxy` 설정 이름의 향후 폐기 경고를 출력했으나 설치·Test·Audit 결과에는 영향을 주지 않았다.

## 자동 시나리오 추적

| 요구 시나리오 | 자동 근거 |
| --- | --- |
| 같은 Project ID + 다른 UUID 거부 | Server 전역 Project Identity 충돌 Test |
| Session 격리 | Baseline은 Project 전역, Endpoint/Token은 Session별 격리 Test; Direct Session Header 거부 Test |
| Manifest 결정성/File 변경 Hash | 결정적 정렬·Hash 민감도·1 MiB Chunk 재조립 Test |
| 잘못된 Chunk/누락/Resume | invalid Chunk 폐기 후 다른 Seed 재요청, 검증 Chunk 재사용, Content 중복 제거 Test |
| 여러 Seed 병렬/Fallback | 두 실제 Direct Seed 통합, 병렬 분배, 느림·실패 Peer 동적 후순위, Worker settle Test |
| 오래된 Owner Downgrade 차단 | Server stale Owner 거부 및 최신 Owner Rank 0 Test; Source exact-current precondition Test |
| 최신 Owner Preferred Seed | Owner Proof 검증 및 Rank 0이 Replica Rank 1보다 우선하는 Server Test |
| Path/Symlink/제외 정책 | traversal/absolute/control/NFC/Windows path, Symlink, case collision, 외부 Local Package, Secret/Generated 제외 Test |
| 기존 Project/Active 보존 | 새 Staging/불변 Active, 실패 Pointer 보존, 기존 Active 덮어쓰기 거부 Test |
| Publish 취소 안전 | Draft 재시도 가능, `published.json` 미승격, Seed 선택 거부 Test |
| Server 승인 뒤 Source 기록 복구 | 동일 승인 Revision만 복구하는 `repair-source-descriptor` Test |
| Server Payload 미저장 | 모든 `server/src`에서 File Write API 금지 정적 검증, Project Payload Field 거부 Test, Direct Smoke `serverRelayUsed=false` |
| Server 재시작 Metadata 복구 | 장시간 Seed 1/2/4/8/10초 제한 Backoff, 새 Connection Owner Proof, 자동 재광고 E2E |
| Phase 0~2 회귀 | Server 37개 중 기존 23개 Connection/Presence/Transform/Lock Test와 Realtime Smoke 재통과 |

Project Peer의 실제 `createTeamForgeServer` E2E는 Baseline Publish/Announce 승인, Revision 1→2, 최신 승인 Pointer 선택, Sidecar Presence 인원 0, Server 재시작 뒤 Registry/Peer 자동 복구를 확인했다.

## Unity Source 검증

- Unity Package Product `0.4.0`, Unity 범위 `6000.3`, Realtime `1`, Transfer `1`, Manifest `1` 정합성
- C# Source 28개 Delimiter/중복 Public Field 정적 검사
- `.cs`/`.asmdef`의 `.meta` 존재와 GUID 중복 없음
- Server/Unity/Project Peer DTO 및 Launch Settings 필드 계약 검증
- Unity Test Source: 전체 NUnit Test/TestCase Attribute 60개, 그중 Phase 3 Project Test Source 27개
- Instance ID 기반 Cross-editor 식별 금지 유지

이 수치는 Unity Test Runner 실행 결과가 아니다. 특히 Unity Package Compile, UI Toolkit Window, Assembly Reload, 실제 File Dialog/Clipboard와 Ed25519 최종 Sidecar 경계를 Unity에서 확인하지 못했다.

## P2P와 Server 저장 근거

Project Payload 경로는 `Project Peer ↔ Project Peer` Direct HTTP뿐이다. Server가 받는 Project 메시지는 UUID/Revision/Hash/공개키/서명/Endpoint/일회 Token/Chunk 수 같은 작은 Metadata로 제한되며 Manifest 본문, File 목록, Chunk Byte, Archive/Payload Field는 거부한다.

저장소 Validator는 모든 `server/src/*.mjs`의 `node:fs` Import와 `writeFile`, `appendFile`, `createWriteStream` 호출을 실패 조건으로 검사한다. Direct Smoke는 실제 Chunk를 Peer HTTP로 읽고 `serverRelayUsed=false`를 반환했다. 따라서 현재 Server 구현은 Project Payload를 Disk나 RAM Relay로 저장하는 코드 경로가 없다. 단, Server RAM에는 허용된 작은 Coordinator Metadata가 존재한다.

## 구현 중 발견하고 수정한 통합 문제

- Sidecar Descriptor에서 `realtimeProtocolVersion` 누락 시 실제 Server가 거부하던 계약 불일치
- Sidecar가 Presence 참가자로 보이던 Capability 오염
- Publish/Announce가 Server Ack 전에 성공으로 보일 수 있던 비동기 경계
- 취소된 Draft가 재시작 뒤 Seed 후보가 될 수 있던 승인 상태 모호성
- Server Ack 뒤 Source Descriptor Compare-and-swap 실패 복구 부재
- 손상 Chunk가 Inventory 수에는 포함될 수 있던 검증 누락
- 무제한 전송이 Socket Flush 전에 동시 요청 Slot을 반납하던 제한 오류
- 병렬 Worker 하나 실패 뒤 다른 Worker가 Progress/Write를 계속할 수 있던 Race
- Coordinator 재시작 뒤 장시간 Seed가 자동 재광고하지 않던 복구 공백
- Windows 예약명, ADS Colon, Trailing Dot/Space Path 차단 누락

수정 뒤 Clean Install과 전체 Test/Smoke를 다시 실행했다.

## 미실행 및 남은 문제

| 항목 | 상태/영향 | 다음 검증 |
| --- | --- | --- |
| Unity `6000.3.21f1` Compile/EditMode | 미실행 | Console Error 0, Test Runner XML |
| 두 PC Project Bootstrap | 미실행 | 실제 LAN/VPN에서 Publish→Invite→Sync→Unity Hub Open |
| Phase 2 Unity Transform/Lock | 계속 미완료 | 기존 Phase 2 체크리스트 결과만 별도 반영 |
| Docker/Reverse Proxy/WSS | 미실행 | Mini PC Compose, Health/WS Path, TLS Upgrade |
| 대형 Project/장시간 성능 | 미측정 | File/Chunk 수, Throughput, Editor Import 시간, Disk 증가 측정 |
| Direct TLS/NAT Traversal | 미구현 | 현재 신뢰 LAN/VPN; HTTPS/QUIC/WebRTC 검토 |
| Unity Invite 서명 검증 | 구조/SPKI/Key ID/Signature 길이만 확인 | Project Peer가 실제 Ed25519 검증; 향후 Unity 호환 검증기 |
| Owner Key Rotation/Transfer | 의도적으로 Fail-closed | 기존 Owner 이중 서명 전환 Protocol 필요 |
| 승인 Publisher 독립 Workflow | Server 계약은 검증하나 CLI는 Owner 환경에서 Authorization 생성 | 제한·만료 가능한 Authorization Export/Import 필요 |
| 영속 Server Trust Anchor | Server 재시작 최초 광고는 TOFU | Phase 5 영속 서명 Metadata/Admin Pin |
| Chunk/이전 Active 자동 정리 | 미구현 | 보존 정책과 사용자 승인 Cleanup 필요 |

전체 제한은 [Known Issues](known-issues.md), 실제 절차는 [Phase 3 Manual Test Checklist](phase-3-manual-test-checklist.md)에 유지한다.

## 서브 에이전트 사용과 통합

- Server/Protocol: `server/**` Coordinator·보안·동시성 구현 및 Test
- Unity: `unity-package/**` DTO·Registry·UI·EditMode Test Source
- Project Peer/Release: `project-peer/**` Manifest·Chunk·Direct Transfer·Swarm·Activation·E2E
- Lead: 공통 계약, 파일 경계, 실제 Server↔Peer 통합 검토, Root Validator, 전체 Clean Install/Test/Smoke, 문서와 배포 Archive

Lead 검토에서 위 통합 문제를 재현·수정 요청했고, 각 결과를 독립적으로 다시 실행했다. 세 작업 영역은 공통 Source 파일을 동시에 수정하지 않았으며 최종 Root Test에서 함께 검증했다.

## 다음 Gate

Phase 3 구현과 자동 검증 결과를 먼저 보고한다. 수동 미확인 항목을 완료로 표시하지 않으며, Phase 2 실기 대기 상태도 유지한다. **Phase 4 Hierarchy Synchronization은 사용자의 새 명시 승인 전에는 시작하지 않는다.**
