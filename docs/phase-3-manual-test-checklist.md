# Unity TeamForge Phase 3 Manual Test Checklist

권장 Unity Editor는 `6000.3.21f1`이다. 이 체크리스트는 Phase 3 `0.4.0`의 실제 Client/Network/Filesystem 검증용이며 자동 테스트 통과 항목을 임의로 수동 통과 처리하지 않는다. 테스트에는 Secret이 아닌 임시 Project와 임시 Owner Key를 사용한다.

## A. 설치와 안전한 Test Project

- [ ] Server와 `project-peer`에서 각각 Lockfile 기반 `npm ci`가 성공한다.
- [ ] Unity Package `0.4.0`이 Compile Error 없이 로드된다.
- [ ] 기존 Phase 2 체크리스트의 미확인 항목이 그대로 남아 있다.
- [ ] Test Project를 별도 복사하고 실제 작업 Project를 Backup한다.
- [ ] Project에 `Assets`, Scene, Script, Prefab, Texture, `Packages`, `ProjectSettings`, 모든 `.meta`를 준비한다.
- [ ] `Library`, `Temp`, `Logs`, `UserSettings`, `.git`, `.env`와 Token 시험 파일을 둔다.
- [ ] Source Project 안에 Symbolic Link/Junction을 만든 별도 거부 시험을 준비한다.

## B. Owner와 Baseline Publish

- [ ] 최초 명시 Publish가 Owner Key를 자동 생성하고 Private Key를 Project Payload에 넣지 않는다.
- [ ] 일반 참가자 화면에는 Key ID/Public Key/Manifest Hash/Revision/Seed Rank 입력란이 없고 고급 읽기 전용 정보로만 보인다.
- [ ] Owner Key를 사용자 지정 안전 경로에 백업하고 원본/백업 권한과 Fingerprint를 확인한다.
- [ ] 관리 Private Key를 별도 보존한 뒤 제거하고, 일치하는 Backup 경로로만 복원 Publish 준비가 가능하다.
- [ ] 다른 Key Backup은 `owner_key_restore_unverified` 또는 `owner_key_conflict`로 거부되고 기존 Owner/Baseline이 유지된다.
- [ ] Owner가 명시적 Publish를 실행하기 전에는 Server 최신 Baseline이 바뀌지 않는다.
- [ ] Publish 전 Project ID, 변경 File 요약과 Publisher 출처가 표시되며 UUID/Revision/Hash/Seed 정보는 고급 읽기 전용 진단으로만 확인된다.
- [ ] 첫 Publish는 Revision 1을 만들고 Server에는 Metadata만 보인다.
- [ ] File 하나를 바꿔 Revision 2를 Publish하면 Manifest/File/해당 Chunk Hash가 바뀐다.
- [ ] 오래된 Revision Publish와 같은 Revision의 다른 Manifest Publish가 거부된다.
- [ ] 승인되지 않은 Publisher Key가 거부된다.
- [ ] 승인 Publisher와 Owner 역할이 UI/CLI/로그에서 구분된다.
- [ ] Owner Key Rotation/Ownership Transfer 명령은 지원되는 것처럼 자동 수행하지 않고 fail-closed 한계를 안내한다.

## C. Project 없는 Client Bootstrap

- [ ] Project가 없는 Client에서 같은 Project ID/Session ID와 Project UUID로 Metadata를 조회한다.
- [ ] 최신 Seed가 없을 때 빈 Project를 만들지 않고 `Baseline Unavailable`로 기다린다.
- [ ] Seed 참가 뒤 별도 `TeamForgeProjects/<uuid>/staging`에 다운로드를 시작한다.
- [ ] 진행률, 받은/전체 Byte, 남은 Byte, 사용 Peer, 현재 상태가 표시된다.
- [ ] 전체 Manifest/File/Chunk Hash 검증 전에는 Active Project가 생기지 않는다.
- [ ] Script/Package와 Publisher 출처 경고에서 승인하지 않으면 활성화하지 않는다.
- [ ] 승인 뒤 새 `active/<revision>-<hash>`와 `metadata/current.json`이 만들어진다.
- [ ] 생성된 경로를 Unity Hub에 추가해 열 수 있다.
- [ ] 새 Project에서 TeamForge Package가 로드되고 원래 Project/Session으로 연결할 수 있다.

## D. Direct P2P와 Swarm

- [ ] 같은 PC의 두 Peer Direct HTTP 전송이 Server Payload Relay 없이 성공한다.
- [ ] 서로 다른 두 PC 또는 LAN/VPN의 직접 Endpoint가 연결된다.
- [ ] Server/Peer Host/Port를 바꿔도 Source 수정 없이 동작한다.
- [ ] 다운로드 중 Client를 종료하고 재시작하면 검증된 Chunk를 재사용해 이어받는다.
- [ ] 이미 가진 동일 Hash Chunk를 다시 받지 않는다.
- [ ] 잘못된 Chunk를 반환하는 Peer의 Byte를 폐기하고 다른 Peer에서 재요청한다.
- [ ] Seed A/B/C에서 서로 다른 Chunk가 병렬로 수신된다.
- [ ] Seed 하나를 중간 종료해도 다른 Seed로 전환해 완료한다.
- [ ] 느리거나 Timeout인 Seed가 새 요청에서 후순위로 밀린다.
- [ ] 부분 수신 Peer가 받은 Chunk를 즉시 다른 Peer에게 제공할 수 있다.
- [ ] Transfer 동시 연결/속도 제한을 바꾸면 설정대로 제한된다.

## E. Owner Late Join과 Seed Election

- [ ] 최신 Baseline 전체를 가진 Replica만 있을 때 Replica가 Seed가 된다.
- [ ] 같은 최신 Baseline의 Owner가 나중에 참가하면 새 Chunk 요청부터 Preferred Seed가 된다.
- [ ] 진행 중 정상 Chunk를 버리거나 다운로드를 처음부터 다시 시작하지 않는다.
- [ ] 오래된 Owner가 참가해도 최신 Baseline이 Downgrade되지 않는다.
- [ ] 오래된 Owner는 최신 Revision을 먼저 Sync한 뒤에만 Preferred Seed가 된다.
- [ ] Partial Peer는 완전 Replica보다 후순위지만 보유 Chunk에는 Source로 사용된다.

## F. Project/Session 격리

- [ ] 같은 Project ID에 다른 Project UUID를 광고하면 명시적 충돌로 거부된다.
- [ ] 같은 Project UUID라도 다른 Session Peer의 Endpoint/Token이 보이지 않는다.
- [ ] 다른 Project ID에서 Chunk를 요청하면 Direct Peer가 거부한다.
- [ ] 잘못된 Session Token, Project UUID, Manifest Hash Header가 모두 거부된다.
- [ ] Server 재시작 뒤 기존 Client 재광고로 Project/Baseline/Peer Metadata가 복구된다.
- [ ] Server Bearer Token 교체 뒤 기존 Token은 거부되고 새 Token으로 재접속·재광고되며 Project UUID/Manifest/Chunk/Active Project는 변하지 않는다.
- [ ] 최신 완전 Peer가 모두 Offline이면 신규 Client가 잘못된 빈 Baseline을 받지 않는다.

## G. Filesystem과 활성화 안전

- [ ] `../`, 절대 경로, Windows Drive/UNC, Control Character가 있는 Manifest를 거부한다.
- [ ] Symbolic Link/Junction을 따라 Project Root 밖 파일을 읽지 않는다.
- [ ] Root 밖 `file:` Local Package 참조가 명시적 오류로 중단된다.
- [ ] `Library`, `Temp`, `Logs`, `obj`, `UserSettings`, `.git`, `.vs`, Build, Crash Dump가 Manifest에 없다.
- [ ] `.env`, Bearer Token, Owner Private Key와 머신별 절대 경로가 Manifest에 없다.
- [ ] 잘못된 Manifest/Chunk/File Hash에서 기존 Active Pointer가 변하지 않는다.
- [ ] 기존 임의 Unity Project와 이전 Active Revision이 덮어써지지 않는다.
- [ ] 실패 Staging이 원인 Metadata와 함께 남아 수동 조사할 수 있다.
- [ ] Unity가 Import/Compile 중인 열린 Project를 제자리 교체하지 않는다.

## H. Phase 0~2 회귀

- [ ] Server Address 변경, Connect, Ping/Pong, RTT, Disconnect, 재접속이 정상이다.
- [ ] 두 Editor Presence/선택/Frame/Camera가 기존처럼 동작한다.
- [ ] 저장 Object Transform/Lock/Revision이 기존처럼 동작한다.
- [ ] Phase 0/1/2 Client에 협상하지 않은 Project Event가 전달되지 않는다.
- [ ] Project Transfer 실패가 Presence/Transform/Lock 연결을 끊지 않는다.
- [ ] Phase 2 Unity Compile/EditMode/2-Editor 미확인 항목은 실제 시험한 항목만 별도 갱신한다.

## 기록할 증거

- Client/Server OS, Node/npm, Unity 정확한 Patch
- Server/Peer Endpoint와 Network 형태(LAN/VPN/공인망, Secret 제외)
- Project UUID, Baseline Revision, Manifest Hash Prefix, Publisher Fingerprint
- Project 총 Byte/File/Chunk와 실제 전송/재사용 Byte
- Peer별 Chunk 수, 전송 속도, Failover 시각과 오류
- Staging/Active/Metadata 경로와 이전 Project 보존 확인
- Server Process 작업 경로의 전후 File 목록과 Disk 증가량
- Unity Console, Server, Peer 로그 및 재현 순서
