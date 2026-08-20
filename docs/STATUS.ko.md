# TeamForge 현재 상태

[English](STATUS.md) | **한국어**

_공개 소스 기준 마지막 검토: 2026-08-20 (Asia/Seoul)_

현재 제품 버전: `0.5.1`  
현재 Release ID: `0.5.1-wp5.1-path-resilience`  
현재 Candidate 상태: **FIELD BLOCKED**

> [!WARNING]
> **초기 공개 프리뷰 — 소스는 공개되어 있지만 일반 설치를 권장하는 단계는 아닙니다.**
>
> TeamForge는 아직 안정화 중입니다. 현재 공개 저장소는 소스 검토, 자동 테스트, 보안 피드백, 개발에는 사용할 수 있지만, 중요한 Unity 프로젝트에 일반 사용자가 설치하도록 권장하는 공개 Alpha 패키지는 아직 없습니다.

이 문서는 **지금 무엇이 구현되어 있고, 무엇이 자동 검증되며, 무엇이 아직 검증되지 않았고, 설치 가능한 공개 Alpha 전에 무엇을 통과해야 하는지** 짧게 정리하는 현재 상태 기준 문서입니다.

정확한 Runtime/도구/Protocol/Candidate 식별은 [`../release-contract.json`](../release-contract.json), 현재 패키지 ZIP의 분류는 [`../builds/README.md`](../builds/README.md)를 사용합니다. 두 문서는 더 세밀한 식별 정보를 제공하지만, 이 문서의 Release readiness 경고를 대신하지는 않습니다.

## 기능 상태

| 영역 | 현재 상태 | 설명 |
| --- | --- | --- |
| 연결된 사용자 Presence | ✅ 프로토타입 존재 | Project / Session 범위 Presence와 Peer awareness가 구현되어 있습니다. |
| Selection / Editor awareness | ✅ 프로토타입 존재 | Selection, Active Scene, Scene View 정보와 동료 탐색 실험이 존재합니다. |
| Transform 동기화 | ✅ 프로토타입 존재 | 현재 realtime protocol에서 위치, 회전, 크기 동기화가 구현되어 있습니다. |
| 기본 Lock / Ownership | 🟡 안정화 중 | 서버 권한 기반 lease/ownership 동작이 있지만 충돌 UX와 예외 상황은 더 많은 현장 검증이 필요합니다. |
| 같은 Scene의 Hierarchy 동기화 | 🟡 안정화 중 | 지원되는 same-Scene 경로에서 생성, 삭제, 이름 변경, Reparent, Sibling order 동기화가 구현되어 있습니다. |
| Project bootstrap / Collaboration Invite | 🟡 안정화 중 | Signed/validated bootstrap metadata와 Host/Guest 흐름이 있지만 end-to-end 현장 흐름은 아직 release-ready가 아닙니다. |
| Direct P2P 프로젝트 전송 | 🟡 안정화 중 | Direct HTTP Project Peer 전송, chunking, 무결성 검사, resume/retry, staging, activation, seed/failover 로직이 개발 구현에 존재합니다. |
| 진단 / 복구 UX | 🟡 안정화 중 | WP5에서 안정적인 오류 설명, redacted bounded diagnostics, 상태 기반 안전 복구 동작이 추가되었습니다. |
| Windows 경로 복원력 | 🟡 안정화 중 | WP5.1에서 패키지된 Windows Candidate의 managed short-workspace / path-resilience 처리가 추가되었으며 Protocol/Trust 경계는 바뀌지 않았습니다. |
| Component / Inspector 동기화 | ⏳ 계획 | 일반 Component 및 `SerializedProperty` 협업은 현재 지원되는 일반 기능이 아닙니다. |
| Prefab / Asset 협업 | ⏳ 계획 | 일반 Prefab / Asset 동기화는 현재 지원 범위가 아닙니다. |
| Persistent restart recovery | ⏳ 계획 | 서버/세션의 영구 재시작 복구는 현재 릴리스 범위 밖입니다. |
| 인터넷 NAT traversal / relay | 🔬 연구 / 향후 | 현재 TeamForge는 WebRTC, ICE, STUN, TURN, relay, 자동 NAT traversal을 제공하지 않습니다. |

기능 구현 이력은 Unity package [CHANGELOG](../unity-package/com.eunsung.teamforge/CHANGELOG.md), 앞으로의 방향은 [로드맵](ROADMAP.ko.md), 현재 as-built topology와 authority boundary는 [architecture.md](architecture.md)를 참고해 주세요.

## 현재 Candidate 식별

현재 source-controlled release contract에는 다음이 기록되어 있습니다.

- 제품 버전 `0.5.1`
- Release ID `0.5.1-wp5.1-path-resilience`
- Windows x64 Target
- Bundled Node `24.19.0`
- Source/개발자 Node 범위 `>=22.23.2 <23 || >=24.18.1 <25`
- npm release tooling `11.19.0`
- `ws@8.21.3`
- Unity package line `6000.3`, 기록된 Candidate test Editor `6000.3.21f1`
- Realtime Protocol v1, Project Transfer Protocol v1, Project Manifest Schema v1
- `FIELD_BLOCKED` 상태

`0.5.1`만으로는 WP4/WP5/WP5.1 안정화 과정에서 만들어진 모든 byte-identical Candidate를 구분할 수 없습니다. 패키지 검증에서는 **Release ID + 정확한 Artifact 파일명 + SHA-256**을 함께 사용해야 합니다. ZIP을 다시 패키징해서 bytes/hash가 바뀌면 같은 제품/Work Package lineage에 속하더라도 byte-level artifact는 다른 것입니다.

## 공개 저장소에서 자동으로 검증하는 것

현재 저장소 CI는 Pull Request와 `main` 업데이트에서 다음 항목을 검사합니다.

- **Public source contract (Node 24)** — 생성된 Runtime/Launcher/Release 전용 Evidence를 요구하지 않고 Fresh checkout의 source/document/package/release-contract 정합성을 검사
- **Server (Node 24)** — 잠긴 의존성 설치, syntax/source 검사, server tests
- **Project Peer (Node 24)** — integration dependency 설치, policy/source 검사, Project Peer tests
- **Launcher runtime loader (Node 24)** — syntax 및 runtime-loader tests
- **Launcher (.NET 10 / Windows)** — launcher core tests, restore, Windows build

Public source contract gate와 staged release-candidate validator는 의도적으로 서로 다른 대상입니다. `npm run validate`는 공개 source checkout에서 동작해야 하고, `npm run validate:release`는 완전히 staged된 Candidate의 생성 Runtime/Launcher/Release Evidence를 기대합니다.

현재 공개 GitHub Actions CI에서는 **Unity EditMode tests를 실행하지 않습니다.** Unity 테스트를 필수 공개 CI gate로 만들기 전에 안정적인 Unity runner / licensing 전략이 필요합니다.

Source-level CI가 통과했다고 해서 생성된 Runtime bundle이나 Candidate ZIP이 모든 Release/Field gate를 통과했다는 뜻은 아닙니다. Source CI, Release artifact 검증, Unity 실행 검증, 두 PC 현장 검증은 서로 다른 Evidence 종류입니다.

## 보안 자동화 상태

저장소에는 Secret Protection / Push Protection, dependency alerts, CodeQL scanning 등 보안 자동화가 활성화되어 있습니다.

2026-08-18 검토 시점에 CodeQL의 **열린 Code scanning alert는 0개**였습니다. 이는 날짜가 붙은 검토 결과이며 영구적인 무결점 주장으로 읽으면 안 됩니다. 유용한 자동 분석 결과이지만, **보안 감사를 완료했다거나 취약점이 없다는 증명은 아닙니다.**

C# CodeQL Default setup은 C#이 `build-mode: none`으로 추출되어 **Low C# analysis quality** 경고도 표시했습니다. JavaScript/TypeScript와 GitHub Actions 분석은 정상 완료되었습니다. Unity-aware build 분석이 통합되기 전까지 C# CodeQL 결과는 부분적인 정적 분석 커버리지로 보는 것이 맞습니다.

민감한 보안 제보와 신뢰 경계는 [SECURITY.md](../.github/SECURITY.md)를 참고해 주세요.

## 과거 Candidate 검증과 현재 public `main`은 구분해야 합니다

저장소에는 특정 개발 Candidate를 대상으로 한 상세 검증 보고서가 많이 들어 있습니다. 일부 보고서에는 Unity, Node, Project Peer, Runtime integrity, packaging, field 검사 통과 기록이 있습니다.

이런 기록은 중요한 개발 증거이지만, **현재 `main`의 모든 Commit, 이후의 모든 0.5.1 Work Package, 미래의 모든 패키지 빌드가 같은 Test matrix를 그대로 통과했다는 의미는 아닙니다.**

현재 질문에 대한 Evidence 우선순위는 다음과 같습니다.

1. 구현 동작은 현재 source/tests
2. Capability / release readiness는 이 `STATUS.md`
3. 정확한 Candidate/Runtime 식별은 `release-contract.json`
4. Runtime contract/topology는 현재 module README와 `docs/architecture.md`
5. 패키지 Artifact 식별은 `builds/README.md`와 정확한 Release hash
6. Phase/work-state 기록은 해당 Candidate의 역사적 증거로만 사용

## 현재 Release / 설치 상태

현재 **일반 사용자에게 설치를 권장하는 TeamForge Release는 없습니다.**

공개 소스에는 생성된 Runtime payload, 패키지된 실행 파일, 로컬 Credential, Private key, Private machine state를 의도적으로 포함하지 않습니다. 일반 사용자 Host 경로는 패키지된 hash-verified `Runtime~/` payload를 기대하고, Fresh Guest 경로는 패키지된 `launcher/win-x64/` 폴더를 기대합니다. 이런 생성 Release layout은 Fresh source checkout에는 의도적으로 없습니다.

따라서 현재 공개 Unity package source를 가리키는 Git URL을 **완전한 일반 사용자 설치 경로처럼 홍보하면 안 되며**, README에 보이는 `launcher/win-x64/TeamForge.Launcher.exe` 같은 경로는 source에 Commit된 Binary가 아니라 패키지 Candidate의 Layout을 뜻합니다.

향후 공개 Alpha는 검증된 Package / Runtime / Launcher 조합을 정확한 Hash가 붙은 Release artifact로 제공하고, 실제 깨끗한 Unity 프로젝트에서 그 배포 Artifact 그대로 설치 테스트를 한 뒤 Quick Start를 공개하는 것이 맞습니다.

## 현재 Field validation 차단 항목

TeamForge를 일반 설치 가능한 Alpha로 소개하기 전에 최소한 다음 gate들을 **실제 배포하려는 정확한 Artifact**에서 닫는 것이 좋습니다.

1. 의도한 **Host → Invite → Guest → Project transfer → Activation → Realtime** 전체 흐름의 정확한 두 PC Windows 현장 검증
2. 개발 Workspace가 아니라 실제 공개할 **정확한 Artifact를 사용한 fresh-install 검증**
3. 정확한 Release artifact의 **Packaged runtime integrity** 검증 및 Runtime/dependency provenance, 생성 Manifest/Pin, Hash 확인
4. 전송 중단, Reconnect, 오래되거나 불일치한 State, Host/Seed 손실, 안전한 거부 경로에 대한 **Failure / Recovery 테스트**
5. 정확한 Release Candidate의 **Unity EditMode 검증 결과 보존**
6. 현재 WP5.1 managed/short-workspace가 containment, trust, final handoff를 약화하지 않는 **Path-resilience 검증**
7. 일반 사용자가 개발 Workspace를 이해하지 않아도 되는 **Install / Update / Uninstall 문서**
8. 프로젝트 제작자 한 명만이 아니라 **최소한 일부 외부 테스트**

이는 출시 날짜 약속이 아니라 준비 상태를 판단하기 위한 gate입니다.

## 중요한 현재 제한사항

- Backup을 유지하고 실험 단계에서는 disposable project를 권장합니다.
- TeamForge는 Git, Unity Version Control 또는 다른 Backup/History 체계를 대체하지 않습니다.
- Same-Scene Hierarchy 기능은 일반적인 Unity Scene/Prefab/Asset 협업보다 범위가 좁습니다.
- Cross-Scene 구조, 일반 Component sync, Inspector sync, Prefab 구조 sync, 일반 Asset sync는 현재 지원 범위 밖입니다.
- Persistent server/session restart recovery는 구현되어 있지 않습니다.
- TeamForge는 현재 WebRTC/ICE/STUN/TURN/relay/NAT traversal 또는 hosted internet relay service를 제공하지 않습니다.
- 현재 Direct P2P는 Project Peer끼리 직접 도달 가능해야 한다는 뜻이며, 인터넷 Peer를 자동 탐색/연결한다는 뜻이 아닙니다.
- Windows x64 packaged runtime/launcher 경로에는 개발 Candidate 검증 기록이 있지만, macOS/Linux bundled payload는 동등한 검증 Release artifact로 공개되어 있지 않습니다.
- 현재 Windows Launcher는 Authenticode signing이 되어 있지 않습니다.
- 임의로 깊은 Windows path를 지원한다고 보장하지 않습니다. WP5.1은 bounded managed path 전략을 사용합니다.
- TeamForge는 독립적인 전문 보안 감사를 완료하지 않았습니다.
- AI 보조 개발 비중이 높은 만큼 재현 가능한 테스트와 독립적인 검토가 더 중요합니다. 컴파일된다는 이유만으로 AI 생성/보조 코드가 올바르다고 가정하지 않습니다.

## 지금 저장소로 해도 되는 일

현재 합리적인 사용 범위는 다음과 같습니다.

- 소스 읽기와 코드 리뷰
- 네트워크 / 보안 가정 검토
- 자동화된 source-level 테스트 실행
- Disposable Unity project를 이용한 실험
- 버그 및 실패 사례 보고
- 코드, 테스트, 문서, 리뷰 기여

반대로 현재 프로젝트가 **중요한 프로젝트의 유일한 사본을 맡길 수 있는 안정적인 Production 협업 계층**이라고 보지는 않습니다.

## 관련 문서

- [README.ko.md](../README.ko.md) — 프로젝트 소개
- [release-contract.json](../release-contract.json) — 정확한 현재 Candidate / Runtime 식별
- [builds/README.md](../builds/README.md) — Current / Superseded 패키지 Artifact 분류
- [architecture.md](architecture.md) — 현재 as-built Runtime topology / authority boundary
- [project-state.md](project-state.md) — 현재 Engineering state 요약
- [known-issues.md](known-issues.md) — Current Candidate 제한사항 / 미검증 항목
- [deployment.md](deployment.md) — 패키지 Windows Candidate 배포 / Rollback contract
- [ROADMAP.ko.md](ROADMAP.ko.md) — 향후 방향
- [docs/SOURCE.md](SOURCE.md) — 소스 트리 안내
- [SECURITY.md](../.github/SECURITY.md) — 보안 기대사항 및 취약점 제보
- [CONTRIBUTING.md](../.github/CONTRIBUTING.md) — 테스트, 검토, 기여
- [unity-package/com.eunsung.teamforge/CHANGELOG.md](../unity-package/com.eunsung.teamforge/CHANGELOG.md) — 구현 이력
