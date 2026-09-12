# TeamForge 相容性

此頁提供**供人閱讀的相容性與網路拓撲範圍**。

- 目前產品、runtime、協定的精確選定版本 → [`../release-contract.json`](../release-contract.json)
- 目前驗證與就緒程度 → [STATUS.md (英文)](STATUS.md)
- 封裝成品身分 → [`../builds/README.md`](../builds/README.md) + Release 的精確 SHA-256

請勿在多份文件複製經常變動的工具/runtime 修補版本。發行契約負責這些精確選擇。

## 測試之前

請使用可捨棄的專案並保留備份。TeamForge 是早期公開預覽，[STATUS.md](STATUS.md) 定義目前實地驗證範圍。下表區分封裝目標與原始碼/建置需求。

尚未透過受控測試建立 CPU、RAM、GPU、磁碟、頻寬與延遲的最低需求。原型成功執行並不等於最低硬體建議。

Guest 必須能連至設定的 Server 及 Host 公告的 Project Peer 端點。簽署邀請不會建立網路可達性。請使用同一台電腦、可達的 LAN 或受管理 VPN；未提供自動網際網路穿透或 relay。

## 產品與協定相容性

TeamForge 元件應作為同一相容產品線一起前進，不應任意混用 Server/Project Peer/Launcher/套件版本。架構區分：

- 經由設定的 TeamForge Server WebSocket 管理即時協作權威；
- 專案初始傳輸與中繼資料協調；
- 直接 Project Peer 資料傳輸；
- 封裝 Host/Guest Runtime 與 Launcher 的完整性。

只有既有語意仍相容時，協定/schema 版本才能以新增方式相容演進。精確編號由 `release-contract.json` 管理。即使顯示的產品版本相同，也不要混用不同候選成品的 Runtime/Launcher manifest 或二進位檔。

## Unity 相容性

目前支援的產品線是 **Unity 6000.3**。特定 Editor 修補版本，必須對預定原始碼/候選成品有記錄證據，才能宣稱已驗證。最新 Unity 修補版不會自動變成已測試或支援。測試 Editor 的精確選擇在 `release-contract.json`，證據摘要在 [STATUS.md](STATUS.md)。

## 開發與 runtime 相容性

原始碼開發者應使用發行契約與儲存庫 lock/build 設定選定的 Node/npm/.NET/工具範圍。這些是**原始碼/建置需求**，不是一般封裝 Host/Guest 終端使用者的安裝需求；後者依目前契約使用隨附/自足 runtime。新的主要 runtime/工具鏈系列需要明確的相容性決策與驗證，不能僅憑一台電腦安裝成功推定。

## 支援的拓撲

- 設定的 TeamForge Server WebSocket 管理即時權威；
- 同一 PC、可達 LAN 或受管理 VPN 上的直接 Project Peer HTTP 傳輸；
- 明確選擇的同機、僅 loopback 模式；
- 經驗證身分的非 loopback 監聽，並向 Guest 公告具體主機位址；
- 使用經驗證隨附 Runtime 的封裝 Windows Host/Guest 流程。

目前未作為支援拓撲提供：WebRTC / RTCDataChannel、ICE / STUN / TURN、自動 NAT 穿透、relay/自動傳輸備援、自動探索 peer、無伺服器/內嵌即時權威，以及具備完整使用者身分/授權系統的不受信任公用網際網路部署。

目前 `P2P` 意指**直接 Project Peer 資料傳輸**，不是自動建立網際網路 P2P 連線。

## 平台矩陣

| 範圍 | 相容性狀態 |
| --- | --- |
| Windows x64 隨附 Runtime / Guest Launcher | 目前封裝平台方向；精確候選成品仍須符合 STATUS 實地門檻 |
| Unity 6000.3 | 目前 Unity 產品線 |
| 記錄的精確 Unity 修補版本 | 參閱 `release-contract.json` 與 STATUS 證據 |
| 其他 Unity 6000.3 修補版本 | 需個別重建基準/驗證，才能宣稱已測試 |
| macOS/Linux 獨立 Launcher | 尚未封裝為目前的等效候選成品 |
| Docker/Compose | 原始碼/伺服器選項，不是一般封裝 Host 路徑或目前發行門檻 |
| Authenticode | 發布/簽署狀態由 STATUS 與目前成品文件管理 |

## 目前原始碼的 Windows 管理儲存空間

目前原始碼要求 Windows 專案身分鎖使用本機固定 NTFS/ReFS 管理根目錄。網路、無法使用或未驗證的根目錄會依 fail-closed 原則拒絕。這是 TeamForge 管理儲存空間的條件，不是一般 Unity 專案的新需求。原始碼與已發布候選成品的區別見 [STATUS.md](STATUS.md)，另見[負責的實作](../project-peer/src/project-identity-lock.mjs)。

## 相容性宣稱與歷史

歷史階段、工作與測試報告只適用於記錄的原始碼/成品。不能因顯示版本相近就當成目前證據。需要精確位元組身分時，請使用 Release 資產檔名 + SHA-256，而非僅用產品版本。
