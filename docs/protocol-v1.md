# TeamForge Wire Protocol v1

Protocol v1은 UTF-8 JSON Text WebSocket 메시지만 사용한다. 서버 기본 경로는 `/ws`지만 서버 환경 변수와 Unity의 상대 Realtime Path로 변경할 수 있다. Phase 1~4는 호환 불가능한 Envelope 변경 없이 Capability별 메시지를 추가했으므로 Protocol Version은 `1`을 유지한다. Phase 3 Project Coordinator와 별도 Payload 전송은 [Project Transfer Protocol v1](protocol-project-transfer-v1.md)에 정의한다.

## 공통 Envelope

| 필드 | 형식 | 설명 |
| --- | --- | --- |
| `type` | string | 메시지 종류 |
| `protocolVersion` | integer | 현재 `1` |
| `requestId` | string | 요청·응답 상관관계 ID; Server Event는 빈 문자열 가능 |

Client의 첫 애플리케이션 메시지는 항상 `hello`다. Version 불일치, Binary, 잘못된 JSON은 Protocol Error 후 연결을 닫는다.

Upgrade 뒤 기본 10초 안에 Hello가 없으면 Server가 연결을 종료한다. Hello 이후 Server는 기본 15초마다 WebSocket Ping Control Frame을 보내고 45초 동안 Pong이 없으면 연결·Presence·Lock을 정리한다. 이 Control Frame은 아래 JSON Ping/Pong RTT 메시지와 별개다.

## Hello와 기능 협상

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "requestId": "d63b...",
  "userName": "Editor A",
  "projectId": "sample-project",
  "sessionId": "phase-1",
  "supportsPresence": true,
  "supportsTransformSync": true,
  "supportsProjectTransfer": true,
  "supportsHierarchySync": true,
  "userId": "d16ab76ce4604e979c8be85fe566655d",
  "userColor": "#64B5F6"
}
```

응답:

```json
{
  "type": "hello_ack",
  "protocolVersion": 1,
  "requestId": "d63b...",
  "connectionId": "server-generated-uuid",
  "serverVersion": "0.5.0",
  "serverTimestampUnixMs": 1785600000000,
  "presenceEnabled": true,
  "transformSyncEnabled": true,
  "projectTransferEnabled": true,
  "hierarchySyncEnabled": true,
  "userId": "d16ab76ce4604e979c8be85fe566655d",
  "userColor": "#64B5F6"
}
```

`supportsPresence`가 없거나 `false`인 Phase 0 Client에는 `hello_ack` 뒤 Presence Event를 보내지 않는다. `supportsTransformSync`가 없거나 `false`인 Phase 1 Client에는 Transform/Lock Event를 보내지 않는다. `supportsProjectTransfer`가 없거나 `false`인 Phase 0~2 Client에는 Project Registry/Peer Event를 보내지 않는다. Transform Sync는 Presence를 요구하지만 Project Transfer는 Project가 없는 Standalone Peer를 위해 Presence 없이도 협상할 수 있다. `supportsHierarchySync`는 Presence와 Transform Sync를 모두 요구한다. Hierarchy-capable Client는 Hello 뒤 Presence Snapshot, Hierarchy Snapshot, Transform Snapshot 순서로 authoritative 상태를 받는다. Phase 4 authoritative Scene에서는 Hierarchy를 협상하지 않은 Phase 2-only Client의 Transform/Lock 권한 요청을 거부한다.

## Ping/Pong

```json
{
  "type": "ping",
  "protocolVersion": 1,
  "requestId": "990a...",
  "clientTimestampUnixMs": 1785600000000
}
```

```json
{
  "type": "pong",
  "protocolVersion": 1,
  "requestId": "990a...",
  "clientTimestampUnixMs": 1785600000000,
  "serverTimestampUnixMs": 1785600000001
}
```

RTT는 벽시계 차이가 아니라 Client의 단조 증가 `Stopwatch`로 계산한다.

## Presence Snapshot과 Event

Hello Ack 직후 Server는 참여 Client에게 같은 Project/Session의 전체 상태를 보낸다.

```json
{
  "type": "presence_snapshot",
  "protocolVersion": 1,
  "requestId": "d63b...",
  "members": [
    {
      "userId": "editor-a",
      "connectionId": "connection-a",
      "displayName": "Editor A",
      "color": "#64B5F6",
      "sceneId": "scene-asset-guid",
      "sceneName": "SampleScene",
      "selectedObjectId": "GlobalObjectId_V1-2-...",
      "selectedObjectName": "Cube",
      "hasSceneView": true,
      "cameraPosition": { "x": 1, "y": 2, "z": 3 },
      "cameraRotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
      "cameraPivot": { "x": 0, "y": 0, "z": 0 },
      "cameraSize": 10,
      "cameraOrthographic": false,
      "activity": "Selecting",
      "lastHeartbeatUnixMs": 1785600000000
    }
  ],
  "serverTimestampUnixMs": 1785600000000
}
```

증분 Event:

- `user_joined`: `presence` 한 건 포함
- `presence_updated`: `presence` 한 건 포함
- `user_left`: `userId`, `connectionId`, `serverTimestampUnixMs` 포함

표시 이름과 색상은 Hello에서 고정되고 Presence Update가 임의로 다른 사용자 ID를 수정할 수 없다.

## Presence Update

Client는 전체 현재 상태를 보내므로 패킷 하나가 유실되거나 늦어져도 다음 Update/Heartbeat가 최신 상태를 덮는다.

```json
{
  "type": "presence_update",
  "protocolVersion": 1,
  "requestId": "4cc1...",
  "userId": "editor-a",
  "sceneId": "scene-asset-guid",
  "sceneName": "SampleScene",
  "selectedObjectId": "GlobalObjectId_V1-2-...",
  "selectedObjectName": "Cube",
  "hasSceneView": true,
  "cameraPosition": { "x": 1, "y": 2, "z": 3 },
  "cameraRotation": { "x": 0, "y": 0, "z": 0, "w": 1 },
  "cameraPivot": { "x": 0, "y": 0, "z": 0 },
  "cameraSize": 10,
  "cameraOrthographic": false,
  "activity": "Selecting"
}
```

Server는 문자열 길이, `#RRGGBB`, 유한 숫자, 좌표/Camera Size 안전 한도, 사용자 ID 일치를 확인한다. `lastHeartbeatUnixMs`는 Client 값이 아니라 Server 수신 시각으로 기록한다.

## Phase 2 Transform Snapshot

Transform-capable Client는 Hello Ack와 Presence Snapshot 다음에 transform_snapshot을 받는다.

| 필드 | 형식 | 설명 |
| --- | --- | --- |
| serverRevision | non-negative integer | 현재 Session 전역 Revision |
| transforms | array | Object별 최신 transform_applied 한 건 |
| locks | array | 아직 만료되지 않은 Object Lock |
| serverTimestampUnixMs | integer | 서버 Snapshot 시각 |

Snapshot은 활성 Session의 메모리 상태다. 마지막 사용자가 나가거나 Server가 재시작하면 사라지며 영속 복구를 의미하지 않는다. Server 기본 Snapshot 상한은 900 KiB이고 Unity 수신 상한 1 MiB보다 작다. 상한을 넘길 Operation은 Revision 증가 전에 거부한다.

## Object Lock

Client는 저장 Scene Object를 편집하기 전에 lock_request를 보낸다. 공통 Target 필드는 userId, sceneId, objectId다.

- lock_granted: 요청자에게 lockState 반환
- lock_denied: 요청자에게 reason과 현재 lockState 반환
- lock_state_changed: 다른 Transform-capable Client에게 새/갱신 Lock 전파
- lock_release: 소유 Client의 명시적 해제 요청
- lock_released: 해제, 연결 종료, 동일 사용자 새 연결, Lease 만료를 전파

lockState는 sceneId, objectId, ownerUserId, ownerConnectionId, ownerDisplayName, ownerColor, expiresAtUnixMs를 포함한다. Server 기본 Lease는 15초이며 설정할 수 있다. User ID가 같아도 현재 Connection ID가 다르면 Lock 소유자가 아니다.

## Transform Update와 Revision

transform_update 필드:

| 필드 | 설명 |
| --- | --- |
| operationId | Client 생성 멱등 ID |
| userId | Hello에서 협상한 사용자 ID |
| sceneId / objectId | 저장 Scene과 GlobalObjectId |
| baseRevision | Client가 마지막으로 관측한 Server Revision |
| localPosition | x/y/z |
| localRotation | x/y/z/w, 사용할 수 있는 Quaternion |
| localScale | x/y/z |

Server는 현재 Connection이 해당 Object Lock을 소유할 때만 승인한다. 승인 시 Session Revision을 1 증가시키고 모든 Transform-capable Client에 transform_applied를 방송한다. 응답에는 원 요청 필드와 serverRevision, serverTimestampUnixMs가 포함된다.

같은 `operationId`의 동일한 User/Target/Base Revision/Position/Rotation/Scale 재전송은 이전 `transform_applied`를 현재 `requestId`와 함께 요청자에게 다시 보내며 Revision을 증가시키지 않는다. 의미 Payload가 하나라도 다르면 `operation_id_conflict`다. `baseRevision`이 Server보다 미래면 `revision_ahead`로 거부한다. 오래된 Session `baseRevision`은 Object Lock이 동시 쓰기를 직렬화하고 10Hz Pipeline이 RTT Ack를 기다리지 않으므로 Phase 2에서 허용한다. Lock 인계 뒤 오래된 상태까지 막는 Object Revision/Lock Token은 아직 없다.

## Phase 4 Hierarchy Snapshot과 Seed

Hierarchy Sync는 저장된 깨끗한 Scene에서 초기 authoritative seed를 만들고, 이후 late join Client에 `hierarchy_snapshot`을 보낸다. Hierarchy와 Transform은 같은 Session `serverRevision`을 공유한다.

`hierarchy_snapshot` 필드:

| 필드 | 형식 | 설명 |
| --- | --- | --- |
| `serverRevision` | non-negative integer | 현재 Session 전역 Revision |
| `sceneIds` | string array | authoritative hierarchy로 알려진 Scene ID. Object가 0개인 Scene도 포함 |
| `objects` | object array | 현재 authoritative hierarchy object records |
| `tombstones` | object array | 삭제된 identity records |
| `serverTimestampUnixMs` | integer | Server snapshot 시각 |

Object record는 `sceneId`, `objectId`, `name`, `parentObjectId`, `siblingIndex`, `localPosition`, `localRotation`, `localScale`, `createdRevision`, `hierarchyRevision`을 가진다. 저장 baseline Object는 `GlobalObjectId`를 사용하고, active Session에서 새로 만든 Object는 `tf:<32 lowercase hex>` logical ID를 사용한다. Object name/Hierarchy path/Instance ID는 identity가 아니다.

`hierarchy_seed`는 `userId`, `sceneId`, `baseRevision`, clean saved Object records를 포함한다. 초기 clean seed의 Object ID는 logical `tf:` ID가 아니어야 한다. 같은 의미의 seed 재전송은 idempotent하게 처리되며, authoritative state와 다른 seed는 fail-closed conflict다.

## Phase 4 Hierarchy Operations

Client `hierarchy_operation`은 다음 공통 필드를 가진다.

- `operationId`
- `userId`
- `kind`
- `sceneId` / `objectId`
- `baseRevision`

Operation kind는 `create_object`, `delete_object`, `rename_object`, `reparent_object`, `reorder_sibling`이다. Create/reparent는 authoritative local Transform을 함께 보낸다.

Hierarchy operation은 Transform과 달리 **정확한** `baseRevision == serverRevision`을 요구한다. 승인되면 Session Revision을 1 증가시키고 `hierarchy_applied`를 Hierarchy-capable Client에 방송한다. 응답에는 `changedObjects`, `deletedObjectIds`, 새 `serverRevision`이 포함된다.

구조 충돌/안전 거부는 `hierarchy_conflict` 또는 공통 `error`로 fail closed한다. 주요 사유는 stale revision, missing parent, parent cycle, reused/deleted logical ID, unseeded Scene, 다른 Connection이 가진 target/parent/subtree lock, object/snapshot safety limit이다.

Sibling order는 Server에서 deterministic canonical index로 재번호화한다. Delete는 authoritative subtree를 함께 제거하고 Tombstone을 남기며 해당 identity의 retained Transform/Lock과 stale Presence selection을 정리한다. Tombstone된 identity는 같은 Session에서 다시 Create할 수 없다.

## Phase 4 Older-client Authority Guard

Scene이 Phase 4 hierarchy seed를 받아 authoritative `sceneIds`에 들어간 뒤, Hierarchy capability가 없는 Phase 2 Client의 해당 Scene Transform/Lock authority request는 거부된다. 이는 older Client가 이해하지 못하는 create/delete/reparent 상태 위에 stale Transform을 쓰는 것을 막기 위한 호환성 경계다. Presence/RTT 등 협상된 구버전 기능은 계속 동작한다.

## Error

```json
{
  "type": "error",
  "protocolVersion": 1,
  "requestId": "optional-correlated-id",
  "code": "presence_identity_mismatch",
  "message": "Presence updates can only modify the identity negotiated by this connection."
}
```

주요 Phase 4 오류에는 `invalid_hierarchy_seed`, `invalid_hierarchy_operation`, `hierarchy_identity_mismatch`, `hierarchy_sync_not_negotiated`, `hierarchy_sync_required`, `hierarchy_object_deleted`, `hierarchy_object_missing`이 있다.

주요 Presence 오류는 `invalid_presence`, `presence_not_negotiated`, `presence_identity_mismatch`, `presence_not_registered`, `session_superseded`다. Phase 2 오류는 `invalid_lock_request`, `lock_identity_mismatch`, `lock_not_owned`, `invalid_transform`, `transform_identity_mismatch`, `lock_required`, `revision_ahead`, `operation_id_conflict`, `connection_lock_limit`, `session_lock_limit`, `session_object_limit`, `snapshot_size_limit`, `snapshot_too_large`다.

## 제한과 향후 호환

- Server 최대 입력 크기 기본값: 1,048,576 bytes, 설정 가능
- Unity Client 최대 수신 안전 한도: 1 MiB
- Server Transform Snapshot 기본 상한: 900 KiB
- Server Hierarchy 기본 상한: 2,048 objects, 4,096 tombstones, 1 MiB snapshot, depth 256, name 128 characters
- Server 연결별 메시지 빈도 기본값: 초당 60개, 설정 가능
- Session 최신 Transform 512개, Connection Lock 8개, Session Lock 256개가 기본 상한이다.
- 느린 Client의 Server 발신 Buffer가 기본 1 MiB를 넘으면 해당 연결을 종료한다.
- Presence, Phase 2 Transform/Lock, Phase 4 Hierarchy/Tombstone Snapshot은 메모리 전용이다. Server restart recovery는 Phase 5 범위다.
- 알 수 없는 Server 메시지는 경고 후 무시한다.
- Scene Operation을 추가할 때 `type`을 늘리고, 호환 불가능한 Envelope 변경에만 `protocolVersion`을 올린다.
- 신뢰할 수 없는 타입 이름이나 임의 CLR 타입을 역직렬화하지 않는다.
