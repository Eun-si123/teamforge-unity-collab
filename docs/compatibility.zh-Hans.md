# TeamForge 兼容性

本页说明**兼容性与网络拓扑的边界**。

- 当前产品、运行时和协议的准确选定值 → [`../release-contract.json`](../release-contract.json)
- 当前验证与就绪状态 → [STATUS.md](STATUS.md)
- 打包产物的身份 → [`../builds/README.md`](../builds/README.md) + 对应 Release 的准确 SHA-256

不要在多份文档中复制频繁变化的工具或运行时补丁版本号。准确选定值由发布契约维护。

## 测试之前

使用可丢弃的测试项目并保留备份：TeamForge 仍是早期公开预览，当前实机验证边界由 [STATUS.md](STATUS.md) 维护。下方平台表区分打包目标与源码、构建要求。

最低 CPU、RAM、GPU、磁盘、带宽和延迟要求尚未通过受控测试确定。原型成功运行并不构成最低硬件配置建议。

Guest 必须能够访问配置的 Server 和 Host 公布的 Project Peer 端点。签名邀请不会自动打通网络。请使用同一台计算机、可互通的 LAN 或受管理的 VPN；目前不提供自动互联网穿透或中继。

## 产品与协议兼容性

TeamForge 各组件应作为同一条兼容的产品线同步演进，而不是随意混用独立的 Server、Project Peer、Launcher 和包版本。

当前架构区分以下职责：

- 通过配置的 TeamForge Server WebSocket 管理实时协作权威；
- 项目初始准备与元数据协调；
- Project Peer 之间的直接有效载荷传输；
- 打包 Host/Guest Runtime 与 Launcher 的完整性。

只有在现有语义仍兼容时，协议或模式的版本兼容性才可作为增量扩展处理。准确选定的协议、模式版本号由 `release-contract.json` 维护。

不要仅因显示的产品版本相同，就混用不同打包候选版本生成的 Runtime/Launcher 清单或二进制文件。

## Unity 兼容性

当前支持的 Unity 产品线是 **Unity 6000.3**。

只有针对预期源码或候选版本留下测试证据，才能声称某个具体 Editor 补丁版本经过验证。不要把上游最新 Unity 补丁自动视为已测试或受支持。

测试记录中准确的 Editor 选定值保存在 `release-contract.json`，当前证据汇总在 [STATUS.md](STATUS.md)。

## 开发与运行时兼容性

源码开发者应使用 `release-contract.json` 和仓库锁定、构建配置指定的 Node/npm/.NET/工具版本范围。

这些是**源码与构建要求**，不是打包 Host/Guest 流程面向普通最终用户的安装要求；该流程按当前发布契约使用捆绑或自包含的运行时组件。

新的主要 Runtime 或工具链系列需要明确的兼容性决定与验证，不能仅从某台机器安装成功就推定兼容。

## 支持的拓扑

当前支持或预期的拓扑包括：

- 配置的 TeamForge Server WebSocket，负责实时权威；
- 同一 PC、可互通 LAN 或受管理 VPN 上的直接 Project Peer HTTP 传输；
- 明确的仅回环同机模式；
- 经过身份验证的非回环监听，并向 Guest 公布具体的主机地址；
- 使用已验证捆绑 Runtime 的打包 Windows Host/Guest 流程。

目前不作为受支持拓扑提供的功能：

- WebRTC / RTCDataChannel；
- ICE / STUN / TURN；
- 自动 NAT 穿透；
- 中继 / 自动传输回退；
- 自动发现对等节点；
- 无服务器或内嵌实时权威；
- 具备完整用户身份与授权系统的不可信公共互联网部署。

当前 TeamForge 文档中的 `P2P` 指**直接 Project Peer 有效载荷传输**，不是自动互联网 P2P 连接。

## 平台表

| 项目 | 兼容性状态 |
| --- | --- |
| Windows x64 捆绑 Runtime / Guest Launcher | 当前打包平台方向；具体候选版本仍须遵循 STATUS 实机验证门槛 |
| Unity 6000.3 | 当前 Unity 产品线 |
| 测试记录中的准确 Unity 补丁 | 参见 `release-contract.json` + STATUS 证据 |
| 其他 Unity 6000.3 补丁 | 声称已测试前需要单独重新建立基线并验证 |
| macOS/Linux 独立 Launcher | 尚未打包为同等的当前候选版本 |
| Docker/Compose | 源码或服务器选项，不是常规打包 Host 路径或当前发布门槛 |
| Authenticode | 分发与签名状态由 STATUS 和当前产物文档维护 |

## 当前源码的 Windows 托管存储

当前源码在 Windows 上执行项目身份锁定时，要求使用本地固定 NTFS/ReFS 托管根目录。网络根目录、不可用或未经确认的根目录会被拒绝。这是 TeamForge 托管存储的条件，不是通用 Unity 项目的新增要求。源码与公开候选版本的边界见 [STATUS.md](STATUS.md)，代码见[负责此行为的实现](../project-peer/src/project-identity-lock.mjs)。

## 兼容性声明与历史

历史阶段、工作记录和测试报告只适用于其记录的源码或产物。不能仅因显示的产品版本与当前产品线相似，就把它们当作当前兼容性证据。

需要精确识别字节时，请使用 Release 资源文件名 + SHA-256，而不是只看产品版本。
