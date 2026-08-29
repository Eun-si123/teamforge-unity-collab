# TeamForge 현재 상태

[English](STATUS.md) | **한국어**

_마지막 문서 검토: 2026-08-30 (Asia/Seoul). 현재 소스 상태에는 WP5.1 Core Field Blocker 병합, 2026-08-27 게시된 Post-fix r4 Candidate, 그리고 2026-08-30 병합된 Post-r4 Repository / Launcher operability 작업을 반영합니다._

> [!WARNING]
> **초기 공개 프리뷰 — 중요한 Unity 프로젝트의 유일한 사본이나 복구 수단으로 TeamForge를 사용하지 마세요.**
>
> 현재 소스에는 상당한 안정화 작업이 반영되어 있고 Post-fix Packaged Candidate도 존재하지만 실제 Windows Field closure는 아직 끝나지 않았습니다. 테스트할 때는 백업을 유지하고 가능하면 disposable project를 사용하세요.

이 문서는 **현재 기능 상태와 Release readiness를 설명하는 사람용 canonical source**입니다. 다른 문서는 현재 blocker나 검증 상태를 별도로 복사해 유지하기보다 이 문서를 링크해야 합니다.

정확한 제품/Runtime/Protocol 선택은 [`../release-contract.json`](../release-contract.json), 패키지 byte identity와 superseded build 규칙은 [`../builds/README.md`](../builds/README.md)를 사용합니다. 개별 버그의 상세 논의는 연결된 GitHub Issue가 담당합니다.

## 현재 상태 요약

- 제품 버전: **`0.5.1`**
- Source lineage: **`0.5.1-wp5.1-path-resilience`**
- 최신 Published Packaged Candidate: **`v0.5.1-prealpha-wp5.1-r4`**
- r4 Artifact SHA-256: **`390ecbe4dad9488acdd992cc7198b25bf6407debf050d78385b01e076275c030`**
- Packaged target: **Windows x64**
- Release readiness: **FIELD BLOCKED**
- Unity line: **`6000.3`**, 기록된 Candidate Test Editor: **`6000.3.21f1`**
- Realtime Protocol: **v1**
- Project Transfer Protocol: **v1**
- Project Manifest Schema: **v1**

### 현재 소스와 Packaged Candidate

PR #81 (`fix: close core Windows field blockers`)은 2026-08-27 `main`에 merge commit `8a9bef7a785b2fd4b1842cf0ee70f6e5163481a7`로 병합되었습니다. 이전 PR #76에 있던 #68/#74 Transform/Lock recovery 작업도 PR #81에 포함되어 들어왔습니다.

그 뒤 Post-fix `v0.5.1-prealpha-wp5.1-r4` Candidate가 `main` commit `5fdebda8c91e3c858e894356eb4bb735bbc34885`에서 게시되었습니다. Windows ZIP은 `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-candidate-win-x64.zip`, SHA-256은 `390ecbe4dad9488acdd992cc7198b25bf6407debf050d78385b01e076275c030`입니다.

**r4는 기존 #67/#68/#69/#70/#71/#74 실제 Field closure를 위한 정확한 Published Candidate로 남아 있으며 여전히 FIELD BLOCKED입니다.** 게시와 Hash 식별은 그 실제 두 PC Windows scenario를 닫지 않습니다.

현재 `main`은 r4 Source snapshot보다 더 진행되었습니다. 특히 2026-08-30 Repository / Operability 병합에서 문서 체계, Test Lab, Engineering Quality Gate, Release tooling과 함께 Windows Launcher의 **Save support bundle** 동작 및 Privacy contract test가 추가되었습니다. 이 Post-r4 Source 변경은 이미 게시된 r4 ZIP의 bytes나 동작을 소급해서 바꾸지 않습니다.

따라서:

- 기존 r4 Field blocker Candidate 자체를 검증할 때는 **정확한 r4**를 사용합니다.
- r4를 현재 `main`과 byte 또는 behavior가 동일한 Package라고 표현하지 않습니다.
- 현재 `main`을 다음 Packaged Candidate로 삼으려면 새 Immutable Artifact를 게시하고 그 Artifact 자체를 검증해야 합니다.

## 기능 상태

| 영역 | 현재 소스 상태 | 남은 경계 |
| --- | --- | --- |
| Connected-user Presence | ✅ 구현 / 검증됨 | 외부 사용자 테스트는 더 필요 |
| Selection / Editor awareness | ✅ 구현 / 검증됨 | 외부 사용자 테스트는 더 필요 |
| Transform 동기화 | 🟡 구현 / 안정화 중 | #68/#74 Source fix 병합 완료, 실제 두 PC contention rerun 필요 |
| 기본 Lock / Ownership | 🟡 구현 / 안정화 중 | 실제 두 PC contention / handoff rerun 필요 |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 구현 / 안정화 중 | 지원 subset만 해당, 더 넓은 Field coverage 필요 |
| Project bootstrap / Collaboration Invite | 🟡 구현 / 안정화 중 | #67 Saved Guest reconnect Source fix 병합 완료, 실제 rerun 필요 |
| Direct P2P Project transfer | 🟡 구현 / 안정화 중 | #70 Stable Seed `5091` Source fix 병합 완료, LAN/Firewall rerun 필요 |
| Diagnostics / Recovery UX | 🟡 구현 / 안정화 중 | 현재 Source에는 r4 이후 Manual privacy-safe Launcher Support Bundle이 추가됨; #69 Interruption/Resume Field rerun은 여전히 필요 |
| Windows Path resilience / execution alias | 🟡 구현 / 안정화 중 | #71 Canonical alias handoff Source fix 병합 완료, 실제 Long/Deep path rerun 필요 |
| Component / Inspector 동기화 | ⏳ 계획 | 일반 Component Add/Remove 및 `SerializedProperty` sync 미지원 |
| Prefab / 일반 Asset 협업 | ⏳ 계획 | 현재 지원 workflow 아님 |
| Persistent Server/Session restart recovery | ⏳ 계획 | Authority/Session state는 현재 memory-resident |
| 자동 Internet NAT traversal / Relay | 🔬 연구 / 향후 | WebRTC, ICE, STUN, TURN, Relay, Discovery, 자동 NAT traversal 없음 |

## WP5.1 Core Field Blocker 상태

아래 수정은 **현재 소스와 r4 Packaged Candidate에 포함되어 있지만 Field validation debt는 남아 있습니다.**

| Issue | 현재 상태 | 남은 실제 검증 |
| --- | --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) — Saved Guest reconnect | PR #81에 병합, r4 포함 | 같은 Verified Project/Session/Baseline/Path의 정상 Saved Guest reopen, Fresh/Unverified Join strict 유지 |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) / [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) — Rapid Transform / Lock protected conflict | Recovery + First-snapshot dirtiness fix 병합, r4 포함 | 실제 두 PC A/B contention에서 Active drag 중 잘못된 snap 없이 release 후 최신 Authoritative 값으로 수렴하고 계속 편집 가능해야 함 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) — Receive shutdown | Handled `runtime_shutdown` 경로 병합, r4 포함 | Receive → Close/Terminate → Restart/Resume에서 Unhandled CLR/Application error가 없어야 함 |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) — Seed/Firewall onboarding | Production Seed TCP `5091` 고정, r4 포함 | 실제 LAN/Firewall onboarding, Seed restart/rebind |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) — Execution alias handoff | TeamForge-owned alias의 Exact canonical resolution 병합, r4 포함 | 실제 Long/Deep path Guest handoff, unrelated/retargeted alias는 계속 Fail-closed |

세부 버그 논의는 GitHub Issues가 담당하고, 이 문서는 Release effect와 현재 요약만 소유합니다.

## 자동화 및 Local Evidence

PR #81이 병합되기 전 최종 integrated head는 `docs/MAIN_PATCH_STATUS_2026-08-27.md`에 기록된 Repository protection gate를 통과했습니다.

- CI run #216 — Server, Project Peer, Launcher runtime loader, Windows Launcher, Public-source contract **PASS**
- Dependency Review run #140 — **PASS**
- Unity Tests run #73 — **PASS**
  - Unity Lock Contention E2E
  - Unity Realtime Authority E2E
  - Realtime Authority Chaos E2E
  - Project Transfer Resume E2E
- 이전 Local Unity Test Runner — **143 / 143 locally runnable tests PASS**, CI-only Real-server test 2개는 의도적으로 Ignore
- Same-machine A/B contention recovery — **PASS**
- A/B/C Late Join Hierarchy/Transform convergence — **PASS**, 기록된 실행에서 Protected conflict 0

Post-r4 Integration 작업의 최종 Pre-merge head도 일반 CI, Engineering Quality Gate, Dependency Review, Pages, Authority Chaos Stress, Windows Launcher Build / Diagnostics safety test와 4개 Unity E2E lane을 통과했습니다. 이는 현재 Source integration에 대한 Evidence이지, 그 뒤의 Source 변경을 오래된 r4 ZIP에 포함시키는 근거가 아닙니다.

r4 Release는 위의 Patched `main` commit에서 게시되어 정확한 ZIP/SHA pair를 가집니다. 이는 Artifact identity에 대한 근거이지 실제 두 PC Windows Field validation의 대체물이 아닙니다.

## 기록된 실제 두 PC Evidence — 2026-08-22

다음은 실제 두 Windows PC에서 기록된 Common path 긍정 Evidence입니다.

- Host → Signed Collaboration Invite → Fresh Guest → Authentication → Direct Project transfer → Publisher trust → Verified Active Project → Unity realtime connection
- Presence 및 양방향 Transform sync
- 정상 Lock/Ownership contention
- 지원되는 Same-Scene Hierarchy Create/Rename/Reparent/Sibling-order/Delete
- Unsaved Guest exit/reopen 후 Still-running session의 Authoritative Hierarchy/Transform/Lock recovery
- Coordinator TCP 일시 차단 → Retry → Unity 재시작 없이 자동 Reconnect

이 Baseline은 Common path가 전혀 검증되지 않은 상태가 아니라는 것을 보여주지만, 위의 Targeted r4 Windows Field scenario를 닫지는 않습니다.

## Evidence 경계

- Source CI는 Packaged ZIP의 정확성을 증명하지 않습니다.
- Unity automation은 모든 SceneView input ordering, Windows process 상태, LAN/Firewall, 두 번째 PC timing을 재현하지 않습니다.
- Same-machine Multi-project test는 신뢰도를 높이지만 하나의 OS/Network stack/Hardware를 공유합니다.
- 과거 Candidate PASS는 더 최신 Source revision이나 Replacement ZIP의 PASS가 아닙니다.
- Product version만으로 byte identity를 증명할 수 없으며 정확한 Package Evidence에는 Artifact filename + SHA-256이 필요합니다.
- r4 게시와 Hash 확인은 Artifact identity를 증명하지만 Physical Field closure를 증명하지 않습니다.
- 이후 Source test 결과는 r4 Packaged behavior로 소급되지 않습니다. Claim에는 Source commit과 Exact Artifact identity가 함께 맞아야 합니다.
- Historical phase/work-state/evidence note는 해당 Snapshot의 증거이며 현재 Readiness에서 이 문서를 덮어쓰지 않습니다.

## 남은 Release readiness gate

일반 설치 가능한 Alpha로 Promote하기 전에는 최소한 다음이 필요합니다.

1. 기존 WP5.1 Field blocker debt는 정확한 r4로 Targeted physical scenario를 마무리하거나, r4를 명시적으로 supersede하는 새 Candidate를 만들고 해당 Replacement Artifact에서 필요한 Field Evidence를 다시 확보합니다.
2. Field closure 대상으로 선택한 Artifact로 #67, #68/#74, #69, #70, #71 실제 Windows scenario를 실행합니다.
3. Fresh extraction / Fresh project 상태에서 일반 Host → Fresh Guest → Realtime collaboration flow를 다시 검증합니다.
4. Field run에 사용한 Exact Candidate identity와 Evidence를 보존합니다.
5. 현재 `main`을 Package한다면 Post-r4 Launcher Support Bundle 같은 새 Packaged behavior도 새 Artifact의 Evidence로 검증하며 Source CI 결과를 오래된 r4에 상속시키지 않습니다.
6. 중요한 Host/Server/Seed/Process-loss 및 Safe-refusal scenario를 추가 검증합니다.
7. Install/Update/Uninstall 문서를 개선하고 프로젝트 제작자 외 사람의 Test/Review를 확보한 뒤 넓은 Reliability claim을 합니다.

Server process restart는 현재 **Disconnect/Fail-closed/New-session recovery** 검증 대상이지 Persistence test가 아닙니다. Durable Authority/Session restart recovery는 아직 구현되지 않았습니다.

## 정보 소유 규칙

| 질문 | Canonical source |
| --- | --- |
| 지금 무엇이 동작하고 무엇이 막혀 있나? | **이 `STATUS.ko.md` / `STATUS.md`** |
| 정확한 Version/Runtime/Protocol 선택은? | [`release-contract.json`](../release-contract.json) |
| 현재/Superseded Packaged byte identity는? | [`builds/README.md`](../builds/README.md) + GitHub Release SHA-256 |
| TeamForge가 끝에서 끝까지 어떻게 동작하나? | [`HOW_IT_WORKS.ko.md`](HOW_IT_WORKS.ko.md) |
| 앞으로 무엇을 만들 계획인가? | [`ROADMAP.ko.md`](ROADMAP.ko.md) |
| 현재 시스템 구조는? | [`architecture.md`](architecture.md) |
| Architecture 결정 이유는? | [`architecture-decisions.md`](architecture-decisions.md) |
| 이름 붙은 Validation Scenario는 어떻게 실행하나? | [`TEST_LAB.md`](TEST_LAB.md) |
| 개별 Bug의 상세 현재 상태는? | GitHub Issues |
| 과거 Test/Stabilization pass에서 무슨 일이 있었나? | 날짜가 붙은 Phase / Work-state / Evidence note |
