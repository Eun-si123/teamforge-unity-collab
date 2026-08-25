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

이 문서는 **현재 구현 상태, 자동 검증, 실제 두 PC Field evidence, 남은 Release blocker**를 정리하는 현재 상태 기준 문서입니다.

정확한 Runtime/도구/Protocol 식별은 [`../release-contract.json`](../release-contract.json), 현재/교체된 패키지 Build와 SHA-256 규칙은 [`../builds/README.md`](../builds/README.md)를 사용합니다.

## 기능 상태

| 영역 | 현재 상태 | 설명 |
| --- | --- | --- |
| 연결된 사용자 Presence | ✅ 프로토타입 존재 | Project / Session 범위 Presence가 존재하며 실제 두 PC Field flow에서도 동작했습니다. |
| Selection / Editor awareness | ✅ 프로토타입 존재 | Selection, Active Scene, Scene View 정보와 동료 탐색 기능이 존재합니다. |
| Transform 동기화 | 🟡 안정화 중 | 일반적인 양방향 Position/Rotation/Scale 동기화는 Field에서 동작했습니다. #68 Field failure에 대한 좁은 Recovery/Snapshot hardening 패치는 Draft PR #76에 들어갔고, #74는 그중 Lock-contention recovery를 좁혀 추적하는 Issue입니다. CI/Unity 자동화는 PASS했지만 실제 두 PC 재검증은 아직 필요합니다. |
| 기본 Lock / Ownership | 🟡 안정화 중 | Server-authoritative Lease/Ownership과 정상 Contention은 동작합니다. PR #76은 Foreign owner/`lock_required` 순서 때문에 Stale protected conflict에 빠지는 경로를 수리했지만, 실제 A/B contention 재검증 전에는 Field closure로 보지 않습니다. |
| Same-Scene Hierarchy | 🟡 안정화 중 | Create/Delete/Rename/Reparent/Sibling order가 기록된 두 PC Field flow에서 동작했습니다. |
| Transform/Hierarchy reconciliation | 🟡 안정화 중 | PR #57의 Object-scoped reconciliation 위에 PR #76이 첫 Transform snapshot에서 실제 사전 Local dirtiness와 TeamForge 자체 Remote apply가 만든 dirtiness를 구분하는 방어를 추가했습니다. |
| Project bootstrap / Collaboration Invite | 🟡 안정화 중 | Fresh Guest 전체 흐름은 실제 두 PC에서 성공했지만 Reconnect/Path/Firewall/Launcher 결함 때문에 Release closure는 막혀 있습니다. |
| Direct P2P Project transfer | 🟡 안정화 중 | Chunking, Integrity, Resume/Retry, Staging, Activation, Seed/Failover 기반이 존재하며 #70 Windows Firewall/Runtime-path 문제가 열려 있습니다. |
| Diagnostics / Recovery UX | 🟡 안정화 중 | 오류 설명과 Recovery action은 존재합니다. #68/#74 recovery에는 이제 자동화된 회귀 테스트가 있지만 #67 등 나머지 Field blocker는 여전히 남아 있습니다. |
| Windows Path resilience | 🟡 안정화 중 | Bounded managed short-workspace / execution-alias 전략이 존재하지만 #71에서 승인된 Execution alias가 Editor-side exact Active-path 검사에 거부됩니다. |
| Component / Inspector 동기화 | ⏳ 계획 | 일반 Component Add/Remove 및 `SerializedProperty` 협업은 아직 지원 기능이 아닙니다. |
| Prefab / Asset 협업 | ⏳ 계획 | 일반 Prefab / Asset 동기화는 현재 지원 기능이 아닙니다. |
| Persistent restart recovery | ⏳ 계획 | 서버/세션의 영구 재시작 복구는 현재 Release 범위 밖이며 Authority/Session state는 메모리 기반입니다. |
| 인터넷 NAT traversal / relay | 🔬 연구 / 향후 | WebRTC, ICE, STUN, TURN, Relay, 자동 NAT traversal은 제공하지 않습니다. |

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

## 현재 GitHub Actions가 자동으로 검사하는 것

### Source / Runtime CI

Pull Request와 관련된 `main` 업데이트에서는 다음을 검사합니다.

- **Public source contract (Node 24)** — Fresh checkout의 Source/Document/Package/Release-contract 정합성을 검사하며 `npm run validate`가 이 Public-source validator를 실행합니다. 생성된 Release binary는 Public source checkout에서 필수 요구사항이 아닙니다.
- **Server (Node 24)** — Locked dependency install, Syntax/Source 검사, Server tests
- **Project Peer (Node 24)** — Integration dependency install, Policy/Source 검사, Project Peer tests
- **Launcher runtime loader (Node 24)** — Runtime-loader syntax 및 tests
- **Launcher (.NET 10 / Windows)** — Launcher Core tests, Restore, Windows build

### Unity / Real-server 자동화

현재 Draft PR #76 head `33268c49927acebc3b07cf992e9dc188c1188978`에서 일반 CI와 Unity Tests가 모두 PASS했습니다. 추가된 집중 회귀 테스트는 다음을 포함합니다.

- Recoverable contention에서 가장 최신 Deferred authoritative Transform revision 사용
- Quiescent `lock_required` conflict에서 Last confirmed Transform 복원
- `GUIUtility.hotControl`이 활성화된 동안 Recovery 대기
- Local edit 중 Authoritative foreign lock owner가 나타나는 순서를 Recoverable contention으로 처리
- Generic protected conflict는 계속 Fail-closed 유지
- 첫 Transform snapshot 대기 중 `TeamForgeRemoteApplyScope` 안의 Scene dirtiness는 Local conflict로 세지 않고, 실제 Local dirtiness는 보존한 뒤 첫 Snapshot에서 소비/초기화

이는 #68/#74 패치의 자동 증거이지만 **실제 두 PC Field closure를 대신하지 않습니다.**

PR #57의 마지막 Product-changing head도 Unity `6000.3.21f1`에서 Generic/Package EditMode, Real-server Unity Realtime Authority E2E, Unity Lock Contention E2E, Realtime Authority Chaos E2E, Project Transfer Resume E2E를 통과했습니다.

Authority stress는 3개의 deterministic seed에서 **159 / 159 checks PASS**였습니다.

별도 Draft PR #72는 실제 Unity + 실제 TeamForge Server로 Field issue #68을 재현하기 위한 chaos lane을 추가했습니다. 첫 Synthetic rapid-Transform/selection churn scenario는 Physical failure를 재현하지 못한 채 PASS했고, 현재 Targeted fix는 PR #76이 담당합니다.

### Packaged Candidate 게시

r2 Publisher workflow run `32449536756`은 `main` commit `8442b59bd9ff8cfc10f70c5693dda18b52d20e0c` 기준으로 성공했고 `v0.5.1-prealpha-wp5.1-r2`를 생성했습니다. 자동 검증은 의미 있는 Evidence지만 **실제 두 PC Field closure와 같은 것은 아닙니다.**

## 2026-08-22 실제 두 PC Field evidence

실제 두 Windows PC에서 확인된 내용:

- Host → Signed Collaboration Invite → Fresh Guest import → Coordinator/Auth → Direct Project transfer → Publisher trust → Verified Active Project → Unity realtime connection 흐름이 성공했습니다.
- Presence, 양방향 Transform sync, 정상 Lock/Ownership contention, 지원되는 Same-Scene Hierarchy Create/Rename/Reparent/Sibling-order/Delete가 동작했습니다.
- Guest가 Collaborative Scene 변경을 **저장하지 않고** 종료하면 Launcher를 통해 다시 열어 Still-running session의 Authoritative Hierarchy/Transform/Lock snapshot으로 복구할 수 있었습니다.
- Guest → Coordinator TCP/5080을 일시적으로 차단했을 때 Disconnect/Retry가 발생했고 차단 해제 뒤 Unity 재시작 없이 자동 재연결되어 Realtime collaboration이 다시 동작했습니다.

같은 Field test에서 발견된 차단 버그:

- **#67 — Saved Guest reconnect:** Collaborative Scene을 저장하면 Disk baseline hash가 바뀌어 같은 Verified Active Project 재오픈이 `guest_handoff_mismatch`로 거부됩니다.
- **#68 / #74 — Rapid Transform / Lock protected conflict:** #68이 실제 Field-level failure이고 #74는 그중 Stale lock-contention recovery를 좁혀 추적하는 Issue입니다. Draft PR #76이 Foreign-owner/`lock_required` ordering과 초기 First-snapshot dirty-Scene ambiguity를 모두 패치했습니다. 자동화는 PASS했지만 실제 두 PC A/B contention 재검증 전에는 둘 다 Field-closed가 아닙니다.
- **#69 — Receive 중 강제 종료:** Windows Launcher를 `Receiving` 중 강제 종료할 때 Unhandled CLR application-error dialog가 뜰 수 있습니다.
- **#70 — Windows Firewall / Seed:** Bundled Node 경로를 Program-specific firewall rule로 Windows가 resolve하지 못하며 Seed가 Dynamic port를 사용합니다.
- **#71 — Execution alias handoff:** Launcher가 승인한 Path-resilience execution alias가 Editor의 exact Active-path validation에 거부될 수 있습니다.

따라서 물리 두 PC 경로의 상당 부분은 긍정적인 Evidence가 생겼지만 Candidate는 여전히 **FIELD BLOCKED**입니다.

## Evidence 경계

- Source CI는 Packaged ZIP 전체를 증명하지 않습니다.
- Unity automation은 모든 Callback ordering, Network condition, SceneView input path, 실제 두 PC 환경을 증명하지 않습니다.
- 한 번의 성공한 Fresh-Guest Field run이 Saved reconnect, Rapid-input race, Firewall onboarding, Path alias handoff, Interruption behavior까지 닫아주는 것은 아닙니다.
- Historical report는 새로운 Evidence가 명시적으로 대체하지 않는 한 해당 Candidate/Run에만 적용됩니다.

현재 질문에 대한 Evidence 우선순위는 현재 Source/Tests → 이 `STATUS.ko.md` → 최신 GitHub Issues/Comments → `release-contract.json` → `builds/README.md` 및 exact Release artifact 순입니다.

## 남은 Field / Release-readiness 차단 항목

1. **현재 Field blocker 수정 또는 안전한 재설계** — #67, #69, #70, #71과 #68/#74 하나의 Transform/Lock blocker 계열.
2. **수정 후 정확한 Candidate에서 두 PC Windows Field closure 재실행**. #68/#74의 다음 필수 검증은 PR #76 head에서 같은 Object를 대상으로 A/B contention을 일으켜, Losing peer가 Drag 중에는 강제 Snap되지 않고 Release 후 Authoritative Transform으로 수렴하는지 확인하는 것입니다.
3. **정확한 intended Release Artifact를 사용한 Fresh-install / Fresh-project 테스트**.
4. Interrupted transfer, Host/Seed/process loss, Mismatched state, Safe refusal의 **남은 Failure/Recovery matrix 완료**. Coordinator network interruption/reconnect는 이미 긍정적인 Partial result가 있습니다.
5. **Exact-candidate Unity validation 결과를 Release Evidence로 보존**.
6. 실제 Long/Deep/Unicode Windows Project 위치의 **Path-resilience Field 검증**.
7. 일반 사용자를 위한 **Install / Update / Uninstall 문서**.
8. Project creator와 Automation 이외의 **외부 Tester/Reviewer 검증**.

## 중요한 현재 제한사항

- Backup을 유지하고 실험 단계에서는 Disposable project 사용을 권장합니다.
- TeamForge는 Git/Unity Version Control을 보완하며 Version history/Backup을 대체하지 않습니다.
- Cross-Scene 구조, General Component sync, Inspector sync, Prefab structure sync, General Asset sync는 아직 지원되지 않습니다.
- Persistent server/session restart recovery는 구현되어 있지 않습니다. 현재 Authority/Session state가 RAM 기반이므로 Server process 재시작 시 기존 Session/Lock/Hierarchy/Transform authority가 사라지는 것은 예상 동작입니다. 현재 Server-restart Field check 목적은 **기존 Session 보존이 아니라 깨끗한 Disconnect 감지, Fail-closed 상태, 잘못된 Connected/Lock 표시 방지, 새 상태로의 Recovery UX**입니다.
- Direct P2P는 Project Peer endpoint가 직접 도달 가능해야 하며 자동 Internet NAT traversal은 구현되어 있지 않습니다.
- 현재 Packaged Target은 Windows x64이며 Windows Launcher는 Authenticode signing이 되어 있지 않습니다.
- TeamForge는 독립적인 전문 보안 감사를 완료하지 않았습니다.

## 가까운 개발 방향

당장은 #68/#74 패치의 실제 두 PC 검증을 끝내고 나머지 Field blocker를 닫은 뒤 관련 Physical scenario를 다시 실행하는 것이 우선입니다. 그 다음 주요 Scene collaboration 확장은 **Component Add/Remove + Inspector / `SerializedProperty` synchronization foundation**입니다.

앞으로의 방향은 [ROADMAP.ko.md](ROADMAP.ko.md), 현재 제한사항은 [known-issues.md](known-issues.md)를 참고해 주세요.
