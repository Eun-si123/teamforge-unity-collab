# TeamForge 当前状态

[English](STATUS.md) | [한국어](STATUS.ko.md) | **简体中文**

_最近文档审阅：2026-08-30（Asia/Seoul）。当前源的集成情况包括：WP5.1 核心现场阻断项（field blocker）的合并、2026-08-27 发布的修复后 r4 候选版本，以及 2026-08-30 合入的 r4 之后的仓库 / Launcher 可运行性工作。_

> [!WARNING]
> **早期公开预览（Early Public Preview）— 请勿将 TeamForge 作为重要 Unity 项目的唯一副本或恢复机制。**
>
> 当前源包含大量稳定化工作，并且已存在一个修复后的打包候选版本，但 Windows 物理现场验证闭环仍未完成。请在测试期间保留备份，并优先使用可随时弃用的项目。

本文件是**当前能力与发布就绪结论的规范人类可读来源**。其他文档应链接到本文件，而不要各自维护一份与之竞争的当前阻断项或验证状态副本。

关于确切的产品 / 运行时 / 协议选型，请使用 [`../release-contract.json`](../release-contract.json)。关于打包字节身份与已取代构建的规则，请使用 [`../builds/README.md`](../builds/README.md)。关于 bug 的详细讨论，请使用所链接的 GitHub issue。

## 当前状态一览

- 产品线：**`0.5.1`**
- 源谱系：**`0.5.1-wp5.1-path-resilience`**
- 最新已发布打包候选版本：**`v0.5.1-prealpha-wp5.1-r4`**
- r4 产物 SHA-256：**`390ecbe4dad9488acdd992cc7198b25bf6407debf050d78385b01e076275c030`**
- 打包目标：**Windows x64**
- 发布就绪状态：**FIELD BLOCKED**
- Unity 版本线：**`6000.3`**；记录在案的候选测试编辑器：**`6000.3.21f1`**
- 实时协议（Realtime Protocol）：**v1**
- 项目传输协议（Project Transfer Protocol）：**v1**
- 项目清单模式（Project Manifest Schema）：**v1**

### 源与打包候选版本

PR #81（`fix: close core Windows field blockers`）已于 2026-08-27 合入 `main`，合并提交为 `8a9bef7a785b2fd4b1842cf0ee70f6e5163481a7`。它包含了此前位于 PR #76 上的 #68/#74 Transform/Lock 恢复工作。

修复后的 `v0.5.1-prealpha-wp5.1-r4` 候选版本随后从 `main` 提交 `5fdebda8c91e3c858e894356eb4bb735bbc34885` 发布。其 Windows ZIP 为 `Unity-TeamForge-0.5.1-WP5.1-path-resilience-final-candidate-win-x64.zip`，SHA-256 为 `390ecbe4dad9488acdd992cc7198b25bf6407debf050d78385b01e076275c030`。

**对于最初的 #67/#68/#69/#70/#71/#74 物理现场验证闭环场景，r4 仍然是那个确切的已发布候选版本，并且它仍处于 FIELD BLOCKED 状态。** 发布行为与密码学身份并不能使这些场景闭环。

当前 `main` 已经超出了 r4 的源快照。特别是，2026-08-30 的仓库 / 可运行性合入除了文档、Test Lab、工程质量门禁（engineering-quality-gate）与发布工具方面的变更之外，还增加了 Windows Launcher 的 **Save support bundle** 行为及其隐私契约（privacy-contract）测试。这些 r4 之后的源变更不会追溯修改已发布的 r4 ZIP。

因此：

- 在记录专门针对既有 r4 现场阻断候选版本的证据时，使用 **r4**；
- 不要将 r4 描述为与当前 `main` 在字节上或行为上等同；
- 如果当前 `main` 要成为下一个打包候选版本，应发布一个新的不可变产物（artifact），并验证那个确切的产物，而不是把针对 r4 的结论延伸到更晚的源。

## 能力状态

| 领域 | 当前源状态 | 剩余边界 |
| --- | --- | --- |
| 已连接用户的 Presence（在线状态） | ✅ 已实现 / 已演练 | 更广泛的外部测试仍然有用 |
| Selection / Editor 感知 | ✅ 已实现 / 已演练 | 更广泛的外部测试仍然有用 |
| Transform 同步 | 🟡 已实现 / 稳定中 | #68/#74 源修复已合并；精确的物理双机争用复测仍未完成 |
| 基础锁定 / 所有权 | 🟡 已实现 / 稳定中 | 精确的物理双机争用与交接复测仍未完成 |
| 同一 Scene 的 Hierarchy 创建 / 删除 / 重命名 / 重挂父级 / 排序 | 🟡 已实现 / 稳定中 | 仅受支持的子集；更广泛的现场覆盖仍然有用 |
| 项目引导（bootstrap）/ 协作邀请（Collaboration Invite） | 🟡 已实现 / 稳定中 | #67 已保存 Guest 重连的源修复已合并；物理复测仍未完成 |
| 直接 P2P 项目传输 | 🟡 已实现 / 稳定中 | 当前源优先使用记住的精确 Seed 端口（默认 `5091`），冲突时回退到一个由 OS 分配的端口，并同步收敛为狭窄的 Windows 防火墙规则；打包版本的 LAN / 防火墙现场复测仍未完成 |
| 诊断 / 恢复 UX | 🟡 已实现 / 稳定中 | 当前源在 r4 之后增加了手动的隐私安全 Launcher 支持包；#69 中断 / 续传现场复测仍未完成 |
| Windows 路径韧性 / 执行别名 | 🟡 已实现 / 稳定中 | #71 精确规范别名交接源修复已合并；真实长路径 / 深层路径复测仍未完成 |
| Component / Inspector 同步 | ⏳ 计划中 | 通用 Component 增删与 `SerializedProperty` 同步尚不支持 |
| Prefab / 通用 Asset 协作 | ⏳ 计划中 | 目前不是受支持的工作流 |
| 服务器 / 会话重启的持久恢复 | ⏳ 计划中 | 当前权威 / 会话状态仍驻留在内存中 |
| 自动 Internet NAT 穿透 / 中继 | 🔬 研究 / 未来 | 没有 WebRTC、ICE、STUN、TURN、中继、发现机制或自动 NAT 穿透 |

## WP5.1 核心现场阻断项的源状态

r4 候选版本包含下面列出的原始 WP5.1 阻断项修复。当前源保留这些修复，并可能加入各行所述的后续加固；这些场景仍全部属于待完成的现场验证：

| Issue | 当前源 / 包状态 | 仍需要物理验证的内容 |
| --- | --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) — 已保存 Guest 的重连 | 修复已在 PR #81 中合并，并包含于 r4 | 为同一个已验证的 Project / 会话 / Baseline / 路径，重新打开一个合法保存的协作 Guest；全新 / 未验证的加入必须保持严格 |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) / [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) — 快速 Transform / 锁保护的冲突 | 恢复修复与首快照脏标记（first-snapshot dirtiness）修复已通过 PR #81 合并，并包含于 r4 | 物理双机 A/B 争用：输掉争用的一方在主动拖拽过程中不得回跳（snap），并在释放后收敛、保持可用 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) — 接收端关闭（receive shutdown） | 处理 `runtime_shutdown` 的路径已在 PR #81 合并，并包含于 r4 | 接收 → 关闭 / 终止 → 重启 / 恢复，且不出现未处理的 CLR / 应用错误 |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) — Seed / 防火墙接入 | r4 将 Seed 固定到 TCP `5091`；当前源把 `5091` 保留为默认记忆端口，冲突时回退到一个 OS 分配的端口，并同步为精确的 Private / LocalSubnet 防火墙规则 | 真实打包版本的 LAN / 防火墙接入、首选端口冲突回退、Seed 重启 / 重绑、规则替换 / 删除以及全新 Guest 传输 |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) — 执行别名交接 | 针对已批准的 TeamForge 自有别名的精确规范化解析已在 PR #81 合并，并包含于 r4 | 真实的长路径 / 深层路径 Guest 交接；无关或被重定向的别名仍必须失败即拒绝（fail closed） |

详细讨论应放在 GitHub issue 中。本页负责发布影响与当前摘要。

## 自动化与本地证据

在 PR #81 合并之前，其最终集成头部（final integrated head）通过了记录在 `docs/MAIN_PATCH_STATUS_2026-08-27.md` 中的仓库保护门禁：

- CI run #216：Server、Project Peer、Launcher 运行时加载器、Windows Launcher 与公开源契约 — **PASS**
- Dependency Review run #140 — **PASS**
- Unity Tests run #73 — **PASS**
  - Unity Lock Contention E2E
  - Unity Realtime Authority E2E
  - Realtime Authority Chaos E2E
  - Project Transfer Resume E2E
- 更早的本地 Unity Test Runner：**143 / 143 个可本地运行的测试 PASS**；两个仅限 CI 的真实服务器测试在本地被有意忽略
- 同机 A/B 争用恢复 — **PASS**
- A/B/C 后加入者的 Hierarchy/Transform 收敛 — **PASS**，在记录在案的运行中受保护冲突为零

r4 之后的集成工作也在其合并前的最终头部上，经由常规 CI、Engineering Quality Gate、Dependency Review、Pages、Authority Chaos Stress、Windows Launcher 构建 / 诊断安全测试以及四条 Unity E2E 流水线进行了演练。这是当前源集成的证据；它并不会把较早的 r4 ZIP 变成那些更晚源变更的打包产物。

r4 Release 已从上述打过补丁的 `main` 提交发布，附带策略上不可变的 ZIP/SHA 对。这确立了确切的产物身份；它不能替代物理双机 Windows 验证。

## 记录在案的物理双机证据 — 2026-08-22

在阻断场景被单独隔离出来之前，以下内容在记录在案的双机 Windows 现场流程中是可工作的：

- Host → 已签名的协作邀请（Collaboration Invite）→ 全新 Guest → 认证 → 直接 Project 传输 → Publisher 信任 → 已验证的 Active Project → Unity 实时连接
- Presence 与双向 Transform 同步
- 正常的锁 / 所有权争用
- 受支持的同一 Scene Hierarchy 创建 / 重命名 / 重挂父级 / 兄弟排序 / 删除
- 未保存的 Guest 退出 / 重新打开，并从仍在运行的会话中完成权威的 Hierarchy/Transform/Lock 恢复
- Coordinator TCP 中断 → 重试 → 无需重启 Unity 的自动重连

该基线证明常规路径并非完全未经测试，但它并不能使上述五个有针对性的 r4 Windows 现场场景闭环。

## 证据边界

一项结果只能证明它实际演练过的内容。

- 源 CI 并不能证明打包 ZIP 是正确的。
- Unity 自动化并不能复现所有 SceneView 输入顺序、Windows 进程状态、LAN / 防火墙状态或第二台机器的时序路径。
- 同机多项目测试能增强信心，但仍共享同一个操作系统、网络栈、时序环境与硬件。
- 一个成功的旧打包候选版本并不能证明更新的源修订版本或替代 ZIP。
- 仅有产品版本号并不构成字节身份；确切的打包证据需要确切的产物文件名与 SHA-256。
- 发布 r4 并计算其哈希证明的是产物身份，而不是物理现场验证闭环。
- 更晚的源测试并不能延伸 r4 的打包行为；源提交与确切产物都必须与所作出的结论相匹配。
- 历史性的阶段 / 工作状态 / 证据记录对其所记录的快照仍然有效，但就当前就绪状态而言不能取代本页。

## 剩余的发布就绪门禁

在将 TeamForge 提升为可普遍安装的 alpha 之前：

1. 对于既有的 WP5.1 现场阻断欠账，要么针对确切的 r4 完成那些有针对性的物理场景，要么有意用一个新候选版本取代 r4，并在那个确切的替代版本上重做适用的现场证据。
2. 针对选定用于现场验证闭环的产物，重跑 #67、#68/#74、#69、#70 与 #71 的物理 Windows 场景。
3. 从全新解压 / 全新项目状态开始，重跑常规的 Host → 全新 Guest → 实时协作路径。
4. 为现场运行保留确切的候选版本身份与证据。
5. 如果打包当前 `main`，应将 r4 之后的打包行为（例如 Launcher 支持包路径）作为新产物自身证据的一部分进行验证，而不是从源 CI 继承。
6. 验证其余重要的 host/server/seed/进程丢失与安全拒绝场景。
7. 改进安装 / 更新 / 卸载指引，并在作出广泛的可靠性结论之前，获得项目创建者以外的人员的测试 / 审阅。

服务器进程重启目前属于**断连 / 失败即拒绝 / 新会话的恢复**场景，而不是持久化测试：持久化的权威 / 会话重启恢复尚未实现。

## 信息归属

为避免文档漂移，请针对以下问题使用以下来源：

| 问题 | 规范来源 |
| --- | --- |
| 现在什么能用？什么被阻断？ | 本 `STATUS.md` |
| 选定了哪些确切的版本 / 运行时 / 协议？ | [`release-contract.json`](../release-contract.json) |
| 哪些确切的打包字节是当前 / 已被取代的？ | [`builds/README.md`](../builds/README.md) + GitHub Release SHA-256 |
| TeamForge 端到端是如何工作的？ | [`HOW_IT_WORKS.zh-Hans.md`](HOW_IT_WORKS.zh-Hans.md) |
| 有什么是计划中的？ | [`ROADMAP.md`](ROADMAP.md) |
| 当前系统的结构是怎样的？ | [`architecture.md`](architecture.md) |
| 某个架构决策为何而做？ | [`architecture-decisions.md`](architecture-decisions.md) |
| 命名验证场景如何运行？ | [`TEST_LAB.md`](TEST_LAB.md) |
| 某个 bug 的详细状态是什么？ | GitHub Issues |
| 更早的某次测试或稳定化过程中发生了什么？ | 带日期的阶段 / 工作状态 / 证据记录 |
