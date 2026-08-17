# Phase 1 기술 결정 기록

## D-101 Presence Protocol 호환

**결정:** Protocol v1에 기능 협상과 Presence 메시지를 추가하되 Phase 0 Client의 메시지 순서를 유지한다.

**검토한 선택지:** Protocol Version 2로 즉시 전환, 모든 연결에 Snapshot 강제 전송, Hello의 `supportsPresence`로 선택적 활성화.

**선택한 방식:** `supportsPresence: true`인 Client만 Registry에 등록하고 `hello_ack` 뒤 Snapshot/Event를 전송한다.

**선택 이유:** Envelope와 기존 Ping/Pong 의미는 호환되며, Phase 0 Client가 Ack 다음 Pong을 기대하는 회귀 테스트도 유지된다.

**현재 알려진 단점:** 같은 Protocol Version 안에 기능 수준이 두 개라서 Hello Ack의 `presenceEnabled`를 확인해야 한다.

**교체가 필요한 조건:** Scene Operation이 Envelope나 순서 보장 규칙을 호환 불가능하게 바꿀 때.

**교체 시 영향 범위:** Hello DTO, Server Gate, Client Message Router, Protocol 문서.

**검증 방법:** Legacy Hello→Ping 테스트와 Presence Hello→Snapshot 테스트를 함께 실행.

## D-102 사용자와 오브젝트 식별

**결정:** 사용자 ID는 로컬 `UserSettings`에 안정적으로 저장하고, 원격 선택은 저장 Scene GameObject의 `GlobalObjectId`만 사용한다.

**검토한 선택지:** 연결 ID를 사용자 ID로 사용, OS 사용자 이름 사용, Runtime Instance ID, 임시 경로/Hierarchy 이름, 별도 협업 Component UUID.

**선택한 방식:** 최초 실행 시 GUID 사용자 ID를 만들고 Assembly Reload/재접속에 재사용한다. 선택 GameObject는 `GlobalObjectId.GetGlobalObjectIdSlow`가 Null ID가 아닐 때만 전송한다.

**선택 이유:** 연결 ID는 재접속마다 바뀌고 이름은 중복될 수 있다. Instance ID와 Hierarchy 경로는 Editor 간 동일성을 보장하지 않는다. Phase 1은 Scene에 Metadata Component를 추가하면 안 된다.

**현재 알려진 단점:** 저장 전 새 Object는 이름만 보이고 원격 Wireframe/Frame을 제공할 수 없다. Prefab/Additive/Scene 이동 행렬은 실제 Editor 검증 대기다.

**교체가 필요한 조건:** Phase 4 생성 Operation을 지원하거나 `GlobalObjectId` Probe가 목표 작업에서 불안정할 때.

**교체 시 영향 범위:** Object Identity와 향후 Registry/Operation DTO. Presence UI는 문자열 ID 경계를 유지할 수 있다.

**검증 방법:** 저장, 복제, 부모 변경, Scene Reload EditMode Probe와 미저장 Object 수동 시험.

## D-103 Presence 중요도와 전송 제한

**결정:** Presence는 전체 최신 상태를 낮은 중요도로 반복 전송하며 Operation Log에 저장하지 않는다.

**검토한 선택지:** 모든 Scene GUI Event 즉시 전송, Property별 Delta, 고정 60Hz, 변경 감지 Sampling + Heartbeat.

**선택한 방식:** 기본 5Hz Sampling, 값 변화 Threshold, 기본 5초 Heartbeat, 설정 가능 범위 1~20Hz/2~60초.

**선택 이유:** 카메라 Drag 중 메시지 폭주를 막고, Event 누락이나 패킷 지연은 다음 전체 상태가 자연스럽게 복구한다.

**현재 알려진 단점:** 최대 200ms 기본 표시 지연이 있고 Heartbeat는 연결 생존 판정용 Lease가 아니다.

**교체가 필요한 조건:** 실측에서 5Hz가 불편하거나 대규모 팀/고지연망에서 대역폭 문제가 확인될 때.

**교체 시 영향 범위:** Presence Service Sampling과 Settings/UI. Wire Payload는 유지 가능.

**검증 방법:** Server Update 방송 테스트, Unity Diagnostics TX 수동 관측, 향후 Network Emulation.

## D-104 원격 선택과 카메라 표시

**결정:** Scene View 표시는 `SceneView.duringSceneGui` + `Handles`로 구현하고 UI Toolkit 창은 팀원 탐색만 담당한다.

**검토한 선택지:** Hierarchy Icon만 표시, Custom Overlay, Gizmo Component 삽입, Handles Wireframe/Label.

**선택한 방식:** 해석 가능한 GameObject Renderer Bounds에 사용자 색상 Wire Cube/Label을 그리고, 버튼으로 Frame 또는 `SceneView.LookAtDirect`를 실행한다.

**선택 이유:** Scene Component나 파일을 변경하지 않고 Editor 전용 표시를 제공한다. 현재 3명 규모에 단순하고 제거 가능하다.

**현재 알려진 단점:** Renderer가 없는 Object는 Handle 크기 기반 작은 Box를 쓰며 복잡한 다중 Renderer Bounds가 넓을 수 있다. Follow 모드는 아직 없다.

**교체가 필요한 조건:** 표시 밀도·성능·UX 시험에서 Overlay/Hierarchy 통합이 더 적합할 때.

**교체 시 영향 범위:** Presence Service의 Scene GUI와 UI Card Action. Protocol에는 영향 없음.

**검증 방법:** Unity 6000.3에서 Renderer/빈 Object/비활성 Object, Perspective/Orthographic 수동 시험.

## D-105 서버 Presence 상태와 재접속

**결정:** Phase 1 Presence Registry는 메모리 전용이며 동일 사용자 ID의 새 연결이 오래된 연결을 대체한다.

**검토한 선택지:** SQLite 영속화, 연결마다 새 사용자로 등록, 중복 ID 거부, 새 연결이 기존 연결 대체.

**선택한 방식:** Project ID + Session ID별 `Map<userId, record>`를 사용하고 교체 시 이전 Socket을 `session_superseded`로 닫는다.

**선택 이유:** Presence는 복구 가능한 일시 상태이고, Assembly Reload 중 이전 Socket 정리가 늦어도 팀원 중복 없이 즉시 복원할 수 있다.

**현재 알려진 단점:** Server 재시작 시 Presence는 사라지며 Client 재접속 전까지 복구되지 않는다. `UserSettings`를 복제한 두 실제 Editor가 같은 ID로 동시에 접속하면 서로 대체한다.

**교체가 필요한 조건:** 역할/초대/오프라인 사용자 상태 또는 Phase 5 Operation 복구가 필요할 때.

**교체 시 영향 범위:** Server Session Registry와 인증 Identity. Presence DTO는 유지 가능.

**검증 방법:** Session 격리, Join/Update/Leave, Stable ID 재접속 자동 테스트.

## 요구사항 예외 기록: 팀원 Follow

**원래 계획:** 팀원 선택 시 Frame, 카메라 이동 또는 Follow 중 구현 가능한 기능 제공.

**발견한 예외:** 지속 Follow는 로컬 Scene View 조작과 원격 Camera Update가 서로 경쟁하는 해제 UX와 입력 우선순위가 필요하다.

**영향:** Phase 1에는 일회성 Frame Selection과 Go to Camera만 제공한다.

**선택한 대응:** 안전하게 취소 가능한 단발 동작을 먼저 검증한다.

**검토한 대안:** Toggle Follow, 일정 시간 자동 추적, 로컬 입력 시 자동 해제.

**남은 한계:** 원격 사용자를 실시간으로 계속 따라가지는 않는다.

**원래 계획으로 되돌릴 수 있는 조건:** 단발 카메라 이동이 Unity 6.3에서 안정적으로 검증되고 Follow 해제 UX가 정해질 때.
