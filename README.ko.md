# TeamForge — Unity Editor 실시간 협업

**Build together. Stay in sync.**

*Zero-config first, never zero-control.*

![상태: 초기 공개 프리뷰](https://img.shields.io/badge/status-early%20public%20preview-orange)
[![라이선스: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

[English](README.md) | **한국어** | **[현재 상태](docs/STATUS.ko.md)** | [변경 기록](CHANGELOG.md) | [로드맵](docs/ROADMAP.ko.md) | [Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions) | [기여하기](.github/CONTRIBUTING.md) | [보안](.github/SECURITY.md)

**TeamForge** *(임시 이름)* 는 **Unity Editor를 위한 오픈소스 실시간 협업 프로젝트**입니다. 여러 사람이 같은 Unity 프로젝트를 작업할 때 **실시간 Scene 변경, 접속자 Presence, 같은 Scene의 Hierarchy 협업, Lock / Ownership, Direct P2P Project bootstrap 및 전송**을 하나의 협업 흐름으로 연결하는 것을 실험합니다.

> [!WARNING]
> **초기 공개 프리뷰 — 소스는 공개되어 있지만 일반 설치를 권장하는 단계는 아닙니다.**
>
> TeamForge는 아직 안정화 중이며 중요한 Unity 프로젝트의 유일한 사본이나 복구 수단으로 사용할 준비가 되지 않았습니다. Backup을 유지하고 초기 테스트에는 Disposable project를 권장합니다. 정확한 Release 준비 상태와 남은 Field blocker는 **[STATUS.ko.md](docs/STATUS.ko.md)** 를 확인해 주세요.

## 데모

![TeamForge Unity Editor 실시간 협업 데모](TeamForge-readme-demo-hq-1280-12fps.gif)

두 Unity Editor 인스턴스가 TeamForge로 연결되어 Editor 변경 사항을 실시간으로 공유하는 개발 중 프로토타입 영상입니다. 기능의 현재 방향을 보여주는 영상이며 Production readiness를 의미하지 않습니다.

## 한눈에 보는 현재 상태

| 영역 | 현재 상태 |
| --- | --- |
| 연결된 사용자 Presence | ✅ 프로토타입 존재 |
| Selection / Editor awareness | ✅ 프로토타입 존재 |
| Transform 동기화 | ✅ 프로토타입 존재 |
| Same-Scene Hierarchy 생성/삭제/이름변경/Reparent/순서 | 🟡 구현 / 안정화 중 |
| Object Lock / Ownership | 🟡 구현 / 안정화 중 |
| Project bootstrap / Collaboration Invite | 🟡 구현 / 안정화 중 |
| Direct P2P Project transfer | 🟡 구현 / 안정화 중; 직접 연결 가능해야 함 |
| Resume, Integrity check, Staging, Diagnostics, Recovery | 🟡 구현 / 안정화 중 |
| Windows Path resilience / Managed short execution path | 🟡 구현 / 안정화 중 |
| Component / Inspector / Prefab / 일반 Asset 협업 | ⏳ 계획 |
| 일반 사용자용 Packaged Alpha | ⏳ 아직 준비되지 않음 |

현재 Source 제품 버전: **`0.5.1`** · 패키지 대상: **Windows x64** · 현재 Candidate 상태: **FIELD BLOCKED**

정확한 Release ID, Candidate tag, Runtime / Protocol 식별, Field 검증 기록과 남은 출시 조건은 **[STATUS.ko.md](docs/STATUS.ko.md)** 와 **[release-contract.json](release-contract.json)** 을 확인해 주세요. 패키지 Artifact와 SHA-256 식별 규칙은 **[builds/README.md](builds/README.md)** 에 정리되어 있습니다.

## 왜 TeamForge를 만들고 있나요?

TeamForge는 처음부터 공개 개발 도구를 만들겠다는 계획으로 시작한 프로젝트가 아닙니다. 친구와 Unity 게임을 만들던 중 **두 Unity Editor가 서로 통신하고 편집 상황을 공유하면서 실시간으로 함께 작업할 수 있다면 어떨까?** 하는 생각에서 시작했습니다.

처음에는 친구와 제가 언젠가 직접 써볼 수 있는 실험적인 도구에 가까웠습니다. 만들다 보니 같은 아이디어가 친구끼리 만드는 팀, 학생, 소규모 팀, 인디 개발자에게도 유용할 수 있을지 궁금해졌고, 다른 사람도 소스를 확인하고 테스트하고 개선할 수 있는 공개 프로젝트로 발전시키게 됐습니다.

Version control은 매우 유용하며 TeamForge는 **Git, Unity Version Control 또는 다른 Version control / Backup system을 대체하려는 도구가 아닙니다.** 대신 Unity Editor 안에서 가까이 붙어 협업할 때 생기는 이런 마찰에 집중합니다.

- "지금 어떤 버전의 프로젝트 가지고 있어?"
- "프로젝트 좀 보내줄래?"
- "이 오브젝트 네가 움직였어, 내가 움직였어?"
- "지금 이 Scene 수정 중이야?"
- "왜 네 컴퓨터에서는 되는데 내 컴퓨터에서는 안 되지?"
- 다른 개발자가 작업을 시작하기 전에 프로젝트 파일을 기다려야 하는 상황

TeamForge는 **실시간 Editor 협업**과 **Project bootstrap / transfer tooling**을 함께 사용해 이런 마찰을 줄일 수 있는지 실험합니다. 동시에 실패, 복구, Identity, Networking, Trust boundary를 숨겨진 “마법”처럼 처리하지 않고 눈에 보이게 만드는 것도 중요하게 보고 있습니다.

## 목표로 하는 사용 흐름

장기적으로 일반적인 사용 흐름은 대략 다음처럼 단순해지는 것을 목표로 합니다.

1. Unity Project를 엽니다.
2. Start Collaboration을 누릅니다.
3. 다른 개발자를 초대합니다.
4. 초대받은 개발자가 참여에 필요한 Project state를 준비합니다.
5. 두 Editor가 연결됩니다.
6. Project / Scene 변경 사항을 계속 수동으로 주고받지 않고 협업 형태로 확인합니다.

이 여섯 단계 안에는 Synchronization, Object identity, Networking, Security, Recovery와 관련된 어려운 문제가 많이 숨어 있습니다. TeamForge는 그 문제들을 실제로 해결할 수 있는지 진지하게 실험하는 프로젝트입니다.

## 중요한 현재 제한사항

TeamForge는 아직 실험적인 Collaboration layer이며 완성된 Production platform이 아닙니다. 특히 현재는 다음과 같은 경계가 있습니다.

- Same-Scene Hierarchy 기능은 일반적인 Scene / Prefab / Asset 협업보다 범위가 좁습니다.
- 일반 Component / Inspector / Prefab / Asset synchronization은 현재 지원되는 일반 workflow가 아닙니다.
- Persistent server/session restart recovery는 구현되어 있지 않습니다.
- 현재 `P2P`는 **Project Peer끼리 Project payload를 직접 전송한다**는 뜻입니다. 같은 PC, LAN, 관리된 VPN 등에서 직접 도달 가능해야 하며 자동 Peer discovery, WebRTC/ICE/STUN/TURN, Relay 또는 자동 Internet NAT traversal은 제공하지 않습니다.
- 일반 사용자 경로는 Packaged Runtime / Launcher artifact를 기대하지만 이 생성물은 canonical source에 의도적으로 포함하지 않으므로 Source Git URL 자체가 **완전한 일반 사용자 설치 경로는 아닙니다.**
- 현재 Windows Launcher는 Authenticode signing이 되어 있지 않습니다.
- 임의로 깊은 Windows Path를 지원한다고 보장하지 않습니다. 현재 WP5.1 계열은 bounded managed path / short execution-path 전략을 사용합니다.
- 독립적인 전문 보안 감사를 완료한 상태가 아니며 모든 Data loss, malicious peer, implementation mistake, edge case에 대해 안전성을 보장할 수 없습니다.

전체 검증 상태, 제한사항, Release 준비 조건은 **[STATUS.ko.md](docs/STATUS.ko.md)** 에 정리되어 있습니다.

## 소스와 검증

현재 TeamForge 소스는 **테스트, 검토, 보안 피드백 및 기여**를 위해 공개되어 있습니다. 소스 구조와 Contributor workflow는 **[docs/SOURCE.md](docs/SOURCE.md)** 에서 시작할 수 있습니다.

주요 영역은 다음과 같습니다.

- `unity-package/com.eunsung.teamforge/` — Unity Editor package source와 Editor tests
- `server/` — coordination/session server source와 tests
- `project-peer/` — Project bootstrap / direct-transfer tooling과 tests
- `launcher/` — Windows Launcher source와 tests; packaged `win-x64/` 출력은 별도 생성
- `scripts/` — 개발, source validation, release validation, packaging 도구
- `docs/` — 현재 Architecture/Status와 역사적 test, release, engineering 기록

생성된 Runtime payload, Packaged executable, Release ZIP/Manifest, Local credential, Private key, Machine-specific state는 canonical source에 의도적으로 포함하지 않습니다.

### Fresh clone 검증

일반적인 Public source checkout에서는 다음을 사용합니다.

```powershell
npm run install:all
npm run validate
npm test
```

`npm run validate`는 **Public source validator**이며 생성된 Runtime / Launcher / Release audit 파일을 요구하지 않습니다. 반대로 `npm run validate:release`는 **완전히 Staging된 Release Candidate 전용 validator**이므로 생성 Artifact가 없는 일반 Source checkout에서는 통과하도록 설계된 명령이 아닙니다.

### 자동 검사

GitHub Actions는 Server, Project Peer, Launcher runtime-loader, .NET Windows Launcher 경로를 검사합니다. 관련 Pull Request와 `main` Push에서는 Unity `6000.3.21f1` EditMode / Real-server E2E, Deterministic Authority / Recovery Chaos 테스트와 Repository Security automation도 실행됩니다.

Green CI와 자동 보안 스캔은 중요한 검증 근거이지만 독립 Review나 정확한 실제 환경 Field validation을 대체하지는 않습니다. 현재 검증 근거와 남은 두 PC Windows 테스트 조건은 **[STATUS.ko.md](docs/STATUS.ko.md)** 에서 확인할 수 있습니다.

## 개발 기록

TeamForge는 초기 Editor 연결 프로토타입부터 Presence, Transform/Lock 동기화, P2P Project bootstrap, Hierarchy 동기화와 이후 안정화 작업까지 단계적으로 개발되어 왔습니다.

- **[변경 기록](CHANGELOG.md)** — 버전별 주요 변경 사항과 상세 Package history로 이동하는 시작점
- **[Phase 기록](docs/phases/)** — Phase 0부터 Phase 4까지의 개발 기록
- **[Work-state 기록](docs/work-state/)** — 구현, 디버깅, Hotfix, Decision, Handoff 과정의 작업 기록

일부 Work-state 파일은 원래 내부 Engineering note로 작성되어 표현이 거칠거나 이후 문서에 의해 대체된 부분이 있을 수 있습니다. 프로젝트가 실제로 어떻게 구현되고 문제를 어떻게 추적·수정했는지 확인할 수 있도록 공개 상태로 유지하고 있습니다.

## 도움과 피드백을 구하고 있습니다

TeamForge를 만드는 사람과 검증하는 사람이 계속 같은 한 명뿐인 구조로 두고 싶지는 않습니다. 특히 다음과 같은 도움이 유용합니다.

- 🧪 **Disposable project에서 프로토타입을 테스트하고 깨뜨려 보기**
- 🧩 **Unity / C# Review**
- 🌐 **Networking / P2P Review**
- 🔐 **Security Review**
- 📝 **Documentation, UX, Translation**

**[Help wanted: testers, Unity/C# reviewers, networking & security feedback](https://github.com/Eun-si123/teamforge-unity-collab/issues/2)** 또는 **[CONTRIBUTING.md](.github/CONTRIBUTING.md)** 에서 시작할 수 있습니다. 자유로운 질문과 아이디어는 **[GitHub Discussions](https://github.com/Eun-si123/teamforge-unity-collab/discussions)** 를 사용해 주세요.

초기 단계의 비판적인 피드백도 중요합니다. 특히 이런 질문에 대한 의견을 받고 싶습니다.

- 현재 Unity Project를 어떻게 협업하고 있나요?
- 가장 불편한 부분은 무엇인가요?
- Live Scene / Editor collaboration이 실제로 도움이 될까요?
- Project sharing / bootstrap이 Live editing보다 더 중요한가요?
- 어떤 점 때문에 이런 도구를 사용하지 않을 것 같나요?
- 실제 Project에서 신뢰하려면 무엇이 더 필요할까요?

**[Would you use TeamForge? Early feedback wanted](https://github.com/Eun-si123/teamforge-unity-collab/issues/1)** 에 답해도 좋습니다.

## AI 보조 개발 공개

TeamForge는 **사람이 방향을 정하고 명세를 중심으로 진행하는 방식으로 AI의 도움을 상당히 많이 받아 개발**되고 있습니다. 저는 주로 Project intent, 목표, 원하는 동작, 제약사항, 피드백, 테스트 결과와 증거, 최종 결정을 제공하고 AI 도구는 요구사항 구체화, 설계 선택지, 구현, 테스트, 분석과 문서 작성에 관여합니다.

이 설명은 모든 코드 한 줄을 제가 직접 작성했거나 전문적으로 Review했다는 뜻이 아닙니다. TeamForge에는 AI 보조 및 AI 생성 자료가 상당히 포함되어 있으며 AI 출력이 자동으로 맞다고 가정하지 않습니다. 특히 Architecture, Race condition, Security issue, Data-loss scenario, Edge case에는 경험 많은 독립 Review가 여전히 중요합니다.

AI-assisted contribution도 허용하지만 제출자는 결과를 실제로 검토하고 테스트하며 책임져야 합니다. 자세한 내용은 **[CONTRIBUTING.md](.github/CONTRIBUTING.md)** 를 확인해 주세요.

## 안전과 보안

현재 TeamForge Build는 모두 실험적인 Software로 취급해 주세요.

- Backup을 유지합니다.
- 초기 테스트에는 Disposable project를 권장합니다.
- 동작과 Compatibility가 바뀔 수 있다고 예상합니다.
- Credential, Access token, Invite secret, Sensitive data를 Log에 공개하지 않습니다.
- 모르는 Fork나 Build는 신뢰할 근거가 생기기 전까지 Untrusted로 취급합니다.

보안에 민감한 제보는 **[SECURITY.md](.github/SECURITY.md)** 를 따르고, GitHub Private Vulnerability Reporting을 사용할 수 있다면 민감한 제보에는 그 방식을 우선해 주세요.

## 오픈소스 방향과 라이선스

TeamForge는 **GNU Affero General Public License version 3 (AGPLv3)** 로 공개되는 오픈소스 프로젝트입니다.

AGPLv3를 선택한 이유 중 하나는 TeamForge가 Networking software이기 때문에 수정된 covered version도 검토 가능한 상태로 남기를 원하기 때문입니다. 하지만 Open source라는 사실만으로 특정 Build가 안전해지는 것은 아닙니다.

**TeamForge는 [Eun-si123](https://github.com/Eun-si123) / BlackProtogen이 처음 구상하고 시작한 프로젝트입니다.** 이후 Contributor와 Fork는 각자의 작업에 대해 적절한 Credit을 받아야 합니다.

실제 License / Attribution 조건은 **[LICENSE](LICENSE)**, **[NOTICE](NOTICE)**, **[AUTHORS.md](AUTHORS.md)** 를 확인해 주세요.

## 저장소 안내

| 문서 | 용도 |
| --- | --- |
| [STATUS.ko.md](docs/STATUS.ko.md) | 현재 기능, 검증 상태, 제한사항, Alpha 준비 조건 |
| [release-contract.json](release-contract.json) | 정확한 현재 Product / Release / Runtime / Protocol 식별 |
| [builds/README.md](builds/README.md) | Current / Superseded Package Artifact와 Hash 식별 규칙 |
| [architecture.md](docs/architecture.md) | 현재 as-built Topology와 Authority / Trust boundary |
| [CHANGELOG.md](CHANGELOG.md) | 버전별 주요 변화와 상세 개발 기록으로 이동하는 시작점 |
| [docs/phases/](docs/phases/) | Phase 0–4 개발 기록 |
| [docs/work-state/](docs/work-state/) | 구현, 디버깅, 안정화 과정의 원본에 가까운 작업 기록 |
| [docs/SOURCE.md](docs/SOURCE.md) | Public source tree, Fresh-clone validation, Review 시작점 |
| [ROADMAP.ko.md](docs/ROADMAP.ko.md) | 개발 방향과 향후 작업 |
| [CONTRIBUTING.md](.github/CONTRIBUTING.md) | 테스트, 리뷰, 문서, 기여 방법 |
| [SECURITY.md](.github/SECURITY.md) | 보안 기대사항 및 취약점 제보 |
| [SUPPORT.md](.github/SUPPORT.md) | 질문 / 문제 종류에 따른 제보 위치 |
| [AUTHORS.md](AUTHORS.md) | 프로젝트 시작 및 Contributor Credit |
| [NOTICE](NOTICE) | AGPLv3와 함께 제공되는 Attribution / Origin 안내 |
| [LICENSE](LICENSE) | GNU AGPLv3 License text |

## 개발 속도

TeamForge는 **개인 오픈소스 프로젝트이며 회사가 지원하는 Full-time Product가 아닙니다.** 학교, 휴식, 친구, 게임, 다른 취미, 일상생활 때문에 개발 속도가 느려지거나 잠시 멈출 수 있습니다.

조용한 기간이 있다고 해서 **자동으로 Project가 abandon되었다는 뜻은 아닙니다.** 지속 불가능한 속도를 약속하기보다 오래 유지할 수 있는 속도로 만드는 편을 선호합니다.