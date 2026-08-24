# TeamForge 현재 상태

[English](STATUS.md) | **한국어**

_공개 소스, GitHub Actions 증거, 기록된 실제 두 PC Field evidence 기준 마지막 검토: 2026-08-25 (Asia/Seoul)_

현재 제품 버전: `0.5.1`  
현재 Release ID: `0.5.1-wp5.1-path-resilience`  
현재 Packaged Candidate 태그: `v0.5.1-prealpha-wp5.1-r2`  
현재 Candidate 상태: **FIELD BLOCKED**

제품 버전, Release ID, Packaged artifact identity는 서로 다른 개념입니다. 정확한 Artifact는 `0.5.1`만으로 식별하지 않고 Release tag + 파일명 + SHA-256으로 식별합니다.

> [!WARNING]
> **초기 공개 프리뷰 — 소스와 패키지 Candidate는 공개되어 있지만 일반 설치를 권장하는 단계는 아닙니다.**
>
> TeamForge는 아직 안정화 중입니다. 테스트할 때는 Backup을 유지하고 가능하면 disposable Unity project를 사용하세요. 패키지 Candidate가 존재하고 자동 테스트가 통과했다는 사실만으로 Production-ready가 되는 것은 아닙니다.

이 문서는 **지금 무엇이 구현되어 있고, 무엇이 자동 검증되며, 실제 두 PC Field test에서 무엇이 확인되었고, 무엇이 아직 차단되어 있으며, 일반 설치 가능한 Alpha 전에 무엇을 더 닫아야 하는지** 정리하는 현재 상태 기준 문서입니다.

정확한 Runtime/도구/Protocol 식별은 [`../release-contract.json`](../release-contract.json), 현재/교체된 패키지 Build와 SHA-256 규칙은 [`../builds/README.md`](../builds/README.md)를 사용합니다.

## 기능 상태

| 영역 | 현재 상태 | 설명 |
| --- | --- | --- |
| 연결된 사용자 Presence | ✅ 프로토타입 존재 | Project / Session 범위 Presence와 Peer awareness가 존재하며 실제 두 PC Field flow에서도 동작했습니다. |
| Selection / Editor awareness | ✅ 프로토타입 존재 | Selection, Active Scene, Scene View 정보와 동료 탐색 기능이 존재합니다. |
| Transform 동기화 | 🟡 안정화 중 | 일반적인 양방향 Position/Rotation/Scale 동기화는 Field에서 동작했지만, #68에서 빠른 반복 조작 뒤 Protected-conflict 상태로 들어가는 문제가 확인됐습니다. |
| 기본 Lock / Ownership | 🟡 안정화 중 | Server-authoritative Lease/Ownership과 정상 Contention은 동작하지만, #68은 빠른 반복 조작에서 Lock/Client state race 또는 state divergence 가능성을 보여줍니다. |
| 같은 Scene의 Hierarchy 동기화 | 🟡 안정화 중 | 지원되는 Same-Scene 경로의 Create/Delete/Rename/Reparent/Sibling order가 기록된 두 PC Field flow에서 동작했습니다. |
| Transform/Hierarchy reconciliation | 🟡 안정화 중 | PR #57의 Object-scoped reconciliation은 존재하지만 실제 Field #68은 첫 Synthetic chaos lane에서 재현되지 않은 별도 Transform/Lock conflict path가 남아 있음을 보여줍니다. |
| Project bootstrap / Collaboration Invite | 🟡 안정화 중 | Signed/validated bootstrap metadata와 Host/Guest 흐름이 존재하고 Fresh Guest 전체 흐름도 실제 두 PC에서 성공했지만 Reconnect/Path/Firewall/Launcher 결함 때문에 Release closure는 막혀 있습니다. |
| Direct P2P 프로젝트 전송 | 🟡 안정화 중 | Direct HTTP Project Peer 전송, Chunking, Integrity, Resume/Retry, Staging, Activation, Seed/Failover 기반이 존재합니다. Field에서는 #70 Windows Firewall/Runtime-path 문제도 발견됐습니다. |
| 진단 / 복구 UX | 🟡 안정화 중 | 오류 설명과 Recovery action은 존재하지만 #68에서 UI 상태와 내부 Protected-conflict 상태가 어긋나는 증거가 나왔고 #67 Saved-Scene reconnect도 남아 있습니다. |
| Windows 경로 복원력 | 🟡 안정화 중 | WP5.1은 bounded managed short-workspace / execution-alias 전략을 사용하지만 #71에서 승인된 Execution alias가 Editor-side exact Active-path 검사에 거부되는 문제가 확인됐습니다. |
| Component / Inspector 동기화 | ⏳ 계획 | 일반 Component Add/Remove 및 `SerializedProperty` 협업은 아직 지원 기능으로 구현되지 않았습니다. |
| Prefab / Asset 협업 | ⏳ 계획 | 일반 Prefab / Asset 동기화는 현재 지원 기능이 아닙니다. |
| Persistent restart recovery | ⏳ 계획 | 서버/세션의 영구 재시작 복구는 현재 Release 범위 밖이며 Authority/Session state는 현재 메모리 기반입니다. |
| 인터넷 NAT traversal / relay | 🔬 연구 / 향후 | 현재 TeamForge는 WebRTC, ICE, STUN, TURN, Relay, 자동 NAT traversal을 제공하지 않습니다. |

## 현재 Candidate 식별

현재 source-controlled release contract에는 다음이 기록되어 있습니다.

- 제품 버전 `0.5.1`
- Release ID `0.5.1-wp5.1-path-resilience`
- Packaged Candidate 태그 `v0.5.1-prealpha-wp5.1-r2`
- Windows x64 Target
- Bundled Node `24.19.0`
- Source/개발 Node 범위 `>=22.23.2 <23 || >=24.18.1 <25`
- npm release tooling `11.19.0`
- `ws@8.21.3`
- Unity package line `6000.3`, 기록된 Test Editor `6000.3.21f1`
- Realtime Protocol v1, Project Transfer Protocol v1, Project Manifest Schema v1
- Candidate 상태 `FIELD_BLOCKED`

r2 Candidate는 이전 ZIP을 덮어쓴 것이 아니라 현재 `main`에서 다시 빌드한 새 Artifact입니다. WP5.1 Long Path / Path-resilience 소스를 유지하면서 PR #57에서 병합된 Transform/Hierarchy Contention 수정까지 포함합니다. 정확한 Byte identity는 Release tag + 파일명 + Release asset/sidecar의 SHA-256으로 판단합니다.

## 현재 GitHub Actions가 자동으로 검사하는 것

### Source / Runtime CI

Pull Request와 관련된 `main` 업데이트에서는 다음을 검사합니다.

- **Public source contract (Node 24)** — Fresh checkout의 Source/Document/Package/Release-contract 정합성
- **Server (Node 24)** — Locked dependency install, Syntax/Source 검사, Server tests
- **Project Peer (Node 24)** — Integration dependency install, Policy/Source 검사, Project Peer tests
- **Launcher runtime loader (Node 24)** — Runtime-loader syntax 및 tests
- **Launcher (.NET 10 / Windows)** — Launcher Core tests, Restore, Windows build

### Unity / Real-server 자동화

`.github/workflows/unity-tests.yml`은 관련 Pull Request와 `main` Push에서 Unity 6000.3.21f1 자동 테스트를 실행합니다. PR #57의 마지막 Product-changing head (`a750545787ae614a5534afdf8859e137349230f8`)는 다음을 포함한 `Unity Tests` workflow를 성공했습니다.

- Generic Unity EditMode validation
- Package EditMode validation
- 실제 TeamForge Server + 두 번째 WebSocket Peer를 사용한 Unity Realtime Authority E2E
- Unity Lock Contention E2E
- Realtime Authority Chaos E2E
- Project Transfer Resume E2E

### Authority Chaos / Recovery Stress

PR #57의 마지막 Authority stress 결과는 3개의 deterministic seed에서 **159 / 159 checks PASS**였습니다.

- Multi-peer Authority Chaos: 117 checks
- Recovery Chaos: 42 checks

검사 범위에는 Lock contention, Lease expiry/takeover, stale/future revision, Operation replay/conflict, destructive Hierarchy checks, Same-user session supersession, Lock cleanup, Late-join convergence가 포함됩니다.

별도 Draft PR #72는 실제 Unity + 실제 TeamForge Server로 Field issue #68을 재현하기 위한 chaos lane을 추가했습니다. 첫 Synthetic rapid-Transform/selection churn scenario는 Physical failure를 재현하지 못한 채 PASS했습니다. 이는 Missing trigger를 좁히는 증거일 뿐 **#68이 해결됐다는 뜻이 아니며**, 실제 SceneView/Handles ordering, Lock timing, Client-state transition은 계속 조사 대상입니다.

### Packaged Candidate 게시

r2 Publisher workflow run `32449536756`은 `main` commit `8442b59bd9ff8cfc10f70c5693dda18b52d20e0c` 기준으로 성공했고 `v0.5.1-prealpha-wp5.1-r2`를 생성했습니다. 게시 전 Runtime/Launcher rebuild, fresh staging, manifest regeneration, staged validation, Launcher Core tests, ZIP + SHA-256 sidecar 생성이 수행됩니다.

이 자동 검증은 의미 있는 Evidence지만 **실제 두 PC Field closure와 같은 것은 아닙니다.**

## 2026-08-22 실제 두 PC Field evidence

이제는 “두 PC 전체 흐름이 아직 전혀 검증되지 않았다”고 표현하면 부정확합니다.

실제 두 Windows PC에서 확인된 내용:

- Host → Signed Collaboration Invite → Fresh Guest import → Coordinator/Auth → Direct Project transfer → Publisher trust → Verified Active Project → Unity realtime connection까지 기록된 흐름이 성공했습니다.
- Presence, 양방향 Transform sync, 정상 Lock/Ownership contention, 지원되는 Same-Scene Hierarchy Create/Rename/Reparent/Sibling-order/Delete가 이후 Failure case를 시험하기 전까지 동작했습니다.
- Guest가 Collaborative Scene 변경을 **저장하지 않고** 종료하면 Launcher를 통해 다시 열어 Still-running session의 Authoritative Hierarchy/Transform/Lock snapshot을 받아 복구할 수 있었습니다.
- Guest → Coordinator TCP/5080만 일시적으로 차단했을 때 Guest가 Disconnect를 감지하고 계속 Reconnect를 시도했으며, 차단 해제 뒤 Unity 재시작 없이 자동 재연결되어 Realtime collaboration이 다시 동작했습니다.

같은 Field test에서 발견된 차단 버그:

- **#67 — Saved Guest reconnect:** Collaborative Scene을 저장하면 Disk baseline hash가 바뀌어 같은 Verified Active Project 재오픈이 `guest_handoff_mismatch`로 거부됩니다.
- **#68 — Rapid Transform / Lock protected conflict:** 빠른 반복 조작 시 Guest가 나중 Remote Transform을 거부하는 상태에 들어갈 수 있고, UI가 `Lock owned` / `0 protected conflict(s)`를 표시하면서 내부적으로는 `ProtectedConflictKeys` branch가 동작하는 불일치도 관찰됐습니다.
- **#69 — Receive 중 강제 종료:** Windows Launcher를 `Receiving` 중 강제 종료할 때 Unhandled CLR application-error dialog가 뜰 수 있습니다.
- **#70 — Windows Firewall / Seed:** Bundled Node 경로를 Program-specific firewall rule로 Windows가 resolve하지 못하며 Seed가 Dynamic port를 사용해 일반 사용자 LAN onboarding이 불안정합니다.
- **#71 — Execution alias handoff:** Launcher가 승인한 Path-resilience execution alias가 Editor의 exact Active-path validation에 거부될 수 있습니다.

따라서 물리 두 PC 경로의 상당 부분은 긍정적인 Evidence가 생겼지만 Candidate는 여전히 **FIELD BLOCKED**입니다.

## Evidence 경계

Green workflow나 성공한 Field scenario는 실제로 실행한 범위만 증명합니다.

- Source CI는 Packaged ZIP 전체를 증명하지 않습니다.
- Unity automation은 모든 Callback ordering, Network condition, SceneView input path, 실제 두 PC 환경을 증명하지 않습니다.
- Server Chaos는 Unity Editor/UI State-machine 테스트를 대신하지 않습니다.
- 한 번의 성공한 Fresh-Guest Field run이 Saved reconnect, Rapid-input race, Firewall onboarding, Path alias handoff, Interruption behavior까지 닫아주는 것은 아닙니다.
- Historical report는 새로운 Evidence가 명시적으로 대체하지 않는 한 해당 Candidate/Run에만 적용됩니다.

현재 질문에 대한 Evidence 우선순위는 다음과 같습니다.

1. 구현 동작은 현재 Source/Tests
2. Capability / Release readiness는 이 `STATUS.ko.md`
3. 아직 다른 Current doc에 반영되지 않은 최신 Field evidence는 현재 GitHub Issues/Comments
4. 정확한 Runtime/Protocol/Release identity는 `release-contract.json`
5. Topology / Trust boundary는 현재 Module README와 `docs/architecture.md`
6. Packaged byte identity는 `builds/README.md`, GitHub Release asset, 정확한 Hash
7. Phase/Work-state report는 기록된 시점의 역사적 Evidence

## 현재 Release / 설치 상태

WP5.1 r2 Packaged Candidate는 존재하지만, 아직 **중요한 프로젝트에서 신뢰할 수 있는 Production collaboration layer로 일반 설치를 권장하는 Release는 아닙니다.**

## 남은 Field / Release-readiness 차단 항목

일반 설치 가능한 Alpha로 소개하기 전에 최소한 다음 Gate를 더 닫아야 합니다.

1. **현재 Field blocker 수정 또는 안전한 재설계** — 특히 #67 Saved-Scene reconnect, #68 Transform/Lock state divergence, #70 Firewall/Seed onboarding, #71 Execution-alias handoff, 그리고 #69 Receive-shutdown exception path.
2. **수정 후 정확한 Candidate에서 두 PC Windows Field closure 재실행** — 이미 성공한 Fresh Guest baseline은 유지하면서 Reconnect/Contention/Path/Firewall 흐름이 실제로 고쳐졌는지 확인.
3. **정확한 intended Release Artifact를 사용한 Fresh-install / Fresh-project 테스트** — Development workspace가 아닌 일반 사용자 Setup 경로 기준.
4. Interrupted transfer, Host/Seed/process loss, Mismatched state, Safe refusal의 **남은 Failure/Recovery matrix 완료**. Coordinator network interruption/reconnect는 이미 긍정적인 Partial result가 있습니다.
5. Source/PR Unity automation과 별도로 **Exact-candidate Unity validation 결과를 Release Evidence로 보존**.
6. 실제 Long/Deep/Unicode Windows Project 위치에서 Containment/Final handoff를 약화하지 않는 **Path-resilience Field 검증**.
7. 일반 사용자를 위한 **Install / Update / Uninstall 문서**.
8. Project creator와 Automation 이외의 **외부 Tester/Reviewer 검증**.

## 중요한 현재 제한사항

- Backup을 유지하고 실험 단계에서는 Disposable project 사용을 권장합니다.
- TeamForge는 Git/Unity Version Control을 보완하는 도구이며 Version history/Backup을 대체하지 않습니다.
- Same-Scene Hierarchy 협업은 일반 Component/Inspector/Prefab/Asset 협업보다 범위가 좁습니다.
- Cross-Scene 구조, General Component sync, Inspector sync, Prefab structure sync, General Asset sync는 아직 지원되지 않습니다.
- Persistent server/session restart recovery는 구현되어 있지 않습니다. 현재 Authority/Session state가 RAM 기반이므로 Server process 재시작 시 기존 Session/Lock/Hierarchy/Transform authority가 사라지는 것은 예상 동작입니다. 따라서 현재의 Server-restart Field check 목적은 **기존 Session 보존이 아니라 깨끗한 Disconnect 감지, Fail-closed 상태, 잘못된 Connected/Lock 표시 방지, 새 상태로의 복구 UX**입니다.
- Direct P2P는 Project Peer endpoint가 직접 도달 가능해야 하며 자동 Internet NAT traversal은 구현되어 있지 않습니다.
- 현재 Packaged Target은 Windows x64이며 macOS/Linux 동등 Release artifact는 없습니다.
- Windows Launcher는 Authenticode signing이 되어 있지 않습니다.
- 임의로 깊은 Windows Path를 지원한다고 보장하지 않습니다. WP5.1은 Bounded managed path handling을 사용합니다.
- TeamForge는 독립적인 전문 보안 감사를 완료하지 않았습니다.

## 가까운 개발 방향

당장은 위 Field blocker를 닫고 해당 Physical scenario를 다시 실행하는 것이 우선입니다. 그 다음 주요 Scene collaboration 확장은 **Component Add/Remove + Inspector / `SerializedProperty` synchronization foundation**이며, 처음부터 모든 Unity serialization case를 무작정 동기화하기보다 좁은 Component/Property shape부터 검증하는 방향을 유지합니다.

앞으로의 방향은 [ROADMAP.ko.md](ROADMAP.ko.md), 현재 제한사항은 [known-issues.md](known-issues.md)를 참고해 주세요.

## 관련 문서

- [README.ko.md](../README.ko.md) — 프로젝트 개요
- [release-contract.json](../release-contract.json) — 정확한 Runtime/Protocol/Release identity
- [builds/README.md](../builds/README.md) — 현재/교체된 Packaged artifact 분류
- [architecture.md](architecture.md) — 현재 Runtime topology 및 Authority/Trust boundary
- [project-state.md](project-state.md) — 간결한 현재 Engineering state
- [known-issues.md](known-issues.md) — 현재 제한사항과 미검증 항목
- [deployment.md](deployment.md) — Windows Candidate deployment/rollback 계약
- [ROADMAP.ko.md](ROADMAP.ko.md) — 개발 방향과 향후 작업
- [SOURCE.md](SOURCE.md) — Source tree와 Validation guide
- [SECURITY.md](../.github/SECURITY.md) — 보안 기대사항과 제보 경로
