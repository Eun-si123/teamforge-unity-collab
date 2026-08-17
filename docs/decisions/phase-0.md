# Phase 0 기술 결정 기록

## D-001 Unity 패키지 경계

**결정:** Scene 기능을 넣기 전에 연결 MVP를 Editor 전용 UPM 패키지로 분리한다.

**검토한 선택지:** 프로젝트 `Assets/Editor` 직접 삽입, Editor 전용 UPM, Runtime+Editor 이중 Assembly.

**선택한 방식:** `com.eunsung.teamforge`의 단일 Editor Assembly와 별도 Test Assembly.

**선택 이유:** Phase 0에는 런타임 코드가 없고, 재사용·제거·의존성 경계가 명확하다.

**현재 알려진 단점:** Package Test를 보이려면 소비 프로젝트의 `testables` 설정이 필요하다.

**교체가 필요한 조건:** 게임 실행 중 Presence나 Runtime Client가 실제 요구될 때.

**교체 시 영향 범위:** Protocol DTO를 Runtime Assembly로 이동하고 Editor Assembly가 이를 참조한다.

**검증 방법:** package/asmdef JSON 정적 검증, Unity 6000.3 EditMode 컴파일·테스트(현재 Editor 부재로 대기).

## D-002 Editor UI

**결정:** Phase 0 UI 체계는 하나만 사용한다.

**검토한 선택지:** IMGUI, UI Toolkit, UXML/USS 기반 UI Toolkit.

**선택한 방식:** C#으로 구성한 UI Toolkit `EditorWindow`.

**선택 이유:** Unity 6.3의 공식 EditorWindow 흐름이며, UXML Asset GUID 관리 없이 작은 MVP를 유지할 수 있다.

**현재 알려진 단점:** UI가 커지면 C# 레이아웃이 장황하고 디자이너 협업이 불편하다.

**교체가 필요한 조건:** Presence/History 화면이 복잡해져 UXML 재사용과 스타일 테마가 실질적으로 필요할 때.

**교체 시 영향 범위:** UI 폴더만 교체하며 Connection Service와 Transport에는 영향이 없다.

**검증 방법:** Unity 6.3 창 열기, Dock/Reload/입력 보존 수동 시험(대기).

## D-003 Transport

**결정:** 첫 Transport 하나를 완성한 뒤 필요할 때만 대체 구현을 추가한다.

**검토한 선택지:** SignalR Client, 제3자 Unity WebSocket DLL, `ClientWebSocket`, HTTP Polling.

**선택한 방식:** .NET Standard의 `System.Net.WebSockets.ClientWebSocket`과 얇은 `IRealtimeTransport` 경계.

**선택 이유:** Unity 패키지에 외부 DLL이 필요 없고 표준 WSS/Reverse Proxy와 맞으며, 서버 구현 언어에 종속되지 않는다.

**현재 알려진 단점:** Unity Editor/OS별 WebSocket 구현 차이를 실기기에서 확인해야 하며 SignalR의 자동 Hub 기능은 없다.

**교체가 필요한 조건:** 특정 지원 OS에서 반복 가능한 `ClientWebSocket` 결함 또는 Proxy 비호환이 확인될 때.

**교체 시 영향 범위:** Transport 구현과 조립부. Protocol/Service/UI는 유지한다.

**검증 방법:** Node `ws` 서버 자동 테스트 완료, Unity Editor 연결 테스트 대기.

## D-004 메시지 직렬화

**결정:** Phase 0 메시지는 명시적 DTO의 UTF-8 JSON이다.

**검토한 선택지:** `JsonUtility`, System.Text.Json, Newtonsoft.Json, MessagePack/Protobuf.

**선택한 방식:** Unity 내장 `JsonUtility`; Server는 표준 `JSON.parse/stringify`.

**선택 이유:** 추가 Unity 의존성이 없고 현재 작은 고정 Schema에 충분하다.

**현재 알려진 단점:** Dictionary, 다형성, 선택 필드 처리와 Schema 진화 능력이 제한적이다.

**교체가 필요한 조건:** Scene Operation에서 Map/Union/정밀한 누락 필드 처리가 필요하거나 JSON 크기가 병목으로 측정될 때.

**교체 시 영향 범위:** Protocol Codec 경계와 테스트 Fixture. Transport 자체는 유지한다.

**검증 방법:** Server Wire 테스트 완료, Unity JsonUtility EditMode Round-trip 테스트 소스 작성(실행 대기).

## D-005 서버 기술

**결정:** 이 환경에서 실제 빌드·테스트할 수 있는 최소 서버를 우선한다.

**검토한 선택지:** ASP.NET Core/SignalR, Node.js+`ws`, Unity 내 임베디드 호스트.

**선택한 방식:** Node.js 20+ HTTP 서버와 `ws` 8.21.1.

**선택 이유:** 현재 환경에 Node 24가 있고 .NET SDK가 없어 즉시 통합 검증할 수 있었다. 표준 WebSocket이므로 Unity Client는 서버 언어를 모른다.

**현재 알려진 단점:** 향후 복잡한 권한·DB 모델에서 C# 도메인 모델 공유 이점이 없고 npm 의존성 하나가 생긴다.

**교체가 필요한 조건:** Operation/Revision 저장 계층에서 ASP.NET 생태계가 측정 가능한 유지보수 이점을 주거나 운영팀 표준이 바뀔 때.

**교체 시 영향 범위:** Server 폴더. Wire Protocol을 유지하면 Unity 패키지는 영향이 없다.

**검증 방법:** Node 자동 테스트 5개와 독립 스모크 테스트 통과.

## D-006 오브젝트 식별의 초기 방향

**결정:** Phase 0 연결 코드는 Scene 오브젝트를 식별하거나 수정하지 않는다. Phase 2 전 검증 전략만 고정한다.

**검토한 선택지:** Instance ID, `GlobalObjectId`, 별도 협업 UUID, Scene 외부 Registry.

**선택한 방식:** 저장된 Scene 오브젝트는 `GlobalObjectId`를 1차 후보로 하고, 아직 저장되지 않은 생성 Operation에는 서버 발급/승인 협업 UUID를 조합하는 방향. Instance ID는 금지한다.

**선택 이유:** 공식 API상 `GlobalObjectId`는 Scene Asset GUID와 로컬 식별자를 포함하지만, 새 오브젝트가 여러 Editor에 생기기 전에는 공통 ID가 존재하지 않는다.

**현재 알려진 단점:** Prefab, Additive Scene, Scene 복제·이동, 삭제/복원의 안정성은 실제 Editor 검증 전이다.

**교체가 필요한 조건:** 작성한 GlobalObjectId Probe가 재시작·복제·부모 변경에서 안정성을 충족하지 못할 때.

**교체 시 영향 범위:** 향후 Object Registry와 Operation DTO. Phase 0 연결 코드는 영향이 없다.

**검증 방법:** 저장·복제·부모 변경·Scene Reload를 검사하고 임시 Asset을 정리하는 EditMode Probe 작성 완료, 실행 대기. 이후 Prefab/Additive/Scene rename 행렬을 확장한다.

## D-007 설정 저장

**결정:** 개인 연결값과 토큰을 공유 ProjectSettings나 소스에 넣지 않는다.

**검토한 선택지:** 코드 상수, EditorPrefs, `ProjectSettings`, `UserSettings`의 ScriptableSingleton.

**선택한 방식:** `UserSettings/TeamForgeSettings.asset`에 프로젝트별 로컬 저장.

**선택 이유:** Assembly Reload/Editor 세션 사이 유지되면서 일반적인 Version Control 공유 대상에서 제외된다.

**현재 알려진 단점:** 토큰은 OS 보안 저장소가 아닌 로컬 평문이다. 여러 연결 프로필도 아직 없다.

**교체가 필요한 조건:** 공개 서비스 인증 또는 여러 계정/서버 Profile이 필요할 때.

**교체 시 영향 범위:** Settings 및 UI. Token Provider 경계 추가가 필요하다.

**검증 방법:** 공식 `ScriptableSingleton`/`FilePath` API 확인, Reload 후 값 유지 수동 테스트 대기.

## D-008 Assembly Reload 복구

**결정:** 소켓 자체를 Reload 너머로 유지하지 않고 연결 의도만 보존한다.

**검토한 선택지:** 정적 소켓 유지, `InitializeOnLoad` 자동 재연결, 사용자가 매번 수동 연결.

**선택한 방식:** `beforeAssemblyReload`에서 Transport를 Abort하고 로컬 Resume Flag 저장, 새 Domain의 `delayCall`에서 새 연결 생성.

**선택 이유:** 이전 Assembly의 Callback/Task가 새 Domain 객체를 건드리는 위험을 줄인다.

**현재 알려진 단점:** Reload 순간 연결이 끊기고 Phase 0에는 누락 Operation 복구가 없다.

**교체가 필요한 조건:** Phase 5 Revision 복구가 추가될 때 Resume Hello에 마지막 Revision을 포함해야 한다.

**교체 시 영향 범위:** Connection Service와 Hello DTO.

**검증 방법:** 공식 Reload Event API 확인, Unity 수동 Script Recompile 시나리오 대기.

## D-009 최소 지원 OS와 테스트

**결정:** OS를 코드로 세 명의 현재 PC에 고정하지 않는다.

**검토한 선택지:** Windows 전용, 현재 Ubuntu 서버 전용, Unity/Node가 지원되는 Desktop+Server OS.

**선택한 방식:** Unity Editor 측은 Unity 6.3이 지원하는 Windows/macOS/Linux, 서버는 Node 20+ Linux/Windows/macOS를 목표로 한다.

**선택 이유:** 사용 API가 표준 HTTP/WebSocket이며 플랫폼 전용 호출이 없다.

**현재 알려진 단점:** 현재 실측은 Linux Node 24 서버뿐이다. Unity와 Docker, Windows/macOS는 미검증이다.

**교체가 필요한 조건:** 플랫폼별 TLS 인증서 저장소나 Proxy 동작 차이가 재현될 때.

**교체 시 영향 범위:** 호환성 문서, CI Matrix, 필요 시 Transport 구현.

**검증 방법:** 현재 Node 자동/통합 테스트, 이후 Unity 6000.3 Windows 우선 + 두 PC/LAN 행렬.
