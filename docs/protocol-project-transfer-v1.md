# TeamForge Project Transfer Protocol v1

이 문서는 Realtime Protocol v1에 추가되는 작은 Coordinator Metadata 메시지와 별도 Direct Project Transfer v1을 정의한다. Project Payload Byte는 기존 WebSocket JSON에 포함하지 않는다.

## Version

| 계약 | 값 |
| --- | --- |
| Product | `0.4.1` |
| Realtime Envelope | `1` |
| Transfer Protocol | `1` |
| Manifest Schema | `1` |
| Hash | SHA-256 lowercase hex |
| Signature | Ed25519 |

## Hello Capability

`hello.supportsProjectTransfer=true`를 보낸 Client만 Project Coordinator Event를 받는다. Server는 `hello_ack.projectTransferEnabled`로 승인 여부를 알린다. Project Transfer capability는 Presence 없이도 협상할 수 있다. Presence/Transform/Hierarchy capability 규칙은 Realtime Protocol v1을 그대로 따르며, Phase 0~2 Client가 `supportsProjectTransfer`를 보내지 않으면 Project Event를 받지 않는다.

## Peer Announcement

```json
{
  "type": "project_peer_announce",
  "protocolVersion": 1,
  "requestId": "request-id",
  "userId": "stable-user-id",
  "projectUuid": "b3b67aa1-524b-4d69-b7f3-82448f45770c",
  "baselineRevision": 3,
  "manifestHash": "64-hex",
  "descriptorHash": "64-hex",
  "completeBaseline": true,
  "availableChunkCount": 120,
  "totalChunkCount": 120,
  "endpoint": "http://192.168.0.40:5091/teamforge-transfer/v1",
  "transferToken": "ephemeral-random-token",
  "unityVersion": "6000.3.21f1",
  "teamForgePackageVersion": "0.4.1",
  "transferProtocolVersion": 1,
  "manifestSchemaVersion": 1,
  "ownerKeyId": "64-hex",
  "ownerPublicKey": "base64-spki",
  "publisherKeyId": "64-hex",
  "publisherPublicKey": "base64-spki",
  "publisherAuthorization": "base64-signature-or-empty",
  "baselineSignature": "base64-signature",
  "ownerProofSignature": "base64-signature-or-empty"
}
```

Peer Endpoint와 Token은 같은 Project ID + Session ID의 Project-capable Client에게만 전달한다. Server의 Project Registry는 Manifest/Chunk Byte나 파일 내용/경로를 저장하지 않는다.

## Coordinator 응답 Shape

- `project_registry_snapshot`: `projectId`, `projectUuid`, `baseline|null`, `peers[]`, `serverTimestampUnixMs`
- `project_peer_joined`, `project_peer_updated`, `project_peer_left`: 마지막 전체 `peer`와 `serverTimestampUnixMs`
- `project_baseline_changed`: `baseline`, `idempotent`, `serverTimestampUnixMs`
- `project_sync_required`: `reason`, `baseline`, `serverTimestampUnixMs`

`baseline`은 Identity/Revision/Manifest·Descriptor Hash/호환 Version/Owner·Publisher 공개키·승인·서명과 게시 Connection/User/시각만 포함한다. `peer`는 Connection/User/Endpoint/Token/보유 Chunk 수, Descriptor/Owner Proof 검증 결과, `seedRank`, 광고 시각을 포함한다. Peer Endpoint/Token Event는 같은 Session에만 한정한다. Payload가 없는 최신 Baseline Summary는 Project 전역이므로 같은 Project의 다른 Session에도 `project_baseline_changed`로 전달할 수 있다.

Hello Event 순서는 실제 Protocol v1 Router와 동일하다: `hello_ack → presence_snapshot(협상 시) → hierarchy_snapshot(협상 시) → transform_snapshot(협상 시) → project_registry_snapshot(협상 시)`. Hierarchy는 Presence와 Transform Sync가 함께 협상된 경우에만 활성화된다. Presence를 협상하지 않은 Standalone Project Peer는 `hello_ack → project_registry_snapshot`만 받는다. 협상되지 않은 Snapshot은 생략되며, 이 문장은 기존 Wire 의미를 변경하지 않고 현재 구현 순서를 명시한다.

## Baseline Publish

`project_baseline_publish`는 자동 변경 감지가 아니라 사용자의 명시적 Publish 작업만 보낸다. 처음 Baseline은 Revision 1이고, 이후에는 Server가 가진 현재 Revision의 정확한 다음 값만 허용한다. 같은 Revision+Manifest 재전송은 멱등이고 다른 Hash는 충돌이다.

서명 Canonical Payload는 UTF-8 LF로 결합한다.

```text
teamforge-baseline-v1
<projectId>
<projectUuid>
<baselineRevision>
<manifestHash>
<unityVersion>
<teamForgePackageVersion>
<realtimeProtocolVersion>
<transferProtocolVersion>
<manifestSchemaVersion>
<ownerKeyId>
<publisherKeyId>
```

`descriptorHash`는 위 Canonical Payload UTF-8 Byte의 SHA-256 lowercase hex다. Publisher의 `baselineSignature`도 정확히 같은 Byte를 서명한다. JSON Property 순서나 공백은 Descriptor Hash에 영향을 주지 않는다.

Publisher가 Owner와 다르면 Owner는 `teamforge-publisher-v1\n<projectUuid>\n<publisherKeyId>`에 서명한다. `ownerPublicKey`는 항상 필요하며 Server는 Owner/Publisher SPKI에서 각 SHA-256 Key ID를 다시 계산한다. Server는 Publisher Authorization과 Baseline Signature를 검증한 뒤 Metadata만 교체한다.

Owner Preferred Seed Proof의 Canonical Payload:

```text
teamforge-owner-proof-v1
<projectId>
<projectUuid>
<connectionId>
<baselineRevision>
<manifestHash>
<endpoint>
<transferToken>
```

Owner Proof는 Owner private key로 서명한다. Endpoint나 Token을 다른 연결에서 재사용해 Owner Rank를 얻지 못하도록 현재 Connection에 바인딩한다. Replica/Partial Peer는 빈 Owner Proof를 보낸다.

## Seed Ordering

Snapshot의 Peer는 `seedRank`, 관측 Latency/가용성, Connection ID의 결정적 순서로 정렬한다.

- 0: 최신 완전 Baseline + 검증된 Owner Proof
- 1: 최신 완전 Baseline + 검증된 Descriptor
- 2: 최신 부분 Chunk + 검증된 Descriptor
- 3: 기준이 없을 때의 명시적 Bootstrap Publisher
- 99: 오래됐거나 호환되지 않아 Download Source가 될 수 없음

## Direct HTTP

모든 응답은 `cache-control: no-store`, `x-content-type-options: nosniff`를 사용한다. Chunk는 `application/octet-stream`, Descriptor/Manifest/Inventory는 `application/json`이다. 요청은 `Authorization: Bearer <peer-token>`, `X-TeamForge-Project-UUID`, `X-TeamForge-Manifest-Hash`, `X-TeamForge-Session-ID`를 포함한다. Peer는 네 값을 모두 일치시켜 다른 Project/Session의 요청을 fail-closed로 거부한다.

Manifest와 Descriptor 응답은 구성된 크기 상한을 넘으면 거부한다. Chunk 경로는 정확한 64자리 Hash만 허용하며 상대 경로나 파일명을 받지 않는다.

### v0.4.1 일시 오류 계약

Transfer Schema는 v1을 유지하며 Retry는 HTTP/Client 정책의 호환 가능한 보강이다.

| 분류 | 예 | 처리 |
| --- | --- | --- |
| 일시 | 408, 425, 429, 500, 502, 503, 504, Timeout, Reset, 제한된 Fetch Network 오류 | `Retry-After` 우선, 제한된 지수 Backoff/Jitter, 다른 Peer가 있으면 전환 |
| Peer/Chunk 영구 | 404 Chunk, 손상 Chunk, 잘못된 Content Type/크기 | 같은 Peer+Chunk 즉시 반복 금지, 다른 Peer만 시도 |
| 권한/Identity 영구 | 400/401/403/409/413, Project/Session/Manifest 불일치, 서명/Publisher 불일치 | 같은 Peer 재시도 금지, 모든 Peer가 실패하면 Active 불변 상태로 중단 |

429와 일시적인 busy 503은 `Retry-After`를 제공한다. 진단에는 Token/Authorization/raw body를 넣지 않으며 Chunk Hash는 앞 12자만 표시한다. 이 정책은 Payload나 Manifest Schema를 바꾸지 않으므로 Transfer Protocol은 계속 `1`이다.

## Download 상태

`Discovering → Downloading → Verifying → AwaitingTrust → Activating → Complete` 순서다. 직접 Peer가 없으면 `BaselineUnavailable`, 모든 직접 Endpoint가 실패하면 `DirectTransferUnavailable`, Hash/서명/Path/호환성 오류는 `Rejected`가 된다. 실패 상태에서 기존 Active Pointer는 바꾸지 않는다.
