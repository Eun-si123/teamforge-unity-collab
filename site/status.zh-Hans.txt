# TeamForge 当前状态

[English](STATUS.md) | [한국어](STATUS.ko.md) | **简体中文**

_最近文档审阅：2026-09-10（UTC）。已对照当前 `main` 中 r5 之后的 Windows 网络、诊断与 Project identity 加固、已发布的 r5 产物，以及 2026-08-31 记录的精确 r5 物理现场结果。已发布包的证据与更新源码的证据仍分别处理。_

> [!WARNING]
> **早期公开预览（Early Public Preview）— 请勿将 TeamForge 作为重要 Unity Project 的唯一副本或唯一恢复机制。**
>
> 原始 WP5.1 Windows blocker 集合已经在精确 r5 上获得了大量双机现场验证，但当前 `main` 比 r5 更新，并包含尚未作为同一个精确替代包在物理 PC 上验证的 Windows 网络与身份行为。测试时请保留备份，并优先使用可随时丢弃的 Project。

本文件是**当前能力与发布就绪结论的规范人类可读来源**。其他文档应链接到本文件，而不是各自维护一份当前 blocker 或 validation 状态。

关于精确的 Product/Runtime/Protocol 选型，请使用 [`../release-contract.json`](../release-contract.json)。关于打包字节身份与 superseded build 规则，请使用 [`../builds/README.md`](../builds/README.md)。详细 Bug 讨论和历史复现记录请使用相关 GitHub Issue。

## 当前状态一览

- Product line：**`0.5.1`**
- Source lineage：**`0.5.1-wp5.1-path-resilience`**
- 最新已发布 Packaged Candidate：**`v0.5.1-prealpha-wp5.1-r5`**
- r5 Source/tag commit：**`a97b6ba5649e2888b909bf3c99c64acfd7042ba6`**
- r5 Windows ZIP：**`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`**
- r5 Artifact SHA-256：**`5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`**
- Packaged target：**Windows x64**
- Release-readiness state：**FIELD BLOCKED**
- Unity line：**`6000.3`**；记录在案的 Candidate test Editor：**`6000.3.21f1`**
- Realtime Protocol：**v1**
- Project Transfer Protocol：**v1**
- Project Manifest Schema：**v1**

### Source 与 Packaged Candidate

原始 WP5.1 稳定化修复 #67、#68/#74、#69、#70、#71 通过 PR #81 合入。之后，`v0.5.1-prealpha-wp5.1-r5` 从 commit `a97b6ba5649e2888b909bf3c99c64acfd7042ba6` 发布；r5 不仅包含这些 blocker 修复，也包含 r4 之后加入的 Windows Launcher **Save support bundle**。

2026-08-31，精确 r5 在两台物理 Windows PC 上进行了验证。记录表明：Saved Guest reconnect（#67）、Fresh late-join Transform snapshot regression（#68）、重复 Receive shutdown/resume race（#69）、Long/Deep-path Execution Alias handoff（#71）以及 stale lock-contention protected-conflict recovery（#74）均通过 r5 现场测试并关闭。相同的 r5 LAN 测试还验证了在所需 Firewall access 已存在时，Packaged Host Stop/Start 后 Seed TCP `5091` 重新绑定以及真实 Guest Project transfer。

因此，这些原始场景**并不是仍在等待第一次 r5 物理复测**。不过，这些证据不会把 r5 之后的源码变更自动加入 r5，也不会单独把 TeamForge 变成可普遍安装的 Alpha。

当前 `main` 已经比 r5 更新。因此：

- 描述最新 Published Package 和 2026-08-31 Exact field evidence 时，以 **r5** 为准；
- 不得将 r5 描述为与当前 `main` 在 bytes 或 behavior 上等同；
- 不应仅因为旧 STATUS 文案仍写着 Pending，就把已经关闭的 r5 blocker scenario 再次当作未验证；
- 如果当前 `main` 要成为新的 Candidate，应发布新的 Immutable Artifact，并在那个精确产物上验证 r5 之后新增的实际行为。

### r5 中不存在的后续 Source hardening

当前 Source 在 r5 发布后增加了以下有限范围的行为：

- Windows LAN Firewall onboarding：在用户明确同意并批准 Windows UAC 后，可以为 Coordinator/Seed 创建窄范围 inbound rule；规则限制为 Private profile 与 LocalSubnet，并包含 TeamForge-owned rule 的 reconciliation/cleanup。原始 r5 物理 LAN 测试当时仍需要手动允许 Firewall，因此这一较新的 Onboarding path 在支持更强的 Readiness 结论前需要 Exact-package physical evidence。
- 当首选/default Seed port 已被占用或不可绑定时的启动恢复，包括 Windows bind-context `EACCES`。Host 会使用 OS-assigned port 重试一次，并广播实际选择的 endpoint。Windows Project Peer 自动化覆盖已存在，但此行为晚于 r5。
- Project identity 创建的跨进程串行化与 Windows crash recovery：实时 ownership 使用 OS-owned named-pipe lock，同时用永久 compatibility fence 阻止旧 Writer 与新实现并发。Windows Node 22/24 crash/concurrency suite 已通过，但尚无包含此变更的 Published Package 完成精确物理现场验证。
- Coordinator rejection cleanup、HTTP cancellation/deadline hardening、Host diagnostics context 改进、WebSocket client-role log，以及 Launcher Invite 与 `TF1` Connection Code 的区分改进。

这些属于 Current Source/automation 事实，不是 r5 Packaged behavior。Linux/macOS 的 Project identity stale-lock recovery 也仍不在 Windows 专用恢复变更的范围内。

## 能力状态

| 领域 | 当前 Source 状态 | 当前 Evidence 边界 |
| --- | --- | --- |
| Connected-user Presence | ✅ 已实现 / 已演练 | 物理双机 baseline 已工作；更广泛的外部测试仍有价值 |
| Selection / Editor awareness | ✅ 已实现 / 已演练 | 更广泛的外部测试仍有价值 |
| Transform synchronization | 🟡 已实现 / 稳定中 | Exact r5 双机 late-join 与 contention recovery PASS；更广泛的 Field coverage 与 UX 后续仍有价值 |
| Basic locking / ownership | 🟡 已实现 / 稳定中 | Exact r5 contention/recovery PASS；另一 Peer 持有 Lock 时的编辑 UX 清晰度由 #79 后续处理 |
| Same-Scene Hierarchy create/delete/rename/reparent/order | 🟡 已实现 / 稳定中 | 支持的 subset 已有物理验证；更广泛的 Field coverage 仍有价值 |
| Project bootstrap / Collaboration Invite | 🟡 已实现 / 稳定中 | Exact r5 Saved Guest reconnect PASS；post-r5 Project identity crash recovery 尚无 Package/Field evidence |
| Direct P2P Project transfer | 🟡 已实现 / 稳定中 | Exact r5 `5091` Stop/Start + 真实 Transfer PASS；post-r5 Firewall onboarding 与 unavailable-port fallback 尚无 replacement-package Field evidence |
| Diagnostics / recovery UX | 🟡 已实现 / 稳定中 | r5 包含 Privacy-safe Launcher support bundle；之后的 Diagnostics 改进相对 r5 仍是 Source-only |
| Windows path resilience / Execution Alias | 🟡 已实现 / 稳定中 | Exact r5 真实 Long/Deep-path positive handoff PASS；恶意/无关 Alias 拒绝保留 Automated fail-closed coverage |
| Component / Inspector synchronization | ⏳ 计划 | 通用 Component Add/Remove 与 `SerializedProperty` sync 尚不支持 |
| Prefab / 通用 Asset collaboration | ⏳ 计划 | 当前不是支持的 Workflow |
| Persistent Server/Session restart recovery | ⏳ 计划 | 当前 Authority/Session state 仍驻留内存 |
| Automatic Internet NAT traversal / relay | 🔬 研究 / 未来 | 没有 WebRTC、ICE、STUN、TURN、Relay、Discovery 或自动 NAT traversal |

## Exact r5 物理 Field closure 记录

下表取代了旧文案中“原始 blocker 集合仍未完成精确物理验证”的错误状态。

| Issue | Exact r5 物理结果 | 当前剩余边界 |
| --- | --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) — Saved Guest reconnect | **PASS** — 正常 Collaborative edit/save → Guest Unity 关闭 → 同一个 Verified Active Project 再打开 → 无 `guest_handoff_mismatch` 地重新加入 Realtime | Fresh/unverified identity rejection 仍由严格实现与 Automated regression coverage 保护 |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) — Fresh late-join snapshot conflict | **PASS** — Fresh Guest 获得 Authoritative Hierarchy/Transform/Lock state，之后 Live Transform 也未进入错误 protected conflict | 更广泛 Scenario 仍有价值，但原始 Field blocker 已关闭 |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) — stale lock-contention protected conflict | **PASS** — 争用失败方恢复到 Authoritative state，随后 Collaboration 仍可继续使用 | 另一 Peer 持有 Lock 时的 UX 清晰度由 #79 单独追踪 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) — Receive shutdown | **PASS** — Receive 中多次从 Task Manager 强制结束 Launcher；重新启动后复用 Verified partial data 并完成 Resume；未复现原始 CLR/Application error | 未来 Runtime 变更仍应保持 Regression coverage，但原始 r5 Field blocker 已关闭 |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) — Seed / Firewall onboarding | **就 r5 Product goal 而言 PARTIAL / Stable-Seed path PASS** — Packaged Host Stop/Start 后在 TCP `5091` 重新绑定并完成真实 Guest transfer，但 Firewall access 需要预先存在 | Fresh automatic Windows Firewall onboarding 与更新的 unavailable-port fallback 在 r5 之后加入，需要 Exact replacement-package physical evidence |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) — Execution Alias handoff | **PASS** — Long/Deep destination 触发 Path optimization，Unity 打开，Realtime collaboration 成功 | 恶意/无关/retargeted Alias 拒绝保留 Automated fail-closed coverage |

详细 Timeline 由 GitHub Issue 维护。本页负责当前 Release effect。

## Automated / Local evidence

PR #81 合入前，其 Final integrated head 通过了 `docs/MAIN_PATCH_STATUS_2026-08-27.md` 中记录的 Repository protection gate：

- CI run #216：Server、Project Peer、Launcher runtime loader、Windows Launcher、Public-source contract — **PASS**
- Dependency Review run #140 — **PASS**
- Unity Tests run #73 — **PASS**
  - Unity Lock Contention E2E
  - Unity Realtime Authority E2E
  - Realtime Authority Chaos E2E
  - Project Transfer Resume E2E
- 较早的 Local Unity Test Runner：**143 / 143 locally runnable tests PASS**，两个 CI-only real-server test 在本地被有意 Ignore
- Same-machine A/B contention recovery — **PASS**
- A/B/C late-join Hierarchy/Transform convergence — **PASS**，记录的 run 中 protected conflict 为 0

之后的 Source hardening 也经过 Focused Project Peer/Launcher/Unity tests 与正常 Repository quality gate。特别是 Windows Project identity crash/concurrency suite 在受支持的 Node 22/24 line 上通过；unavailable Seed port regression path 也在复现 Windows 环境中通过 Full Project Peer suite。但这些结果不会把修复加入到此前已经发布的 bytes 中。

## 已记录的物理双机 Evidence

### 2026-08-22 baseline

在 Targeted blocker 被分离出来之前，Physical Windows flow 已证明：

- Host → Signed Collaboration Invite → Fresh Guest → Authentication → Direct Project transfer → Publisher trust → Verified Active Project → Unity realtime connection；
- Presence 与 Bidirectional Transform sync；
- 正常 Lock/Ownership contention；
- 支持的 Same-Scene Hierarchy create/rename/reparent/sibling-order/delete；
- Unsaved Guest exit/reopen 后从仍然存活的 Session 恢复 Authoritative Hierarchy/Transform/Lock；
- Coordinator TCP interruption → Retry → 无需重启 Unity 自动 Reconnect。

### 2026-08-31 Exact r5 closure

随后使用 Exact r5 ZIP/SHA pair 在两台物理 Windows PC 上关闭了上表中的 Saved reconnect、Fresh late-join、重复 Receive resume、Long/Deep-path 与 Lock contention recovery scenario。同一 Field pass 还验证了 Packaged Stable Seed `5091` Stop/Start 与真实 LAN transfer，并明确记录当时 Fresh Firewall onboarding 仍需要手动允许。

## Evidence 边界

一项结果只证明它实际执行过的内容。

- Source CI 不能证明 Packaged ZIP 正确。
- Unity automation 无法复现所有 SceneView input ordering、Windows process condition、LAN/Firewall state 或第二台机器 timing。
- Same-machine multi-project test 可以增强信心，但仍共享同一 OS、Network stack、Timing 与 Hardware。
- Exact r5 physical evidence 证明实际执行的 r5 bytes 与 Scenario，并不证明更晚的 `main` behavior。
- Product version 本身不是 Byte identity；Exact package evidence 需要准确的 Artifact filename 与 SHA-256。
- Bug Issue 被关闭并不自动说明同一 Subsystem 后来的所有实现都获得了 Package/Field evidence。
- Historical phase/work-state/evidence note 对其当时 Snapshot 有效，但不能覆盖本页的当前 Readiness。

## 剩余 Release-readiness gate

在将 TeamForge 提升为可普遍安装的 Alpha 之前：

1. 将 Exact r5 physical 结果保留为已完成 Evidence；不要再把 #67/#68/#69/#71/#74 写成仿佛从未完成 r5 closure。
2. 如果选择当前 `main` 用于分发，应发布新的 Immutable Candidate，因为 post-r5 Runtime behavior 不存在于 r5 中。
3. 在那个精确 Replacement Artifact 上验证面向用户的重要 post-r5 Windows Networking lifecycle：Fresh Firewall onboarding、窄 Rule scope/lifecycle、Preferred-port unavailable/collision fallback、实际 Advertised Seed reachability、Host Stop/Start 和 Fresh Guest transfer。
4. 在 Exact replacement artifact 上验证 post-r5 Windows Project identity crash recovery，包括 Process loss 后的安全重启，以及 Ambiguous/Conflicting identity 继续 Fail closed。
5. 在 Exact replacement artifact 上执行 Fresh extraction Host → Fresh Guest → Realtime collaboration smoke test，避免把 r5 Evidence 默认继承给更晚 Packaging/Integration 变更。
6. 保留准确 Candidate filename/SHA/Source identity，并只记录实际执行的 Scenario。
7. 继续完善 Install/Update/Uninstall 指南，并在进行广泛 Reliability 宣称之前获得 Project creator 之外用户的 Testing/Review。

Server process restart 当前是 **Disconnect/Fail-closed/New-session recovery** Scenario，而不是 Persistence test；Durable Authority/Session restart recovery 尚未实现。

## 信息所有权

为避免文档 Drift，请按以下来源回答问题：

| 问题 | 规范来源 |
| --- | --- |
| 现在什么可用、什么受阻？ | **本 `STATUS.zh-Hans.md` / 英文 `STATUS.md`** |
| 精确 Version/Runtime/Protocol 选择？ | [`release-contract.json`](../release-contract.json) |
| 当前/Superseded Packaged bytes？ | [`builds/README.md`](../builds/README.md) + GitHub Release SHA-256 |
| TeamForge 端到端如何工作？ | [`HOW_IT_WORKS.zh-Hans.md`](HOW_IT_WORKS.zh-Hans.md) |
| 未来计划是什么？ | [`ROADMAP.md`](ROADMAP.md) |
| 当前 System 结构？ | [`architecture.md`](architecture.md) |
| Architecture 决策原因？ | [`architecture-decisions.md`](architecture-decisions.md) |
| Named validation scenario 如何运行？ | [`TEST_LAB.md`](TEST_LAB.md) |
| Bug 详细状态？ | GitHub Issues |
| 过去 Test/Stabilization pass 发生了什么？ | Dated phase/work-state/evidence notes |
