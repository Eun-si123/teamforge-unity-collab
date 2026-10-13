# TeamForge 当前状态

[English](STATUS.md) · [工作原理](HOW_IT_WORKS.zh-Hans.md)

_这是与 2026-10-10 版英文权威文档 `STATUS.md` 对照后的预览翻译。涉及详细证据、Issue 和最新判断时，以英文版为准。_

> **早期公开预览：不要把 TeamForge 当作重要 Unity Project 的唯一副本或唯一恢复手段。** 请保留备份，并优先使用可丢弃的测试 Project。

## 当前概览

- 产品线：`0.5.1`
- Source lineage：`0.5.1-wp5.1-path-resilience`
- 最新已发布候选：`v0.5.1-prealpha-wp5.1-r8`
- r8 Source commit：`4aff5756329c2fe013d78344859e0760c6a382ef`
- Windows ZIP：`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r8-win-x64.zip`
- SHA-256：`3a003791043c067009250bf59da4d916e75eb6dc1b1ed0e93d54984a2d23eb21`
- 目标：Windows x64
- 发布准备状态：**FIELD BLOCKED**
- Unity 系列：`6000.3`（已记录测试 Editor：`6000.3.21f1`）
- Realtime / Project Transfer / Project Manifest：**v1**

## r8 发布及验证范围

r8 于 2026-10-10 发布，包含 PR #209 的 Direct Seed 健康状态检查、已验证 Existing-Active 的安全重新打开，以及拒绝嵌套 Project 根目录等修复。已发布 ZIP 通过 Windows Exact Release Validation（运行 38019297086），但**尚未在两台真实 Windows 电脑上完成 r8 测试**；发布状态仍为 **FIELD BLOCKED**。下方 r7 测试结果仅是历史证据，不代表 r8 实机验证。之后合并的 PR #217 和 #219 不包含在 r8 ZIP 中。

## r7 的证据边界

r7 于 2026-10-03 从 commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a 发布，并在发布后通过 Windows **Exact Release Validation**。自动流程重新下载 Release ZIP，验证 SHA-256 和 release manifest 中每个文件的 hash，在包含韩文字符与空格的新路径中从不同工作目录解压，并验证打包 Runtime/Node、Launcher fail-closed 行为、Windows path resilience 与真实 junction 检查。

这些属于 **精确包的自动化证据**。随后一次使用 r6 Host 与精确 r7 Guest 的真实双机测试中，Guest 复用了已有 managed root，未再出现 `destination_contains_unmanaged_content`；将可信 Host LAN 的 Windows profile 从 Public 改为 Private 后，流程继续通过 Publisher trust、Project receive 与 Unity 启动，并由用户报告 TeamForge 已成功连接。不过，这仍未证明两台机器都使用 exact r7、全新非管理员 UAC onboarding、Seed port fallback，或异常 process loss 后的真实 Project identity recovery。因此状态仍是 FIELD BLOCKED。

2026-08-31 使用精确 r5 在两台 Windows 电脑上获得的 reconnect、late join、receive/resume、long-path、lock contention，以及 Seed `5091`/传输结果仍是有效历史物理证据。发布 r7 不会改写 r5 的 bytes 或既有结果。

## 当前功能范围

Presence、Selection、Transform 同步、基础 lock/ownership、受支持的 Same-Scene Hierarchy 操作、直接 P2P Project transfer、诊断/恢复 UX、Windows path resilience 已实现或处于稳定化阶段。r7 还包含 post-r5 Windows firewall onboarding、不可用/冲突 Seed port fallback、Windows Project identity crash recovery、额外 diagnostics，以及 `TeamForge · Locked by <owner>` SceneView 提示。

通用 Component/Inspector 同步、Prefab/通用 Asset collaboration、持久化 server/session restart recovery、自动 Internet NAT traversal/relay 目前仍不受支持。

## 后续 r7-on-Host 阻塞与 r8 重测

[同一现场会话的后续记录](PHYSICAL_FIELD_EVIDENCE_2026-10-04.md#later-r7-on-host-follow-up-new-blockers-exposed)还发现：Host 显示 Ready 时没有可发现的 Direct Project Peer（`baseline_unavailable`）；打开已有 verified Project 绕过短 execution alias，出现长路径 `DirectoryNotFoundException`；Source 审查还发现，选用单个 Project UUID 目录作为 Projects root 可能形成嵌套 UUID。

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) 已于 2026-10-08 合并到 `main`，修复**已包含在发布的 r8 ZIP 中**。r8 的 Windows Exact Release Validation（运行 38019297086）已通过，但仍需在两台真实 Windows PC 上重新测试：Direct Seed 丢失时撤销 Ready、通过短路径重新打开 Existing-Active，以及拒绝将 Project UUID 目录选为 Projects root。最初 Seed 丢失的原因尚未确认。先前 mixed r6/r7 PASS 仅对原测试范围有效，状态仍为 **FIELD BLOCKED**。

## 剩余现场验证

1. 在两台 Windows PC 上全新解压**精确 r8**，验证 Firewall onboarding/UAC，以及限定为 Private + `LocalSubnet` 的窄 rule 与其 lifecycle。
2. 人为占用或禁用首选 Seed port，确认 fallback 后实际公布的 endpoint 可从另一台机器访问，并测试 Host Stop/Start 与 Fresh Guest transfer。
3. 在 Project identity 创建/更新期间模拟异常 process loss，确认可以安全恢复，同时模糊/冲突 identity 继续 fail closed。
4. 执行 Fresh Host → Fresh Guest → Unity realtime smoke；同时确认另一 Peer 持有 lock 时提示清晰，并在 release/takeover 后正确消失。
5. #182 保留为间歇 CI 监视，不用 retry/skip 掩盖复发；#79 继续跟踪 transient SceneView edit 的 UX。

## 信息来源

功能、blocker 与证据详情见 [English STATUS](STATUS.md)；精确版本/Runtime/Protocol 见 [`release-contract.json`](../release-contract.json)；发布 byte identity 见 [`builds/README.md`](../builds/README.md) 与 GitHub Release SHA-256。
