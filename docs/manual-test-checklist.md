# Unity 6.3 Phase 1/2 Manual Test Checklist

권장 Editor: `6000.3.21f1`. Server는 먼저 `cd server && npm ci && npm start`로 실행한다. 두 Editor 시험에는 동일한 저장 Scene과 `.meta`를 가진 서로 다른 프로젝트 복사본을 사용한다.

## 2026-08-02 사용자 확인 기록

제공된 최종 결과 기준으로 Phase 0은 완료됐고 Phase 1과 Phase 2의 수동 Gate는 통과했다. Phase 1의 Package/창, 미니 PC Docker/Bearer 연결, 두 Editor 참가자, 선택/선택 해제, Frame Selection, Go to Camera, Disconnect/재접속, 서버 재시작 후 Presence 복구가 실제 확인됐다. 아래 체크 상태는 당시 개별 항목별로 남은 관측 기록을 그대로 보존한다. 미체크 항목은 해당 세부 조합의 독립 증거가 기록되지 않았다는 뜻이지, 전체 Phase 1/2 Gate 실패를 뜻하지 않는다.

2026-08-03 사용자가 Phase 3 조기 착수에 한해 Phase 2 실기 Gate 예외를 먼저 승인했고, 이후 제공된 결과로 Phase 2 수동 Gate는 통과했다. 개별 근거 없이 아래 역사적 Checkbox를 일괄 변경하지 않는다. 현재 v0.4.1 Unity Batch는 Host Launch 승인/Usage 차단으로 시작되지 않았으며 이 체크리스트의 Phase 1/2 결과와 별개다.

## A. Package compile and Phase 0 regression

- [x] `unity-project`를 열었을 때 Phase 1 Package가 Compile되고 창이 동작한다. (사용자, `6000.3.21f1`)
- [x] `Window > TeamForge > Collaboration` 창이 열린다. (사용자)
- [ ] Server Address, 사용자 이름/색상, Project/Session을 저장하고 창을 다시 열어 값이 유지된다.
- [x] `Connecting → Handshaking → Connected`와 Bearer 인증이 정상이다. (사용자, Mini PC Docker)
- [x] Disconnect와 재접속이 정상이다. (사용자; 주소/포트 변경 재시험은 별도)
- [ ] Token은 Console/Export Log에 노출되지 않는다.

## B. Presence join and leave

- [x] 두 Editor가 같은 Project ID + Session ID에 연결하면 서로 한 번씩 보인다. (사용자)
- [ ] 이름과 사용자 색상이 양쪽에서 일치한다.
- [ ] 서로 다른 Session ID의 Editor는 목록에 보이지 않는다.
- [x] 한 Editor를 Disconnect하면 다른 쪽에서 퇴장이 반영된다. (사용자)
- [ ] 연결 중 Script Recompile 뒤 같은 사용자가 중복되지 않고 한 명으로 복원된다.
- [ ] Server `/health`의 `sessions`와 `presenceMembers`가 실제 값과 일치한다.

## C. Selection and Scene View

- [ ] 두 복사본에서 같은 저장 Scene을 연다.
- [ ] 저장된 Cube를 선택하면 다른 Editor에 이름·Wireframe·이름표가 보인다.
- [x] 선택 해제가 원격 Presence에 반영된다. (사용자)
- [x] **Frame Selection**이 로컬의 같은 GameObject를 선택하고 Frame한다. (사용자)
- [x] **Go to Camera**가 원격 Scene View 위치로 이동한다. (사용자; 세부 Orthographic 행렬은 미확인)
- [ ] Orthographic/Perspective 상태가 재현된다.
- [ ] 다른 Scene이 열려 Object를 해석할 수 없으면 Scene을 변경하지 않고 경고한다.
- [ ] 저장되지 않은 새 GameObject는 이름만 보이고 Frame 버튼은 비활성화된다.

## D. Throttle and editor safety

- [ ] Scene View를 계속 이동해도 기본 설정에서 송신이 대략 초당 5회를 넘지 않는다.
- [ ] 움직임이 없으면 기본 5초 Heartbeat 외 메시지 폭주가 없다.
- [ ] 수천 개 Object가 있는 Scene에서 선택 표시가 눈에 띄게 Editor를 멈추지 않는다.
- [ ] Presence 수신만으로 Scene Dirty 표시나 Undo 항목이 생기지 않는다.
- [ ] Play Mode 전환 중 잘못된 원격 GlobalObjectId 강조가 생기지 않는다.

## E. Failure and recovery

- [ ] Server 종료 시 제한된 Backoff가 보이고 Team Members가 안전하게 지워진다.
- [x] Server 재시작 뒤 자동 연결되고 새 Snapshot으로 팀원 목록이 복구된다. (사용자)
- [ ] Auto Reconnect 중 Disconnect를 누르면 재시도가 취소된다.
- [ ] 같은 UserSettings를 복제해 ID가 충돌하는 시험에서 새 연결이 기존 연결을 대체하며 오류가 명시된다.
- [ ] 잘못된 Token의 실제 Docker 거부를 확인한다. Protocol Version/Presence 숫자·Identity 거부는 Server 자동 Test로 확인됐다.

## F. EditMode tests

- [ ] Test Runner의 `EunSung.TeamForge.Editor.Tests`가 모두 통과한다.
- [ ] GlobalObjectId Probe 뒤 `Assets/__TeamForgePhase0Tests` 임시 폴더가 남지 않는다.
- [ ] 기존 열린 Scene이 저장·교체·Dirty 처리되지 않는다.

## 기록할 항목

- 정확한 Unity Version/OS와 두 프로젝트 복사 방식
- Server OS/Node Version
- 사용 주소와 Proxy/VPN 여부(Secret 제외)
- 성공/실패 항목과 Console/Server 오류 전문
- 재현 순서
- RTT와 관측 Presence 송신 빈도
- 저장/미저장 Object, Prefab/Additive 여부

## G. Phase 2 compile and negotiation

- [ ] Package `0.3.0`이 Console Compile Error 없이 로드된다.
- [ ] 연결 후 Transform Sync가 Enabled이고 Session Revision이 표시된다.
- [ ] 실제 Phase 1 Server `0.2.x` 연결 시 Presence는 유지되고 Transform 미지원이 명시된다. (Source상 호환, 실제 조합 미실행)
- [ ] 실제 Phase 1 Client `0.2.x`가 Server `0.3.x`에서 동작한다. (동일 Session Capability 필터는 Server 자동 Test 통과)

## H. Object lock

- [ ] 저장 Cube 선택 시 Lock owned가 표시된다.
- [ ] 다른 Editor에는 같은 Object의 소유자 이름/색상이 표시된다.
- [ ] 두 Editor가 동시에 선택하면 한쪽만 승인되고 다른 쪽은 명시적으로 거부된다.
- [ ] 거부된 Editor의 승인 전 로컬 Transform 변경은 기준값으로 복원된다.
- [ ] 선택 변경과 Release Selected Lock이 Lock을 해제한다.
- [ ] Client 강제 종료 뒤 기본 Lease 시간 안에 Lock이 해제된다.
- [ ] 같은 User ID 충돌 시 이전 연결의 Lock이 해제되고 자동 재접속 경쟁이 중단된다.

## I. Transform synchronization

- [ ] Position Drag 중 다른 Editor에 중간 상태와 최종 상태가 반영된다.
- [ ] Rotation과 Scale도 Local 값 기준으로 반영된다.
- [ ] 기본 설정에서 Transform 전송이 대략 초당 10회를 넘지 않는다.
- [ ] 부모가 있는 Object의 Local Transform이 동일하게 유지된다.
- [ ] 원격 적용이 다시 송신되어 메시지 Loop를 만들지 않는다.
- [ ] 같은 Operation 재전송이 Revision을 두 번 증가시키지 않는다.
- [ ] 늦게 참가한 Editor가 활성 Session의 최신 Revision/Transform/Lock Snapshot을 받는다.

## J. Scene and Undo safety

- [ ] 원격 Transform은 Scene Dirty를 표시한다.
- [ ] 원격 Transform은 로컬 일반 Undo로 되돌아가지 않는다.
- [ ] 원격 적용 대상의 과거 로컬 Undo는 제거되지만 다른 Object Undo는 유지된다.
- [ ] 동일한 원격 값을 다시 받아도 Scene은 Clean을 유지하고 stale Target Undo는 제거된다.
- [ ] Scene 안 Prefab Instance Transform Override가 Save/Reopen 뒤 유지된다.
- [ ] 자신의 Transform 편집은 기존 Unity Undo/Redo가 동작하고 새 상태가 동기화된다.
- [ ] Presence만 수신할 때는 여전히 Scene Dirty/Undo가 생기지 않는다.
- [ ] Play Mode에서는 Transform Sync가 비활성화된다.
- [ ] 저장되지 않은 Object는 Lock/Transform 대상이 되지 않고 안내가 표시된다.

## K. Phase 2 failure boundaries

- [ ] Server 재시작 시 메모리 Revision/Lock/Snapshot 소실 한계가 명확히 보인다.
- [ ] Revision Gap 주입 뒤 경고와 재접속 Snapshot 절차가 동작한다. (Unity UI만으로 주입 불가; Mock/Raw Server 필요)
- [x] 잘못된 Vector/Quaternion/Future Revision/비소유자 Update가 거부된다. (`server.test.mjs`: malformed/spoofed/future/conflicting test)
- [ ] 생성/삭제/이름 변경은 Phase 2에서 전파되지 않음이 명시된다.
- [ ] Parent 변경/Scene 이동은 오래된 Target으로 Final Transform을 보내지 않고 Lock 해제·차단된다.
- [ ] 시험 뒤 두 Scene을 저장하기 전에 의도한 최종 Transform인지 비교한다.

## L. Phase 2 baseline and recovery safety

- [ ] 처음 연결할 Scene을 저장·Reload해 Clean 상태로 만든 뒤 두 Editor가 같은 Object/Parent Baseline을 갖는다.
- [ ] Baseline 뒤 새 Object를 만들면 Lock/Transform이 비활성화되고 안내가 표시된다.
- [ ] 새 Object를 저장한 뒤 단순 Disconnect/Reconnect해도 자동으로 Baseline에 추가되지 않는다.
- [ ] 다중 선택 Gizmo와 Prefab Mode가 Transform Sync를 시작하지 않는다.
- [ ] 원격 값으로 Dirty가 된 Scene이 Network Reconnect/Script Recompile 뒤 기존 Baseline을 유지한다.
- [ ] 연결 전에 Dirty였고 Server Snapshot과 다른 Object는 덮어쓰지 않고 `protected conflict`로 표시된다.
- [ ] Conflict Object는 Deselect/Reselect해도 Lock을 다시 얻지 않으며 Save/Revert 후 Disconnect/Reconnect로만 해소된다.
- [ ] Lease 응답 지연/상실 때 Local Deadline에서 송신과 Lock이 안전 중지된다.
- [ ] Transform Drag 직후 즉시 Disconnect해도 Observer가 Final 값과 Lock Release를 받는다.

Raw Protocol 항목은 Unity UI 대신 `server/test/server.test.mjs`의 명명 Test로 자동 재현한다. Operation ID Payload Conflict/현재 Request ID, Resource Limit, Snapshot Byte Limit, Hello Timeout, non-Pong Heartbeat, 동일 Session Phase 1 Capability 격리는 자동 Test 결과를 Phase 2 보고서에 기록한다.
