# TeamForge 当前状态

> **2026-11-22 源码进展（不是新发行版）：** [#578](https://github.com/Eun-si123/teamforge-unity-collab/pull/578)、[#611](https://github.com/Eun-si123/teamforge-unity-collab/pull/611)、[#610](https://github.com/Eun-si123/teamforge-unity-collab/pull/610)、[#613](https://github.com/Eun-si123/teamforge-unity-collab/pull/613)、[#608](https://github.com/Eun-si123/teamforge-unity-collab/pull/608) 和 [#612](https://github.com/Eun-si123/teamforge-unity-collab/pull/612) 已合并到源码 main。Unity 原生编辑 [#607](https://github.com/Eun-si123/teamforge-unity-collab/pull/607) 仍是草稿；外部 Prefab 实时协作([#600](https://github.com/Eun-si123/teamforge-unity-collab/pull/600))和两台 Windows Editor 的实机验证仍未完成。已发布的 r11 ZIP 没有改变，发布准备状态仍为 **FIELD BLOCKED**。详情请参阅[最新英文状态](STATUS.md)。

> **r11 release update (2026-11-21):** [r11 Windows test ZIP](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r11) passed exact ZIP validation, but new M1–M4 functions have NOT passed two-physical-PC Windows tests; **FIELD BLOCKED** remains. The text below is a dated translation snapshot; refer to the [current English STATUS](STATUS.md) for up-to-date claims.

[English](STATUS.md) · [工作原理](HOW_IT_WORKS.zh-Hans.md)

_这是与 2026-11-20 源码状态的英文权威文档 `STATUS.md` 对照后的预览翻译。涉及详细证据、Issue 和最新判断时，以英文版为准。_

> **早期公开预览：不要把 TeamForge 当作重要 Unity Project 的唯一副本或唯一恢复手段。** 请保留备份，并优先使用可丢弃的测试 Project。

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## 当前概览

**2026-11-20 源码状态更新：**M1/M2/M3 和需要显式启用的 M4 Session 持久恢复已经合并至 `main`。**r9/r10 在两台真实 Windows 电脑上的基础协作、重连测试已执行并报告 PASS**；这些历史结果不代表后来 M1–M4 的新功能已在两台物理 Editor 上测试。最新发行包仍为 r10，发布准备状态为 **FIELD BLOCKED**。

- 产品线：`0.5.1`
- Source lineage：`0.5.1-wp5.1-path-resilience`
- 最新已发布候选：`v0.5.1-prealpha-wp5.1-r11`
- r11 Source commit：`5868efe02975aa94b2acd79f5dec39a7b830aa26`
- Windows ZIP：`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r11-win-x64.zip`
- SHA-256：`28774bccb9fb20da0d72fce38d9bab7645dac1b876de182fbd33ee421170a989`
- 目标：Windows x64
- 发布准备状态：**FIELD BLOCKED**
- Unity 系列：`6000.3`（已记录测试 Editor：`6000.3.21f1`）
- Realtime / Project Transfer / Project Manifest：**v1**

## M1 源码集成：Collider 共同编辑

M1 需要明确启用源码选项，不包含在已发布的 r10 ZIP 中。它将已保存、非 Prefab Scene 中 BoxCollider/SphereCollider 的 trigger、center、size/radius 接入真实的签名 Scene/meta 数据验证 → Server Authority → WebSocket → Unity Editor 路径。首次验证后，未保存的 Scene 可依靠服务器运行时 ledger、共同 revision/history 和 GameObject lock 连续编辑。Collider Collaboration 窗口提供仅针对本人变更的条件式 Undo/Redo，以及供用户查看未确认本地值并明确重新提交的恢复收件箱。服务器提交、Editor 应用报告和磁盘保存分别显示。

证据分为四个阶段。**实现**：M1 已通过 [PR #533](https://github.com/Eun-si123/teamforge-unity-collab/pull/533) 合并到 main。**自动验证**：真实 Node WebSocket 测试通过。**Unity 集成**：[精确源码的 CI](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/43329700733) 已在三个 Unity 版本中通过一个真实 Editor＋Node peer 的 Collider 编辑、条件 Undo 和重连测试；本 Linux 环境中的 Unity 执行仍为 NOT RUN。**打包与 Windows 实机**：两个物理 Editor 和新发布包验证仍为 **NOT RUN**。已发布的 r10 ZIP 未变，状态仍是 **FIELD BLOCKED**。M2 组件增删 [#559](https://github.com/Eun-si123/teamforge-unity-collab/pull/559) 与晚加入修复 [#565](https://github.com/Eun-si123/teamforge-unity-collab/pull/565) 已于 2026-11-18 合并至 main，属于默认关闭的源码功能。三个 Unity 版本中一个真实 Editor＋Node peer 的 CI 已通过，但两个物理 Editor、新发布包仍为 **NOT RUN**，已发布 r10 不包含它。 2026-11-19，M3 内置 Cube/Sphere 的共享创建与删除通过 PR #569 合并到 main，属于需手动开启的源码功能。一个真实 Editor 与 Node peer 的三个版本 Unity CI 通过（40 项 PR 检查）。两台物理 Editor 和新安装包仍为 NOT RUN，已发布 r10 不含 M3，状态仍为 FIELD BLOCKED。

当前限制为每个 Session 一个 Scene、最多保留 128 个内存 Session、512 个 Collider／1536 个属性，数值须有限且位于 ±100／0–100。未支持字段仅在本地生效；Component 增删、Prefab、已加入 Collider 的所属对象或祖先删除需要 M2，活动 M1 路径会拒绝这些操作。编辑者必须协商并加入兼容能力。所有 peer 断开后 ledger 仍保留在内存，在未启用 M4 的原模式下，**服务器重启会丢失内存状态**；现在的可选 M4 模式会将已确认 Session 状态保存到 SQLite。本地恢复箱本身不等于服务器持久化。两个 Unity Editor、三人 late join、保存重开、8 Editor 一小时 soak 和确切 Windows 包验证仍是独立待验项目。M2/M3/M4 已合入源码；本地未确认 Transform 的单独恢复流程仍在 PR #574 中。详见[最新英文 STATUS](STATUS.md)和[运行设置](../server/README.md)。

## M4 源码集成：Coordinator 重启后恢复持久化 Session

2026-11-20，[PR #572](https://github.com/Eun-si123/teamforge-unity-collab/pull/572) 已合并到 `main`（`f3b33413ecaa7f06c87e99734694d336a8acf4c6`）。这不是 r10 已发布 ZIP 的功能。通过 `TEAMFORGE_DURABLE_SESSION_DB` 和经过批准的 `TEAMFORGE_COMPONENT_PROJECT_ROOT` 配置，Coordinator 在确认前以 SQLite 事务保存已接受的 Hierarchy、Transform、Collider 状态及操作结果；重新打开相同的已签名 Session 时使用新 authority epoch，且不恢复旧连接、Presence 和锁。[配置说明](../server/README.md#m4-coordinator-restart-recovery)。

**自动化验证：**已合并的 M4 PR 通过了 36 项 CI 检查，包括 Node/SQLite、进程重启及三个 Unity 版本的真实 Editor + Node peer E2E。**实机范围：**之前 r9/r10 的双 Windows PC 基础协作、重连和 Host 重启已报告 PASS（[r10 记录](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md)），但新 M4 SQLite Session 持久恢复的物理双机测试、新发行包与长时间负载测试仍为 **NOT RUN**。准备状态保持 **FIELD BLOCKED**。

## r8 发布及验证范围

r8 于 2026-10-10 发布，包含 PR #209 的 Direct Seed 健康状态检查、已验证 Existing-Active 的安全重新打开，以及拒绝嵌套 Project 根目录等修复。已发布 ZIP 通过 Windows Exact Release Validation（运行 38019297086），但**尚未在两台真实 Windows 电脑上完成 r8 测试**；发布状态仍为 **FIELD BLOCKED**。下方 r7 测试结果仅是历史证据，不代表 r8 实机验证。之后合并的 PR #217 和 #219 不包含在 r8 ZIP 中。

## r7 的证据边界

r7 于 2026-10-03 从 commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a 发布，并在发布后通过 Windows **Exact Release Validation**。自动流程重新下载 Release ZIP，验证 SHA-256 和 release manifest 中每个文件的 hash，在包含韩文字符与空格的新路径中从不同工作目录解压，并验证打包 Runtime/Node、Launcher fail-closed 行为、Windows path resilience 与真实 junction 检查。

这些属于 **精确包的自动化证据**。随后一次使用 r6 Host 与精确 r7 Guest 的真实双机测试中，Guest 复用了已有 managed root，未再出现 `destination_contains_unmanaged_content`；将可信 Host LAN 的 Windows profile 从 Public 改为 Private 后，流程继续通过 Publisher trust、Project receive 与 Unity 启动，并由用户报告 TeamForge 已成功连接。不过，这仍未证明两台机器都使用 exact r7、全新非管理员 UAC onboarding、Seed port fallback，或异常 process loss 后的真实 Project identity recovery。因此状态仍是 FIELD BLOCKED。

2026-08-31 使用精确 r5 在两台 Windows 电脑上获得的 reconnect、late join、receive/resume、long-path、lock contention，以及 Seed `5091`/传输结果仍是有效历史物理证据。发布 r7 不会改写 r5 的 bytes 或既有结果。

## 当前功能范围

Presence、Selection、Transform 同步、基础 lock/ownership、受支持的 Same-Scene Hierarchy 操作、直接 P2P Project transfer、诊断/恢复 UX、Windows path resilience 已实现或处于稳定化阶段。r7 还包含 post-r5 Windows firewall onboarding、不可用/冲突 Seed port fallback、Windows Project identity crash recovery、额外 diagnostics，以及 `TeamForge · Locked by <owner>` SceneView 提示。

通用 Component/Inspector 同步、Prefab/通用 Asset collaboration 和自动 Internet NAT traversal/relay 仍不受支持。M4 可选 Session 持久恢复已在源码中实现，但尚未通过新发行包与物理双机验证。

## 后续 r7-on-Host 阻塞与 r8 重测

[同一现场会话的后续记录](PHYSICAL_FIELD_EVIDENCE_2026-10-04.md#later-r7-on-host-follow-up-new-blockers-exposed)还发现：Host 显示 Ready 时没有可发现的 Direct Project Peer（`baseline_unavailable`）；打开已有 verified Project 绕过短 execution alias，出现长路径 `DirectoryNotFoundException`；Source 审查还发现，选用单个 Project UUID 目录作为 Projects root 可能形成嵌套 UUID。

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) 已于 2026-10-08 合并到 `main`，修复**已包含在发布的 r8 ZIP 中**。r8 的 Windows Exact Release Validation（运行 38019297086）已通过，但仍需在两台真实 Windows PC 上重新测试：Direct Seed 丢失时撤销 Ready、通过短路径重新打开 Existing-Active，以及拒绝将 Project UUID 目录选为 Projects root。最初 Seed 丢失的原因尚未确认。先前 mixed r6/r7 PASS 仅对原测试范围有效，状态仍为 **FIELD BLOCKED**。

## 剩余现场验证

1. 在两台 Windows PC 上全新解压**精确 r11**，验证 Firewall onboarding/UAC，以及限定为 Private + `LocalSubnet` 的窄 rule 与其 lifecycle。
2. 人为占用或禁用首选 Seed port，确认 fallback 后实际公布的 endpoint 可从另一台机器访问，并测试 Host Stop/Start 与 Fresh Guest transfer。
3. 在 Project identity 创建/更新期间模拟异常 process loss，确认可以安全恢复，同时模糊/冲突 identity 继续 fail closed。
4. 执行 Fresh Host → Fresh Guest → Unity realtime smoke；同时确认另一 Peer 持有 lock 时提示清晰，并在 release/takeover 后正确消失。
5. #182 保留为间歇 CI 监视，不用 retry/skip 掩盖复发；#79 继续跟踪 transient SceneView edit 的 UX。

## 信息来源

功能、blocker 与证据详情见 [English STATUS](STATUS.md)；精确版本/Runtime/Protocol 见 [`release-contract.json`](../release-contract.json)；发布 byte identity 见 [`builds/README.md`](../builds/README.md) 与 GitHub Release SHA-256。
