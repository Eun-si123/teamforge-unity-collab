# TeamForge 当前状态

[English](STATUS.md) · [工作原理](HOW_IT_WORKS.zh-Hans.md)

_这是与 2026-10-04 版英文权威文档 `STATUS.md` 对照后的预览翻译。涉及详细证据、Issue 和最新判断时，以英文版为准。_

> **早期公开预览：不要把 TeamForge 当作重要 Unity Project 的唯一副本或唯一恢复手段。** 请保留备份，并优先使用可丢弃的测试 Project。

## 当前概览

- 产品线：`0.5.1`
- Source lineage：`0.5.1-wp5.1-path-resilience`
- 最新已发布候选：`v0.5.1-prealpha-wp5.1-r7`
- r7 Source commit：`d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- Windows ZIP：`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256：`a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- 目标：Windows x64
- 发布准备状态：**FIELD BLOCKED**
- Unity 系列：`6000.3`（已记录测试 Editor：`6000.3.21f1`）
- Realtime / Project Transfer / Project Manifest：**v1**

## r7 的证据边界

r7 于 2026-10-03 从上述 commit 发布，并在发布后通过 Windows **Exact Release Validation**。自动流程重新下载 Release ZIP，验证 SHA-256 和 release manifest 中每个文件的 hash，在包含韩文字符与空格的新路径中从不同工作目录解压，并验证打包 Runtime/Node、Launcher fail-closed 行为、Windows path resilience 与真实 junction 检查。

这些属于 **精确包的自动化证据**，并不等于两台真实 Windows PC 上的 Firewall/UAC、真实 LAN 可达性、异常 process loss 后 Project identity 恢复，或完整 Host → Guest → realtime 流程。因此状态仍是 FIELD BLOCKED。

2026-08-31 使用精确 r5 在两台 Windows 电脑上获得的 reconnect、late join、receive/resume、long-path、lock contention，以及 Seed `5091`/传输结果仍是有效历史物理证据。发布 r7 不会改写 r5 的 bytes 或既有结果。

## 当前功能范围

Presence、Selection、Transform 同步、基础 lock/ownership、受支持的 Same-Scene Hierarchy 操作、直接 P2P Project transfer、诊断/恢复 UX、Windows path resilience 已实现或处于稳定化阶段。r7 还包含 post-r5 Windows firewall onboarding、不可用/冲突 Seed port fallback、Windows Project identity crash recovery、额外 diagnostics，以及 `TeamForge · Locked by <owner>` SceneView 提示。

通用 Component/Inspector 同步、Prefab/通用 Asset collaboration、持久化 server/session restart recovery、自动 Internet NAT traversal/relay 目前仍不受支持。

## 剩余现场验证

1. 在两台 Windows PC 上全新解压**精确 r7**，验证 Firewall onboarding/UAC，以及限定为 Private + `LocalSubnet` 的窄 rule 与其 lifecycle。
2. 人为占用或禁用首选 Seed port，确认 fallback 后实际公布的 endpoint 可从另一台机器访问，并测试 Host Stop/Start 与 Fresh Guest transfer。
3. 在 Project identity 创建/更新期间模拟异常 process loss，确认可以安全恢复，同时模糊/冲突 identity 继续 fail closed。
4. 执行 Fresh Host → Fresh Guest → Unity realtime smoke；同时确认另一 Peer 持有 lock 时提示清晰，并在 release/takeover 后正确消失。
5. #182 保留为间歇 CI 监视，不用 retry/skip 掩盖复发；#79 继续跟踪 transient SceneView edit 的 UX。

## 信息来源

功能、blocker 与证据详情见 [English STATUS](STATUS.md)；精确版本/Runtime/Protocol 见 [`release-contract.json`](../release-contract.json)；发布 byte identity 见 [`builds/README.md`](../builds/README.md) 与 GitHub Release SHA-256。
