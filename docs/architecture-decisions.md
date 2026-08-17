# Architecture Decision Index

이 문서는 현재 유효한 설계 결정을 빠르게 찾기 위한 인덱스다. 상세 Phase 0/1 결정은 각각 [phase-0](decisions/phase-0.md), [phase-1](decisions/phase-1.md)에 있다.

## 기존 결정

| ID | 결정 | 상태 |
| --- | --- | --- |
| D-001 | Editor 전용 UPM 패키지 | 유지 |
| D-002 | C# 기반 UI Toolkit EditorWindow | 유지 |
| D-003 | ClientWebSocket Transport 하나 우선 | 유지 |
| D-004 | 명시적 DTO + JSON | 유지, 복잡도 증가 시 재검토 |
| D-005 | Node.js 20+ + ws 서버 | 유지 |
| D-006 | 저장 Object는 GlobalObjectId, Instance ID 금지 | 유지 |
| D-007 | 개인 설정은 UserSettings | 유지 |
| D-008 | Assembly Reload는 Socket이 아니라 연결 의도 복원 | 유지 |
| D-101 | Presence는 Protocol v1 기능 협상으로 추가 | 유지 |
| D-102 | 안정 사용자 ID + 저장 Object ID | 유지 |
| D-103 | Presence Sampling/Heartbeat | 유지 |
| D-104 | Handles 기반 원격 선택 표시 | 실기 확인 |
| D-105 | Presence 메모리 Registry + 동일 ID 새 연결 우선 | 유지 |

## Phase 2 결정

### D-201 Protocol v1의 가산적 확장

**결정:** supportsTransformSync/transformSyncEnabled로 Phase 2 기능을 협상하고 Protocol Version은 1을 유지한다.

**이유:** 기존 Envelope, Hello/Ping/Presence 의미를 바꾸지 않으며 Phase 0/1 연결에는 Transform/Lock 메시지를 보내지 않는다.

**단점:** 같은 Protocol Version 안에 세 가지 기능 수준이 있으므로 Ack Capability 확인이 필수다.

**교체 조건:** 필수 Envelope/순서/직렬화 규칙이 호환 불가능하게 바뀔 때 Protocol Version을 올린다.

### D-202 서버 권한 Revision과 중복 제거

**결정:** 승인된 `transform_update`마다 Session 전역 `serverRevision`을 1 증가시키고 Operation ID와 전체 의미 Payload Fingerprint를 최근 4,096개까지 기억한다. 동일 Payload 재전송만 멱등이며 현재 요청 ID로 응답한다.

**이유:** WebSocket 도착 순서만 믿지 않고 명시적인 전체 순서와 재전송 멱등성을 제공한다.

**단점:** Phase 5 전에는 메모리 전용이고 과거 Operation 조회가 없다.

### D-203 GameObject 전체 Lease 잠금

**결정:** 저장 Scene GameObject 전체를 잠금 단위로 사용한다. 서버 기본 Lease는 15초다. Client는 설정값뿐 아니라 Grant의 Server Timestamp/Expiry를 사용해 남은 Lease 절반보다 늦지 않게 갱신하고, 로컬 계산 Deadline이 지나면 전송을 안전 중지한다.

**이유:** 세 명 규모 MVP에서 Property Lock보다 예측 가능하며 Client 종료 시 영구 잠금이 남지 않는다.

**단점:** 단순 선택 시 잠금을 요청하므로 탐색과 편집의 구분이 거칠다. TeamForge의 원격 Frame 동작은 자동 잠금을 한 번 억제한다.

### D-204 Transform 범위 제한

**결정:** Phase 2는 `localPosition`, `localRotation`, `localScale`만 동기화한다. 연결 시 깨끗하게 저장된 Scene의 Object를 공유 Baseline으로 캡처하고 그 집합에 있던 단일 선택만 허용한다.

**제외:** 생성/삭제/이름/활성/부모/형제 순서, 다중 선택 편집, Component 일반화, Prefab Stage, 미저장/비Baseline Object, Operation 영속화. Scene 안 Prefab Instance의 Transform Override만 기록한다.

**이유:** Phase 경계를 지키고 Transform 수직 흐름과 충돌 정책을 독립 검증한다.

### D-205 원격 적용과 Undo

**결정:** 원격 Transform은 새 로컬 Undo 항목으로 넣지 않는다. 적용 전 해당 GameObject/Transform의 기존 Undo 기록만 `Undo.ClearUndo`로 제거해 과거 로컬 값이 서버 확정값을 되살리지 못하게 한다. 값이 실제로 다를 때만 직접 적용을 `TeamForgeRemoteApplyScope`로 감싸고 Prefab Instance Override를 기록한 뒤 `EditorSceneManager.MarkSceneDirty`를 호출한다. 동일 값이면 Undo만 정리하고 Dirty를 만들지 않는다.

**이유:** 원격 사용자의 작업이 로컬 사용자의 일반 Undo 순서를 오염시키지 않으면서 저장 누락을 방지한다.

**단점:** 원격 변경을 받은 대상 Object의 과거 로컬 Undo History는 사라진다. 공유 History/Revision 되돌리기는 Phase 5 이후 별도 기능이 필요하다.

### D-206 Phase 2 Snapshot 한계

**결정:** 서버는 활성 Session의 최신 Transform/Lock을 메모리 Snapshot으로 새 Phase 2 Client에 보낸다. Clean Baseline Scene에는 Server Snapshot을 적용한다. 연결 시 이미 Dirty인 Scene의 다른 값, 비Baseline Object, Prefab Stage는 덮어쓰지 않고 Object 단위 해결 대기 상태로 유지한다.

**이유:** 늦은 참가자의 기본 상태 정렬과 Revision 시작점을 제공한다.

**단점:** 모든 사용자가 나가거나 서버가 재시작하면 상태가 사라진다. Dirty Conflict는 자동 Merge하지 않으며 저장/되돌리기 후 Disconnect/Reconnect가 필요하다. 누락 Operation 조회와 영속 복구는 Phase 5 범위다.

### D-207 지원하지 않는 편집의 안전 차단

**결정:** 다중 선택, Prefab Stage, Baseline 뒤 생성 Object, Parent/Scene Identity 변경은 Phase 2에서 전송하지 않는다. 추적 중 Parent/Scene 변경이면 오래된 Target으로 Final Transform을 보내지 않고 Lock만 해제하며 해당 Object를 차단한다.

**이유:** Local Transform은 Parent에 상대적이므로 Hierarchy가 다른 Peer에 같은 숫자를 적용하면 조용한 Scene Divergence가 생긴다.

**교체 조건:** Phase 4의 권한형 Hierarchy Operation과 Object 생성 ID가 적용될 때 같은 Transaction/Revision 계약으로 통합한다.

### D-208 유한한 메모리와 연결 생존

**결정:** 기본 Session 최신 Transform 512개, Connection Lock 8개, Session Lock 256개, Snapshot 900 KiB, Socket 발신 Buffer 1 MiB를 상한으로 둔다. Hello 10초 Timeout과 15초 Ping/45초 Pong Timeout으로 유휴/반단절 연결을 정리한다.

**이유:** Phase 2의 단일 Snapshot과 메모리 Map 구조가 Client 1 MiB 수신 한도, Server Memory, 연결 Slot을 무제한 소비하지 않게 한다.

**단점:** 큰 Scene 전체 Transform 상태는 한 Session에서 처리할 수 없다. Phase 5 이후 Snapshot Chunking/Paging과 영속 Store가 필요해지면 상한 계약을 교체한다.

## Phase 3 결정

### D-301 Project 없는 Client는 Standalone Sidecar로 Bootstrap

**결정:** 기존 Unity Project가 없는 Client는 Editor Package가 아니라 Node.js `project-peer` CLI로 관리 Project를 먼저 구성한다. 기존 Project가 있는 Editor는 Package UI에서 동일 Metadata를 확인하고 Sidecar 실행 정보를 내보낸다.

**이유:** Unity Editor Package는 열려 있는 Unity Project가 있어야 실행되므로 “Project가 없는 Client가 Project를 받는다”는 시작 조건을 Package 하나로 해결할 수 없다.

**단점:** Client에도 Node.js 20+가 필요하고 Editor 안에서 완전히 끝나는 UX가 아니다.

**교체 조건:** 검증된 Native Launcher나 Unity Hub Extension을 만들면 같은 Transfer/Manifest 계약 위에서 Sidecar를 교체할 수 있다.

### D-302 Realtime과 Project Payload 전송 분리

**결정:** 기존 WebSocket Protocol v1에는 Capability와 Peer/Hash/Seed Metadata만 가산하고, Manifest/Chunk/File Byte는 별도 Project Transfer v1 Direct HTTP로 전송한다.

**이유:** Presence/Transform/Lock 지연과 대용량 File Backpressure를 분리하고 Server가 Payload Relay가 되는 것을 막는다.

**단점:** 두 Transport의 연결 상태와 오류를 따로 진단해야 한다. Direct Endpoint가 모두 막히면 자동 Server Relay가 없다.

### D-303 SHA-256 Content-addressed Chunk와 결정적 Manifest

**결정:** 기본 1 MiB Chunk, SHA-256 File/Chunk/Manifest Hash, Path 정렬 Canonical JSON을 사용한다. 받은 Chunk는 저장 전에 Hash를 확인하고 같은 Hash는 재사용한다.

**이유:** 중단 재개, Seed 교체, 중복 제거, 여러 Seed 병렬 수신을 하나의 검증 단위로 해결한다.

**단점:** 최초 Seed Manifest 생성은 Project 전체를 읽고 Hash해야 하며 큰 Binary가 조금 바뀌면 해당 Chunk를 다시 보낸다. 향후 Rolling Chunking은 Schema Version 변경으로 검토한다.

### D-304 불변 Active Revision과 원자적 Pointer

**결정:** 수신 Project는 `staging/<download-id>`에서 완전 검증하고 `active/<revision>-<hash-prefix>`라는 새 경로로만 활성화한다. 기존 Active/기존 임의 Project를 덮어쓰지 않고 `metadata/current.json` Pointer만 원자적으로 교체한다.

**이유:** 부분 적용과 Import/Compile 중 교체로 인한 Project 손상을 피하고 즉시 Rollback 가능한 복사본을 남긴다.

**단점:** 여러 Revision이 Disk 공간을 사용한다. 자동 삭제는 하지 않으며 정리 UX는 후속 안정화 범위다.

### D-305 Ed25519 Owner/Publisher Descriptor

**결정:** Owner/Publisher SPKI 공개키, SHA-256 Key ID, Owner Publisher 승인 서명, Publisher Baseline 서명을 검증한다. Owner Preferred Seed 주장은 Connection/Endpoint/Token/Baseline에 묶은 별도 Proof가 필요하다.

**이유:** Owner, Publisher, Seed, Lock Owner, Server Operator를 같은 역할로 오인하지 않고 오래된 Owner의 자동 Downgrade와 단순 문자열 권한 위조를 막는다.

**단점:** Server 영속 Anchor가 없을 때 최초 Project UUID/Owner Key는 TOFU다. 신뢰되지 않은 공개망에는 별도 초대/관리자 Pinning이 필요하다.

### D-306 명시적 Baseline Publish

**결정:** File Watch나 Owner 접속만으로 Baseline을 바꾸지 않는다. 현재 Revision의 다음 값, 전체 Manifest 검증, Owner/Publisher 서명, 명시적 Publish 작업이 모두 있어야 한다.

**이유:** Unity 자동 생성 파일, 오래된 Owner, 작업 중 Dirty File이 최신 기준을 조용히 덮는 것을 막는다.

**단점:** 변경 공유 전에 사용자가 Manifest 생성과 Publish를 수행해야 한다.

### D-307 Server RAM Metadata와 재광고 복구

**결정:** Server는 Project ID/UUID, Baseline Summary, Peer/Endpoint/Token/보유 수량/서명 Metadata만 RAM에 유지한다. Manifest 본문, Path 목록, Chunk Byte, Archive와 Project Payload는 저장하거나 Relay하지 않는다. 재시작 뒤 Peer가 재광고한다.

**이유:** 미니 PC 저장장치 장애가 Client Project 복사본에 영향을 주지 않고 Server Disk 사용을 최소화한다.

**단점:** 아무 최신 Peer도 온라인이 아니면 신규 Client는 `Baseline Unavailable`로 기다려야 한다. Phase 5 전에는 Server Metadata History도 없다.

### D-308 Direct HTTP MVP와 교체 경계

**결정:** 첫 전송 구현은 Token과 Project/Manifest Header를 검증하는 Client-to-Client HTTP다. 전송 경계는 Descriptor/Manifest/Inventory/Chunk 요청으로 제한한다.

**이유:** Node.js 20 표준 HTTP로 LAN/같은 PC/직접 연결 VPN에서 실제 자동 통합 테스트가 가능하다.

**단점:** NAT Traversal과 Transport TLS가 없으며 Endpoint가 직접 연결되지 않으면 실패한다. 향후 HTTPS/QUIC/WebRTC/승인형 Relay로 교체할 수 있다.

### D-309 Path와 Trust의 Fail-closed 정책

**결정:** 절대/상위 경로, Control Character, Case 충돌, Root 밖 Local Package, Symbolic Link/Junction을 거부한다. Script/Package를 포함한 Baseline은 Publisher Fingerprint를 표시하고 명시적 신뢰 승인 전 활성화하지 않는다.

**이유:** 프로젝트 동기화가 임의 File Read/Write 또는 자동 Code 실행 경로가 되는 것을 막는다.

**단점:** Symlink를 의도적으로 쓰는 Project와 Root 밖 Local Package는 Phase 3 MVP에서 동기화할 수 없다.

### D-310 내부 Metadata와 일반 사용자 UX 분리

**결정:** Project UUID, Key/Public Key, Revision/Manifest Hash, Seed Rank는 자동 생성·검증하며 일반 입력란으로 노출하지 않는다. 일반 참가자는 초대 정보, 다운로드 승인, Publisher Fingerprint 신뢰만 다룬다. 최초 Publish는 Owner Key를 자동 생성하고 Private Key는 Payload/Manifest/로그에서 제외한다.

**이유:** 암호·분산시스템 내부 식별자를 수동 복사하게 하면 오입력과 Key 유출, 잘못된 Baseline 선택 위험이 커진다.

**단점:** 문제 진단 때 내부 값을 확인할 고급 읽기 전용 화면과 Key 백업/복구 절차가 별도로 필요하다.

### D-311 Unity와 Sidecar의 Secret-free Identity Bridge

**결정:** 열린 Source Project와 검증 완료 Replica는 `ProjectSettings/TeamForgeProject.json`에 Project UUID, Baseline Revision, Manifest/Descriptor Hash와 호환 Version만 기록한다. Sidecar는 이 파일로 UUID를 자동 고정하며 파일 자체는 Manifest에서 제외한다. Unity가 내보내는 Launch Settings도 상대 경로와 환경 변수 이름만 포함하고 Token/Private Key/절대 경로를 포함하지 않는다.

**이유:** Unity가 Project Payload를 직접 다루지 않으면서도 별도 Sidecar와 같은 Project Identity를 사용하고, Project가 없는 Client가 활성화된 복사본을 열자마자 올바른 Baseline을 인식해야 한다.

**단점:** 해당 로컬 Descriptor는 전송된 Project 내용의 일부가 아니라 검증 뒤 생성되는 관리 Metadata다. 따라서 서명 Descriptor가 신뢰의 근거이며 로컬 파일만으로 Owner 권한을 증명하지 않는다.

### D-312 Owner Key와 접속 Token Lifecycle 분리

**결정:** Owner Key는 첫 Publish에서만 자동 생성하고 기존 서명/Invite/Active 증거가 있는데 Key가 없으면 새 Key를 만들지 않는다. 백업은 배타적 별도 명령으로 제공한다. Rotation/Ownership Transfer는 기존 Owner가 승인하는 전환 Protocol 전까지 fail-closed다. Server Bearer Token은 별도 접속 자격이므로 운영자가 교체해도 Project UUID/Baseline/Chunk/Client 복사본은 바꾸지 않는다.

**이유:** Key 분실이나 Server RAM 초기화가 과거 Project를 다른 Owner로 조용히 재등록하거나 Project Data를 불필요하게 다시 전송하는 계기가 되면 안 된다.

**단점:** Owner Key 백업이 없으면 기존 Owner Identity로 새 Baseline을 게시할 수 없다. 현재 안전한 우회는 새 Project Identity로 명시적으로 Migration하고 참가자가 다시 신뢰하는 것이다.

### D-313 Draft, Server 승인 Baseline, Unity Descriptor 분리

**결정:** Manifest와 Chunk 생성 결과는 Draft로 저장하되 Server가 `project_baseline_changed`로 정확한 Descriptor를 승인하기 전에는 `metadata/published.json`에 올리거나 Seed로 광고하지 않는다. 승인 Pointer는 단조 Revision/Hash를 원자적으로 기록한다. Server 승인 뒤 원본 Unity Project의 secret-free Descriptor 기록만 실패한 경우에는 새 Revision을 만들지 않고, Coordinator 현재값과 로컬 서명 Metadata가 정확히 일치할 때만 `repair-source-descriptor`로 복구한다.

**이유:** 사용자가 Publish 확인을 취소했거나 Server가 거부한 Draft가 재시작 뒤 우연히 Seed가 되는 것을 막고, Server 승인과 로컬 파일 기록 사이의 드문 장애가 중복 Revision Publish로 이어지지 않게 한다.

**단점:** 승인된 Manifest/Descriptor Metadata와 Source Descriptor를 별도로 관리해야 한다. Server 승인 뒤 Process가 중단되면 사용자가 명시적 복구 명령을 실행해야 하며 자동으로 Source Project를 덮어쓰지 않는다.

**교체 조건:** 영속 Coordinator Transaction과 Client Acknowledgement Log가 Phase 5에서 도입되면 승인 Pointer와 복구 절차를 해당 Transaction 상태 기계로 통합한다.

### D-314 Embedded Package 독립 탐색과 이중 Coverage 검사

**결정:** Publish 수집기는 `Packages` 바로 아래에서 `package.json`을 가진 Embedded Package를 dependency 선언과 무관하게 열거하고, Project Root 내부의 안전한 `file:` Package도 포함한다. 수집 결과와 별개로 Manifest 생성 직전에 direct Embedded Package의 `package.json`이 실제 Manifest File 목록에 있는지 다시 검사한다. `Packages/manifest.json`과 `Packages/packages-lock.json`은 regular file/유효 JSON으로 필수다.

**이유:** v0.4.0은 수집 Root에서 direct Embedded Package를 빠뜨렸지만 이후 검증이 발견된 File만 검사해 `Sync Complete`가 가능했다. 독립 Coverage 검사는 같은 종류의 수집 회귀를 Publish 전에 차단한다.

**보안 경계:** 절대/UNC/Drive-relative/Traversal `file:` 참조, Root 밖 realpath, 중간 Symlink/Junction, Case 충돌, Owner Identity JSON을 거부한다. 일반 텍스트에 임의 이름으로 숨긴 모든 Secret을 자동 식별하는 DLP Scanner는 아니므로 Token은 Project Root에 저장하지 않는다.

**단점:** Root 밖 Local UPM과 Symlink 기반 개발 Layout은 계속 지원하지 않는다. Package Lock이 없는 오래된/비표준 Project는 Publish 전에 Unity Package Metadata를 정상 생성해야 한다.

### D-315 Direct Transfer 일시 오류 재시도와 Peer별 Pacing

**결정:** Direct Client가 408/425/429/500/502/503/504, Timeout, Reset과 제한된 Network 오류를 일시 오류로 분류한다. Server는 429/503에 `Retry-After`와 정밀 millisecond Hint를 제공한다. Swarm은 기본 병렬도 4, Peer별 요청 시작 간격 10 ms, 초기 포함 최대 4회 시도, 100 ms 지수 Backoff(최대 5초)+20% Jitter를 사용한다. 다른 Seed가 있으면 냉각 중인 Peer 대신 전환하고, 검증 Chunk/Staging/Active 불변조건은 유지한다.

**이유:** v0.4.0은 120 req/s fixed window에 descriptor/manifest/inventory도 포함하면서 142개 소형 Chunk를 병렬 요청했고, 첫 429 뒤 같은 Window에서 즉시 한 번 더 요청해 실패할 수 있었다. 실제 코드 재현은 117개 검증 뒤 같은 실패를 만들었다.

**판정 제한:** 사용자 현장의 116/142 사건에는 HTTP 상태 로그가 없으므로 429를 확정 원인으로 기록하지 않는다. Rate Limit은 강한 재현 가설이며 Reset/Timeout/일시 5xx도 같은 정책으로 처리한다. `--concurrency 1` 재실기 성공은 남은 26 Chunk만 받은 Resume 효과와 분리해 해석한다.

**단점:** 작은 Chunk가 매우 많으면 Peer별 pacing으로 전송 시작이 약간 느려진다. Direct HTTP 자체는 신뢰된 LAN/VPN 대상이며 NAT Traversal/TLS는 별도 Transport 교체 범위다.

## Phase 4 decisions — v0.5.0

### D-401 Protocol v1 additive Hierarchy capability

**Decision:** keep Realtime Protocol `1` and negotiate `supportsHierarchySync` / `hierarchySyncEnabled` additively. Hierarchy Sync requires Presence + Transform.

**Reason:** the common envelope and existing Presence/Transform/Project semantics remain compatible. Phase 4 can be isolated by capability without forcing Phase 0–3 clients to parse hierarchy messages.

**Compatibility boundary:** once a Scene is authoritative under Phase 4, a Phase 2-only client cannot acquire Transform/Lock authority in that Scene.

### D-402 Saved GlobalObjectId + session logical identity

**Decision:** saved baseline objects keep Unity `GlobalObjectId`; new session-created objects use `tf:<32 lowercase hex>`. Logical-to-Global bindings are local generated state under `Library/TeamForge` and no TeamForge Scene Component is added.

**Rejected:** name/path identity, Instance ID, injecting UUID Components into all Scenes.

**Reason:** names/paths/sibling positions are mutable and Instance IDs are not cross-editor stable. A local identity map preserves Scene content cleanliness for the MVP.

**Known limitation:** a fresh republished Project baseline cannot safely infer logical IDs from an older live hierarchy session. Initial snapshot application therefore fails closed on identity mismatch. Durable/migratable identity is a later explicit design, not hidden Phase 5 work.

### D-403 Hierarchy shares the Session revision stream

**Decision:** Hierarchy and Transform share one `serverRevision`; hierarchy operations require exact `baseRevision == serverRevision` and retain recent semantic operation fingerprints for idempotence.

**Reason:** create/delete/reparent can invalidate Transform targets and parent structure. One authoritative revision stream gives deterministic ordering without introducing a second merge clock.

**Trade-off:** simultaneous independent hierarchy edits can conflict more often than a per-object revision model. Phase 4 prefers explicit conflict over silent structural divergence.

### D-404 Server-authoritative bounded hierarchy + tombstones

**Decision:** retain authoritative Scene IDs, hierarchy object records and bounded tombstones in server memory only. Deleting a subtree tombstones every deleted identity and prevents resurrection in the same Session.

**Reason:** late join and deterministic delete require an authoritative structure, while persistence/recovery is explicitly Phase 5.

**Limits:** default 2,048 hierarchy objects, 4,096 tombstones, 1 MiB hierarchy snapshot, depth 256, name length 128.

### D-405 Unity ObjectChangeEvents observation and remote apply policy

**Decision:** observe hierarchy changes with `ObjectChangeEvents.changesPublished` for create/delete/reparent/children-order plus a bounded `hierarchyChanged` rename fallback. Remote authoritative apply does not intentionally create normal user Undo entries and clears stale target Undo before mutation.

**Reason:** Unity's object change stream provides precise structural events without a full hierarchy scan every Editor update. Remote history must not let local Undo resurrect stale pre-authoritative structure.

### D-406 Hierarchy edits respect affected parent/subtree locks

**Decision:** hierarchy operations fail closed not only on a target lock but also on affected current/destination parent locks; subtree delete additionally checks every deleted object's lock.

**Reason:** create/reorder/reparent/delete mutate parent child-list structure even when the target itself is unlocked. Other-user locks remain authoritative conflict guards while exact revision is the primary ordering rule.

### D-407 Delete clears stale Presence selection references

**Decision:** after authoritative delete, clear Presence selections that reference deleted identities and broadcast the cleaned Presence state.

**Reason:** deleted objects must not remain advertised as active selections to late/remote viewers.

### D-408 Empty authoritative Scenes are explicit

**Decision:** `hierarchy_snapshot` includes additive `sceneIds` separately from the object array.

**Reason:** an authoritative Scene can contain zero GameObjects. Inferring Scene authority only from object records would lose the distinction between “authoritative empty Scene” and “never seeded Scene”.

### D-409 Project baseline / live hierarchy mismatch fails closed

**Decision:** the first authoritative Unity snapshot refuses to overwrite even a clean local Scene when it contains objects whose identities cannot be matched to the authoritative Global/logical identity set.

**Reason:** guessing logical identity after a new Phase 3 baseline is republished can duplicate or bind the wrong GameObject. For `0.5.0`, the safe workflow is to keep Project baseline and live hierarchy Session aligned or restart/reseed hierarchy after baseline publication.

**Replacement condition:** a future explicit identity migration/persistent recovery design provides signed durable mapping semantics.
# Phase 4.5 Closure decision index

The accepted as-built Phase 4.5 decisions are consolidated in [decisions/phase-4.5.md](decisions/phase-4.5.md). They preserve the Phase 0–4 decisions below, Protocol v1 and the existing Server WebSocket plus Project Peer Direct HTTP topology. Where older planning text describes a future or pre-extraction structure, the Phase 4.5 ADR and [architecture.md](architecture.md) are authoritative for the current implementation.
