# TeamForge 현재 상태

[English](STATUS.md) | **한국어**

_공개 소스와 현재 GitHub Actions 증거 기준 마지막 검토: 2026-08-21 (Asia/Seoul)_

현재 제품 버전: `0.5.1`  
현재 Release ID: `0.5.1-wp5.1-path-resilience`  
현재 Packaged Candidate 태그: `v0.5.1-prealpha-wp5.1-r2`  
현재 Candidate 상태: **FIELD BLOCKED**

> [!WARNING]
> **초기 공개 프리뷰 — 소스와 패키지 Candidate는 공개되어 있지만 일반 설치를 권장하는 단계는 아닙니다.**
>
> TeamForge는 아직 안정화 중입니다. 테스트할 때는 Backup을 유지하고 가능하면 disposable Unity project를 사용하세요. 패키지 Candidate가 존재하고 자동 테스트가 통과했다는 사실만으로 Production-ready가 되는 것은 아닙니다.

이 문서는 **지금 무엇이 구현되어 있고, 무엇이 자동 검증되며, 무엇이 아직 검증되지 않았고, 일반 설치 가능한 Alpha 전에 무엇을 더 닫아야 하는지** 정리하는 현재 상태 기준 문서입니다.

정확한 Runtime/도구/Protocol 식별은 [`../release-contract.json`](../release-contract.json), 현재/교체된 패키지 Build와 SHA-256 규칙은 [`../builds/README.md`](../builds/README.md)를 사용합니다.

## 기능 상태

| 영역 | 현재 상태 | 설명 |
| --- | --- | --- |
| 연결된 사용자 Presence | ✅ 프로토타입 존재 | Project / Session 범위 Presence와 Peer awareness가 구현되어 있습니다. |
| Selection / Editor awareness | ✅ 프로토타입 존재 | Selection, Active Scene, Scene View 정보와 동료 탐색 기능이 존재합니다. |
| Transform 동기화 | ✅ 프로토타입 존재 | Realtime Protocol v1에서 위치, 회전, 크기 동기화가 구현되어 있습니다. |
| 기본 Lock / Ownership | 🟡 안정화 중 | 서버 권한 기반 Lease/Ownership이 존재하고 Contention/Recovery 자동 테스트가 강화되었지만 실제 UX/현장 동작은 더 검증해야 합니다. |
| 같은 Scene의 Hierarchy 동기화 | 🟡 안정화 중 | 지원되는 Same-Scene 경로에서 생성, 삭제, 이름 변경, Reparent, Sibling order가 구현되어 있습니다. |
| Transform/Hierarchy reconciliation | 🟡 안정화 중 | PR #57에서 고정된 전역 Hierarchy grace 대신 Object-scoped reconciliation을 사용하도록 바뀌었고, 거부/Undo된 Hierarchy 변경과 Foreign lock 상태의 빠른 Selection 변경 복구가 추가되었습니다. |
| Project bootstrap / Collaboration Invite | 🟡 안정화 중 | Signed/validated bootstrap metadata와 Host/Guest 흐름은 존재하지만 두 PC 전체 Field 흐름은 아직 닫히지 않았습니다. |
| Direct P2P 프로젝트 전송 | 🟡 안정화 중 | Direct HTTP Project Peer 전송, Chunking, Integrity check, Resume/Retry, Staging, Activation, Seed/Failover 로직이 존재합니다. |
| 진단 / 복구 UX | 🟡 안정화 중 | 안정적인 오류 설명, bounded/redacted diagnostics, 상태 기반 Recovery action이 존재합니다. |
| Windows 경로 복원력 | 🟡 안정화 중 | WP5.1은 bounded managed short-workspace / execution-alias 전략을 사용하며 Path 편의 기능과 Containment/Trust/Activation/Final handoff 검사를 분리합니다. |
| Component / Inspector 동기화 | ⏳ 계획 | 일반 Component Add/Remove 및 `SerializedProperty` 협업은 아직 지원 기능으로 구현되지 않았습니다. |
| Prefab / Asset 협업 | ⏳ 계획 | 일반 Prefab / Asset 동기화는 현재 지원 기능이 아닙니다. |
| Persistent restart recovery | ⏳ 계획 | 서버/세션의 영구 재시작 복구는 현재 Release 범위 밖입니다. |
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

저장소는 이제 Source-level CI만이 아니라 여러 종류의 자동 Evidence를 갖고 있습니다.

### Source / Runtime CI

Pull Request와 관련된 `main` 업데이트에서는 다음을 검사합니다.

- **Public source contract (Node 24)** — Fresh checkout의 Source/Document/Package/Release-contract 정합성
- **Server (Node 24)** — Locked dependency install, Syntax/Source 검사, Server tests
- **Project Peer (Node 24)** — Integration dependency install, Policy/Source 검사, Project Peer tests
- **Launcher runtime loader (Node 24)** — Runtime-loader syntax 및 tests
- **Launcher (.NET 10 / Windows)** — Launcher Core tests, Restore, Windows build

### Unity / Real-server 자동화

`.github/workflows/unity-tests.yml`은 이제 관련 Pull Request와 `main` Push에서 Unity 6000.3.21f1 자동 테스트를 실행합니다. PR #57의 마지막 Product-changing head (`a750545787ae614a5534afdf8859e137349230f8`)는 `Unity Tests` workflow 전체를 성공했고 다음을 포함했습니다.

- Generic Unity EditMode validation
- Package EditMode validation
- 실제 TeamForge Server + 두 번째 WebSocket Peer를 사용한 Unity Realtime Authority E2E
- Unity Lock Contention E2E
- Realtime Authority Chaos E2E
- Project Transfer Resume E2E

이 Product code는 이후 변경 없이 `main`에 병합되었습니다.

### Authority Chaos / Recovery Stress

PR #57의 마지막 Authority stress 결과는 3개의 deterministic seed에서 **159 / 159 checks PASS**였습니다.

- Multi-peer Authority Chaos: 117 checks
- Recovery Chaos: 42 checks

검사 범위에는 Lock contention, Lease expiry/takeover, stale/future revision, Operation replay/conflict, destructive Hierarchy checks, Same-user session supersession, Lock cleanup, Late-join convergence가 포함됩니다.

### Packaged Candidate 게시

r2 Publisher workflow run `32449536756`은 `main` commit `8442b59bd9ff8cfc10f70c5693dda18b52d20e0c` 기준으로 성공했고 `v0.5.1-prealpha-wp5.1-r2`를 생성했습니다. 게시 전에 Runtime과 Self-contained Windows Launcher를 다시 만들고, Fresh release tree를 staging하고, Release manifest를 재생성한 뒤 Staged repository/runtime/launcher validation과 Launcher Core tests를 실행하고 새 ZIP + SHA-256 sidecar를 생성합니다.

이 자동 검증은 의미 있는 Evidence지만 **실제 두 PC Field closure와 같은 것은 아닙니다.**

## Evidence 경계

Green workflow는 실제로 실행한 Scenario와 Artifact identity만 증명합니다.

- Source CI는 Packaged ZIP 전체를 증명하지 않습니다.
- Unity automation은 모든 Callback ordering, Network condition, 실제 두 PC 환경을 증명하지 않습니다.
- Server Chaos는 Unity Editor/UI State-machine 테스트를 대신하지 않습니다.
- Candidate가 빌드되었다고 Host → Guest 전체 흐름이 독립된 두 PC에서 검증된 것은 아닙니다.
- Historical report는 새로운 Evidence가 명시적으로 대체하지 않는 한 해당 Candidate/Run에만 적용됩니다.

현재 질문에 대한 Evidence 우선순위는 다음과 같습니다.

1. 구현 동작은 현재 Source/Tests
2. Capability / Release readiness는 이 `STATUS.ko.md`
3. 정확한 Runtime/Protocol/Release identity는 `release-contract.json`
4. Topology / Trust boundary는 현재 Module README와 `docs/architecture.md`
5. Packaged byte identity는 `builds/README.md`, GitHub Release asset, 정확한 Hash
6. Phase/Work-state report는 기록된 시점의 역사적 Evidence

## 현재 Release / 설치 상태

WP5.1 r2 Packaged Candidate는 존재하지만, 아직 **중요한 프로젝트에서 신뢰할 수 있는 Production collaboration layer로 일반 설치를 권장하는 Release는 아닙니다.**

Public source에는 생성된 Runtime payload와 Packaged executable을 Canonical source로 Commit하지 않습니다. 따라서 Packaged Host/Guest 경로는 별도의 Release Artifact이며 Manifest/Hash/Validation evidence도 따로 가집니다.

## 남은 Field / Release-readiness 차단 항목

일반 설치 가능한 Alpha로 소개하기 전에 정확한 Candidate에서 최소한 다음 Gate를 더 닫아야 합니다.

1. **두 PC Windows End-to-End Field validation** — Host → Invite → Guest → Project transfer → Activation → Realtime collaboration.
2. **정확한 r2 Release Artifact를 사용한 Fresh-install / Fresh-project 테스트** — Development workspace가 아니라 일반 사용자 Setup 경로 기준.
3. Interrupted transfer, Reconnect, Host/Seed loss, Mismatched state, Safe refusal에 대한 **실제 Failure/Recovery field 검증**.
4. Source/PR Unity automation과 별도로 **Exact-candidate Unity validation 결과를 Release Evidence로 보존**.
5. 실제 Long/Deep/Unicode Windows Project 위치에서 Containment/Final handoff를 약화하지 않는 **Path-resilience Field 검증**.
6. 일반 사용자를 위한 **Install / Update / Uninstall 문서**.
7. Project creator와 Automation 이외의 **외부 Tester/Reviewer 검증**.

이는 출시 날짜 약속이 아니라 준비 상태를 판단하기 위한 Gate입니다.

## 중요한 현재 제한사항

- Backup을 유지하고 실험 단계에서는 Disposable project 사용을 권장합니다.
- TeamForge는 Git/Unity Version Control을 보완하는 도구이며 Version history/Backup을 대체하지 않습니다.
- Same-Scene Hierarchy 협업은 일반 Component/Inspector/Prefab/Asset 협업보다 범위가 좁습니다.
- Cross-Scene 구조, General Component sync, Inspector sync, Prefab structure sync, General Asset sync는 아직 지원되지 않습니다.
- Persistent server/session restart recovery는 구현되어 있지 않습니다.
- Direct P2P는 Project Peer endpoint가 직접 도달 가능해야 하며 자동 Internet NAT traversal은 구현되어 있지 않습니다.
- 현재 Packaged Target은 Windows x64이며 macOS/Linux 동등 Release artifact는 없습니다.
- Windows Launcher는 Authenticode signing이 되어 있지 않습니다.
- 임의로 깊은 Windows Path를 지원한다고 보장하지 않습니다. WP5.1은 Bounded managed path handling을 사용합니다.
- TeamForge는 독립적인 전문 보안 감사를 완료하지 않았습니다.

## 가까운 개발 방향

현재 기반은 WP5.1을 Field-blocked 상태로 유지하면서 다음 개발을 병행할 수 있을 정도로 자동 검증이 강화되었습니다. 다음 Scene collaboration 방향은 **Component Add/Remove + Inspector / `SerializedProperty` synchronization foundation**을 안전하게 설계하는 것입니다. 처음부터 모든 Unity serialization case를 무작정 동기화하기보다 좁은 Component/Property shape부터 검증하는 방향을 권장합니다.

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
