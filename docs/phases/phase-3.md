# Phase 3 — P2P Project Bootstrap and Swarm Replication

- 상태: v0.4.1 안정화 구현 및 Node 22/24 최종 전체 회귀 완료, Node 20 최종 재실행과 새 ZIP Unity 6.3/LAN 수동 Gate 및 사용자 승인 대기
- 제품 버전: `0.4.1`
- Realtime Protocol: Server `1` / Unity `1` 가산 Capability
- Project Transfer Protocol: `1`
- Manifest Schema: `1`
- 목표 Editor: Unity 6.3 LTS (`6000.3.x`), 우선 검증 Patch `6000.3.21f1`

## 이전 Gate 이력

사용자가 2026-08-03 이번 한 번에 한해 Phase 2 실기 Gate보다 먼저 Phase 3을 시작하도록 승인했고, 이후 제공된 수동 결과로 Phase 1/2 Gate는 통과 상태가 됐다. Phase 2 체크리스트는 당시 개별 관측 범위를 보존한다. 이 이력은 Phase 3 수동 Gate나 Phase 4를 자동 해제하지 않는다.

## 범위

- Project UUID, Baseline Revision, Manifest/File/Chunk Hash와 호환성 Descriptor
- 결정적인 Manifest와 SHA-256 Content-addressed Chunk
- Server의 Session별 Peer Registry, Project ID/UUID 충돌 방지, 검증된 Seed 순위
- Direct Client-to-Client HTTP 전송 구현 하나
- 중단 재개, 기존 Chunk 재사용, 중복 방지, 여러 Seed 병렬 다운로드와 Failover
- 별도 Staging 다운로드, 전체 검증 뒤 새 관리 Active Revision 생성
- Owner/승인 Publisher의 명시적 `Publish New Baseline`
- Owner가 나중에 참가할 때 최신이면 Preferred Seed, 오래됐으면 Downgrade 금지
- 진행률, 남은 Byte, Peer/실패 원인 진단
- 기존 Phase 0~2 Realtime 기능 회귀 유지

## 제외 범위

- Scene Hierarchy 생성/삭제/이름/활성/부모/형제 순서(Phase 4)
- 영속 Operation Log/누락 Revision/Server Project Metadata DB(Phase 5)
- 자동 NAT Traversal, STUN/TURN, QUIC/WebRTC, Server Disk Relay
- 자동 File Watch/자동 Publish, 자동 Script 실행, Unity Hub 자동 실행
- 기존 임의 Unity Project를 제자리 덮어쓰기

## 역할

| 역할 | 책임 | 다른 역할과의 구분 |
| --- | --- | --- |
| Server | 연결, Project/Session Metadata, Peer 발견, Seed 정렬, Signaling | Project Payload를 저장/중계하지 않음 |
| Owner | Project Owner Key와 새 Publisher 승인, Baseline 게시 권한 | Server Operator/Lock Owner/Seed와 별개 |
| Publisher | Owner가 승인한 Key로 새 Baseline에 서명 | 참가 권한이나 Lock 소유권을 뜻하지 않음 |
| Client | Unity Editor 또는 Project가 없을 때 Standalone Bootstrap CLI | 파일 제공 여부와 무관 |
| Peer | Direct Transfer에 참여하며 보유 Chunk를 광고 | 완전 Baseline을 가졌다고 가정하지 않음 |
| Seed | 최신 Descriptor/Manifest/Chunk를 검증받아 제공 가능한 Peer | 최초 참가자와 동일하지 않음 |
| Replica | 최신 Baseline 전체 검증을 완료한 Client | Owner가 아닐 수 있음 |

## 일반 사용자 UX

일반 사용자는 Owner Key ID, 공개키, Project UUID, Manifest Hash, Baseline Revision, Seed Rank를 직접 입력하거나 계산하지 않는다. 해당 값은 Descriptor/Manifest/Coordinator가 자동 생성·검증하고 Diagnostics의 읽기 전용 상세 정보로만 제공한다.

기본 행동은 다음 세 가지다.

1. Server/Project/Session을 담은 초대 정보를 입력하거나 가져오기
2. 예상 크기·Publisher 출처·Script/Package 경고를 보고 Project 다운로드 승인
3. Publisher Fingerprint를 확인하고 활성화 신뢰 승인

Project 최초 명시 Publish에서 Owner Key가 없으면 Sidecar가 자동 생성한다. Private Key는 Project Payload/Manifest/초대/로그에 포함하지 않고 관리 Metadata의 Private 영역에 보관한다. Key 백업은 사용자가 지정한 별도 안전 경로로 명시적으로 수행하며, Key 교체/소유권 이전은 기존 Owner 증명 없이 자동 처리하지 않는다.

## 공통 Version 계약

- Root/Server/Unity Package/Project Peer Package: `0.4.1`
- 기존 UTF-8 JSON WebSocket Envelope: `protocolVersion=1`
- Hello 가산 필드: `supportsProjectTransfer`
- Hello Ack 가산 필드: `projectTransferEnabled`
- Project Payload는 Realtime JSON에 넣지 않는다.
- Direct Transfer HTTP는 `transferProtocolVersion=1`을 사용한다.
- Manifest는 `manifestSchemaVersion=1`을 사용한다.
- 호환 불가능한 Realtime Envelope 변경 때만 기존 Protocol Version을 올린다.

## Coordinator 메시지

모든 메시지는 기존 Envelope를 사용하며 같은 Project ID + Session ID 안에서만 Peer Token/Endpoint를 전달한다.

- `project_peer_announce`: Project UUID, 최신 보유 Revision/Manifest Hash, Descriptor Hash, 호환 Version, 완전/부분 보유, Chunk 수, Direct Endpoint/일회 Peer Token, 서명 증명
- `project_registry_snapshot`: 현재 Project 기준 Metadata와 같은 Session의 정렬된 Peer 목록
- `project_peer_joined`, `project_peer_updated`, `project_peer_left`: 증분 Peer Event
- `project_baseline_publish`: Owner/승인 Publisher가 명시적으로 서명한 새 Baseline 게시
- `project_baseline_changed`: 승인된 새 Revision/Hash Metadata
- `project_sync_required`: 오래됐거나 다른 Manifest인 Peer에 최신 기준 안내

Server는 Manifest 본문, 파일 경로 목록, Chunk Byte, 프로젝트 Archive를 이 메시지로 받지 않는다.

## Project Identity와 서명

- `projectId`: 사용자가 입력하는 사람이 읽을 수 있는 Routing 이름
- `projectUuid`: 실제 Project Identity인 UUID
- 같은 `projectId`에 다른 `projectUuid`가 관측되면 자동 선택하지 않고 `project_uuid_conflict`로 거부한다.
- Baseline은 Project UUID, Revision, Manifest Hash, Unity/Package/Protocol Version, Owner/Publisher Key ID를 포함하는 Canonical Descriptor다.
- Baseline Descriptor는 `ownerPublicKey`와 `publisherPublicKey`를 포함하고 Ed25519 Publisher Signature로 검증한다. Server는 공개키에서 계산한 SHA-256 Key ID가 선언값과 일치하는지 확인한다.
- Publisher가 Owner와 다르면 Owner가 Publisher Key를 승인한 서명이 필요하다.
- Peer가 Owner임을 주장하려면 현재 Connection/Endpoint/일회 Token/Baseline에 대한 Owner Proof가 필요하다. Canonical Payload는 `teamforge-owner-proof-v1`, Project ID, Project UUID, Connection ID, Revision, Manifest Hash, Endpoint, Transfer Token을 LF로 결합한다.
- Server 재시작 뒤 Peer 광고로 Registry를 재구성한다. 영속 Anchor가 없는 최초 Bootstrap은 TOFU(Trust On First Use)이며 공개 환경 보안 근거로 사용하지 않는다.

## Seed 우선순위

1. 최신 Baseline 전체를 가진 검증된 Owner Peer
2. 최신 Baseline 전체를 가진 검증된 Replica Peer
3. 최신 Baseline Chunk 일부를 가진 검증된 Peer
4. Project 기준이 전혀 없을 때 명시적 Publish를 수행한 Bootstrap Client

Owner가 늦게 들어와도 같은 Revision/Manifest가 검증될 때만 Preferred Seed가 된다. 오래된 Owner는 먼저 Replica로 Sync하며 Owner라는 이유만으로 Baseline을 되돌릴 수 없다. 더 높은 후보도 `project_baseline_publish` 없이 자동 승격하지 않는다.

## Manifest와 Chunk

- 정규화 상대 경로는 `/` 구분자, NFC, 대소문자 원문 보존을 사용한다.
- 절대 경로, `..`, 빈 Segment, Control Character, Windows Drive/UNC 경로를 거부한다.
- 기본 Chunk 크기 1 MiB, 허용 범위 64 KiB~4 MiB.
- File Hash와 Chunk Hash는 SHA-256 lowercase hex다.
- File Entry: `path`, `size`, `fileHash`, `chunks[{hash,size,offset}]`, `kind`, `executable`, `script`.
- Manifest는 Path로 정렬하고 시간/로컬 절대 경로를 넣지 않아 같은 입력이 같은 Hash를 만든다.
- `manifestHash`는 `manifestHash`/서명 필드를 제외한 Canonical Manifest JSON의 SHA-256이다.
- Chunk는 Hash 이름으로 저장하며 수신 즉시 Hash를 검증한다. 불일치 Chunk는 폐기하고 다른 Peer에 재요청한다.

## 포함/제외 및 Path 안전

기본 포함은 `Assets`, `Packages/manifest.json`, `Packages/packages-lock.json`, `ProjectSettings`, `Packages` 바로 아래에서 `package.json`을 가진 모든 direct Embedded UPM Package, Project Root 내부의 안전한 `file:` UPM Package와 필요한 `.meta`다. Dependency에 열거되지 않은 direct Embedded Package도 포함한다. Publish Preview는 Package 이름/버전/File/Byte/Chunk를 표시하며 별도 Coverage 검사에서 package.json 누락을 발견하면 `embedded_package_missing_from_manifest`로 중단한다. 기본 제외는 `Library`, `Temp`, `Logs`, `obj`, `UserSettings`, `.git`, `.vs`, IDE Cache, Build, Crash Dump, `.env`, Owner Key/표준 Secret·Token, OS 임시 파일이다.

Symbolic Link와 Junction/Reparse Point는 경로의 중간 구성요소도 따라가지 않고 기본 거부한다. Project Root 밖/절대/UNC/Drive-relative/Traversal Local Package 참조는 포함하거나 읽지 않고 명시적 오류로 중단한다. `manifest.json`과 `packages-lock.json`은 regular file 및 유효 JSON으로 Publish와 Activation 양쪽에서 필수다.

## Direct Transfer v1

기본 구현은 별도 `project-peer` 프로세스의 Direct HTTP다. Endpoint/Host/Port는 설정 가능하며 LAN/VPN/공인망 어느 제품에도 종속되지 않는다. `IProjectTransferTransport`에 대응하는 경계는 Manifest 조회, Inventory 조회, Chunk 조회로 제한해 향후 HTTPS/QUIC/WebRTC로 교체 가능하게 한다.

- `GET /teamforge-transfer/v1/descriptor`
- `GET /teamforge-transfer/v1/manifests/{manifestHash}`
- `GET /teamforge-transfer/v1/inventory/{manifestHash}`
- `GET /teamforge-transfer/v1/chunks/{chunkHash}`

모든 요청은 같은 Session에서 Coordinator가 전달한 Peer Transfer Token, Project UUID, Manifest Hash, Session ID를 Peer 자체에서도 검증한다. Server 주소는 이 경로의 Relay로 사용하지 않는다. 직접 연결이 모두 실패하면 `Baseline Unavailable` 또는 `Direct Transfer Unavailable`로 대기한다.

v0.4.1은 기본 병렬도 4와 Peer별 최소 요청 간격 10 ms를 사용한다. HTTP 408/425/429/500/502/503/504, Fetch Timeout, Connection Reset 등 일시 오류는 초기 요청 포함 최대 4회까지 `Retry-After`, 100 ms 시작 지수 Backoff(최대 5초), 작은 Jitter를 적용한다. 다른 Seed가 있으면 냉각 중인 Peer 대신 새 요청을 전환한다. 401/Project·Session·Manifest 불일치/없는 Chunk/서명 오류는 같은 Peer에서 즉시 반복하지 않는다. 실패 진단은 Chunk Hash 앞 12자, Peer, Status/오류 종류, Attempt, 다음 대기, 전환 여부, Resume 수/남은 Byte만 기록하고 Token/Private Key/raw 응답 본문은 기록하지 않는다.

## Staging과 Activation

기본 관리 구조:

```text
TeamForgeProjects/<Project UUID>/
  active/<revision>-<manifest-prefix>/
  staging/<download-id>/
  metadata/chunks/<sha256>
  metadata/current.json
```

- 기존 임의 Unity Project는 읽기 Seed로만 사용하며 수정하지 않는다.
- Staging은 Download ID별 새 경로만 만들고 기존 Active를 덮어쓰지 않는다.
- 전체 Chunk/File/Manifest/Unity Project 구조와 호환성 검증 후에만 새 Active Revision 디렉터리를 만든다.
- `current.json`은 검증된 Active 경로를 가리키는 작은 Pointer이며 원자적 Rename으로 교체한다.
- 실패 Staging은 실패 Metadata와 함께 보존하며 자동으로 사용자 파일을 삭제하지 않는다.
- Script/Package 포함 여부, Publisher Fingerprint, Source Peer를 활성화 전 표시하고 사용자의 신뢰 승인을 요구한다.

## 완료 기준

- Phase 0~2 Server 회귀 통과
- Coordinator UUID/Session/Seed/Owner/재광고 자동 테스트 통과
- Manifest 결정성/Hash/Chunk/Path/Symlink/Exclude 자동 테스트 통과
- 실제 Direct HTTP 두 Peer 이상에서 병렬 Chunk 수신과 Seed Failover 자동 통합 테스트 통과
- Resume/Invalid Chunk/기존 Active 보존/Staging 실패 원자성 테스트 통과
- Server 작업 경로에 Project Payload가 생기지 않는 테스트 통과
- Unity Source/정적 검증 통과, 현재 v0.4.1 Unity Editor 필요 항목은 `NOT RUN`으로 명시
- Phase 3 보고 뒤 Phase 4를 자동 시작하지 않음

## 구현 결과

- Server Coordinator가 Project ID/UUID, Baseline 단조 Revision, Owner/Publisher Ed25519 서명, Peer/Seed 순위와 Session별 Endpoint/Token을 검증한다.
- Server는 Project Payload/Manifest 본문/File 경로/Chunk/Archive를 거부하고 작은 RAM Metadata만 유지한다.
- `project-peer` Sidecar가 결정적 Manifest, SHA-256 Chunk Store, Direct HTTP, Resume, 여러 Seed 병렬 수신/Fallback, Staging/불변 Active 전환을 수행한다.
- 최초 Publish에서 Owner Key를 자동 생성하고, 변경 File 요약과 명시 확인 뒤 Server Ack에 성공한 Descriptor만 승인 Pointer로 올린다.
- 취소/거부 Draft는 Seed로 선택하지 않으며 Server Ack 뒤 Source Descriptor 기록만 실패한 경우 동일 Revision 복구 명령을 제공한다.
- 장시간 Seed는 Coordinator 재시작 뒤 제한 Backoff로 재접속해 새 Owner Proof와 Peer 광고를 전송하며 새 Baseline을 재게시하지 않는다.
- Unity Package는 Project Capability, Registry/Seed 진단, Invite Import, Publisher 신뢰 경고와 secret-free Sidecar Launch Settings를 제공한다. 기존 Token을 Invite로 이동하지 않으며 UUID가 다른 열린 Project를 Seed/덮어쓰기 대상으로 쓰지 않는다.
- v0.4.0 수동 시험에서 확정된 direct Embedded Package 수집 누락을 v0.4.1에서 일반화해 수정했다. 실제 저장소의 `com.eunsung.teamforge` Package를 Source의 `Packages`에 복사한 Node Publish→Sync→Active 회귀가 package.json `0.4.1` 존재까지 확인한다.
- v0.4.0의 116/142 실패는 현장 로그가 없어 정확한 원인이 미확정이다. 다만 기존 120 req/s + 무대기 즉시 재시도 조합이 117개 검증 뒤 429로 실패하는 것을 재현했고, v0.4.1은 실제 HTTP 429/Retry-After와 150개 이상 Chunk 시험으로 해당 실패 경계를 보강했다.

일반 참가자는 Invite, Project 다운로드 승인, Publisher Fingerprint 확인만 수행한다. UUID/Owner Key ID/공개키/Manifest Hash/Revision/Seed Rank는 내부 자동 Metadata이며 고급 읽기 전용 Diagnostics에만 나타난다.

## 변경 파일 범위

| 영역 | 주요 파일 |
| --- | --- |
| Root/검증 | `package.json`, `.gitignore`, `scripts/validate-repository.mjs`, `README.md` |
| Server | `server/src/project-coordinator.mjs`, `teamforge-server.mjs`, `protocol.mjs`, `config.mjs`, Server Test/Smoke/Compose/README/Package Lock |
| Project Peer | 신규 `project-peer/README.md`, `src/*.mjs`, `test/*.mjs`, `scripts/*.mjs`, Package/Lockfile |
| Unity | Protocol/Connection/UI, 신규 `Editor/ProjectTransfer/*.cs`, 신규 Project EditMode Test Source, Package 문서/Version |
| 문서 | Roadmap, Project State, Architecture Decisions, Known Issues, Deployment, Compatibility, Realtime/Project Transfer Protocol, Phase 2/3 문서와 Test/Manual Report |

기존 Source를 삭제하거나 기존 Unity Project를 덮어쓰지 않았다. Git 이력이 없어 Commit diff 대신 검증된 Phase 2 Archive와 최종 Phase 3 Archive/Checksum을 변경 기준으로 유지한다.

## 검증 결과

- Node `20.0.0`: 최종 Listener/실제 경계 Test 추가 전 Server `37/37`, Project Peer 핵심 `53/53` 통과; 최종 변경 뒤 재실행은 Host 승인 한도로 `NOT RUN`
- Node `22.16.0`/`24.18.1`: 최종 Server `37/37`, Project Peer `59/59` 통과
- Project Peer: Embedded Package, Path Security, Retry/Resume/Failover, Abort Cleanup/Port Reuse를 포함
- Root Validator: 제품/Protocol/Manifest Version, JSON/meta/GUID/C# 구조, Server Disk Write 금지와 Unity Progress API 미사용 검증
- Clean Install: Server/Project Peer Lockfile `npm ci --ignore-scripts` 성공
- Smoke: 기존 Ping/Presence/Transform/Lock 및 Direct Project Payload 성공, `serverRelayUsed=false`
- Audit: 양쪽 알려진 취약점 0
- Unity Test Source: PackageInfo/Assembly/Menu/0.4.0 Descriptor 거부 Source를 추가했다. Unity `6000.3.21f1`은 설치돼 있으나 Host Launch 승인/Usage 차단으로 Process 시작 전 중단돼 Compile/EditMode는 `NOT RUN`
- Docker: 설치/CLI/Service가 없어 Compose Config/Image Build는 `NOT RUN`

상세 명령과 요구 시나리오 매핑은 [v0.4.1 Test Report](../phase-3-v0.4.1-test-report.md)에 기록한다. 기존 [v0.4.0 Test Report](../phase-3-test-report.md)는 덮어쓰지 않고 보존한다.

## 서버/클라이언트 호환성

- Root/Server/Unity Package/Project Peer 제품 버전은 모두 `0.4.1`이다.
- Realtime Envelope는 v1을 유지하고 `supportsProjectTransfer`/`projectTransferEnabled`로 기능을 협상한다.
- Phase 0~2 Client는 Project Event를 협상하지 않으므로 기존 Hello/Presence/Transform 동작을 유지한다.
- Project Transfer는 Server/Unity/Project Peer `0.4.1`, Transfer v1, Manifest v1의 정확한 일치를 요구한다. v0.4.0 Descriptor는 v0.4.1에서 호환으로 오인하지 않는다.
- Unity `0.4.1` Compile과 실제 v0.4.1 Binary 조합은 Host Launch 차단으로 실행을 시작하지 못했다.

## 업데이트와 롤백

업데이트는 모든 Editor/Sidecar Disconnect와 원본 Project Backup 뒤 Server→Unity Package→별도 Test Session→첫 명시 Publish 순서다. Rollback은 검증된 `Unity-TeamForge-Phase2-v0.3.0.zip`을 새 경로에 풀어 Server/Package를 함께 되돌리며 `TeamForgeProjects`와 Owner Key를 삭제하지 않는다. Project Payload Server Migration은 없다. 전체 절차는 [Deployment](../deployment.md)를 따른다.

## 남은 한계와 다음 Gate

- Unity `6000.3.21f1` Compile/EditMode는 Editor 설치 확인 뒤 Host Launch 승인/Usage 단계에서 차단돼 `NOT RUN`이며, 두 PC/LAN Project Bootstrap도 미실행이다.
- Direct HTTP 자동 TLS/NAT Traversal/Server Relay, 자동 Chunk GC, Owner Rotation/Transfer는 없다.
- Unity는 Invite 서명의 구조·Key ID만 검사하며 실제 Ed25519 검증과 활성화 신뢰 승인은 Sidecar에서 수행한다.
- 승인 Publisher 서명은 Protocol/Server가 검증하지만 독립 Publisher Credential 전달 Workflow는 아직 없다.
- Server Registry/Trust Anchor는 RAM/TOFU이며 영속 Recovery는 Phase 5다.

Phase 3 v0.4.1 결과를 보고한 뒤 [새 수동 체크리스트](../phase-3-v0.4.1-manual-test-checklist.md)를 실제 환경에서 수행한다. **필수 v0.4.1 Gate와 사용자의 새 명시 승인이 모두 있기 전 Phase 4를 시작하지 않는다.**

## 2026-08-07 closure update

User field validation completed the practical Phase 3 transport/bootstrap gates on Unity 6000.3.21f1: Direct P2P activation, short-path first open, offline/online Seed state, Resume, two-Seed failover, Abort/port rebind, and Phase 0-2 regression all passed. Closure hardening adds Windows path-risk preflight, successful Resume statistics, safe no-op Publish behavior, and unambiguous partial-seed rate-limit naming. The closure artifact remains product version 0.4.1 and protocol v1. Phase 4 is implemented only from a separate copy of the frozen closure source after its fresh-extract gates pass.
