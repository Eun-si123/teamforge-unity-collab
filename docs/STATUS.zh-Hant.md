# TeamForge 目前狀態

[English](STATUS.md) · [運作方式](HOW_IT_WORKS.zh-Hant.md)

_英文原文文件審閱日期：2026-09-10 UTC。已對照 `main` 上 r5 之後的 Windows 網路、診斷及 Project 身分強化、已發布的 r5 成品，以及 2026-08-31 記錄的確切 r5 實機結果。套件證據與較新原始碼的證據仍分開看待。_

> **早期公開預覽 — 請勿將 TeamForge 當作重要 Unity 專案的唯一副本或唯一復原機制。** 原始 WP5.1 Windows 阻礙項目已在確切的 r5 上完成大量實機驗證，但目前 `main` 較新，新增的網路／身分行為尚未作為同一個確切替代套件在實體電腦上驗證。請保留備份，並優先使用可捨棄的測試專案。

[English](STATUS.md) 是目前能力與發布就緒聲明的權威人類可讀來源。其他文件應連結至此，而非各自維護互相競爭的阻礙清單。確切產品／執行環境／協定選項見 [release-contract.json](../release-contract.json)；套件位元組身分及已取代版本規則見 [builds/README.md](../builds/README.md)；錯誤討論與歷史重現見 GitHub Issues。未翻譯的深入文件仍為英文。

## 現況摘要

- 產品系列：`0.5.1`；原始碼分支沿革：`0.5.1-wp5.1-path-resilience`。
- 最新已發布套件候選版：`v0.5.1-prealpha-wp5.1-r5`。
- r5 原始碼／標籤提交：`a97b6ba5649e2888b909bf3c99c64acfd7042ba6`。
- r5 Windows ZIP：`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`。
- SHA-256：`5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`。
- 套件目標：Windows x64；發布就緒狀態：**FIELD BLOCKED**（仍有實地驗證門檻）。
- Unity 系列：`6000.3`；已記錄的候選版測試 Editor：`6000.3.21f1`。
- Realtime Protocol、Project Transfer Protocol、Project Manifest Schema：各為 **v1**。

## 原始碼與已發布套件

原始 WP5.1 修正 #67、#68/#74、#69、#70、#71 已透過 PR #81 合併。r5 來自上述提交，包含這些修正與 r4 之後加入的 Launcher **Save support bundle** 整合。

2026-08-31 在兩台實體 Windows 電腦上測試了確切 r5，完成已儲存 Guest 重連、全新 Guest 晚加入 Transform 快照、反覆中斷接收／續傳、長／深路徑 execution alias 交接，以及過時鎖定競爭所造成的受保護衝突復原。在具備必要防火牆權限後，也實機驗證了 Host Stop/Start 重新綁定 Seed TCP `5091` 與真正的 Guest Project 傳輸。

這些情境不再等待第一次 r5 實機重跑。這不會讓後續原始碼變更成為 r5 的一部分，也不代表產品已是可普遍安裝的 alpha。套件聲明應使用 r5 及其 2026-08-31 證據；不能稱 r5 與 `main` 位元組或行為等同。不要只因舊文件仍寫待辦而重新列出已完成的 r5 阻礙。若要將 `main` 作為替代候選版，必須發布新的不可變成品，並在該確切成品上驗證 r5 之後新增的行為。

## r5 不含的後續強化

- Windows LAN 防火牆引導可在使用者明確同意與 UAC 核准後，建立範圍狹窄的 Coordinator／Seed 輸入規則，限於 Private 設定檔與 LocalSubnet，並協調／清理 TeamForge 自有規則。r5 實機 LAN 測試仍需手動允許；新流程需要確切套件的實機證據。
- 偏好／預設 Seed 連接埠被占用或無法使用，包括 Windows 綁定情境的 `EACCES`：Host 協調流程改用作業系統分配的連接埠重試一次，並公告選定端點。已有 Windows Project Peer 自動測試，但此行為晚於 r5。
- Project 身分建立序列化與 Windows 當機復原：使用作業系統擁有的 named-pipe 存活鎖，以及防止舊寫入程式越界的永久相容性屏障。Windows Node 22/24 當機／並行測試已通過；尚無包含此變更的已發布套件取得確切實機證據。
- Coordinator 拒絕後清理、HTTP 取消／期限強化、Host 診斷脈絡改善、WebSocket 用戶端角色日誌，以及 Launcher 邀請與 `TF1` 連線碼的更清楚區別。

這些屬於原始碼／自動化事實，不是 r5 套件行為。Linux/macOS Project 身分過時鎖復原也不在這次 Windows 專用變更範圍內。

## 能力狀態

| 項目 | 目前原始碼狀態 | 證據界線 |
| --- | --- | --- |
| 連線使用者 Presence | 已實作／測試 | 雙實機基線可運作；仍值得擴大外部測試 |
| 選取／Editor 感知 | 已實作／測試 | 仍值得擴大外部測試 |
| Transform 同步 | 已實作／穩定化中 | 確切 r5 晚加入及競爭復原 PASS；仍需更多實地覆蓋與 UX 改進 |
| 基本鎖定／ownership | 已實作／穩定化中 | r5 競爭／復原 PASS；他人持鎖時編輯 UX 待改善（#79） |
| 同一 Scene 的 Hierarchy 建立／刪除／重新命名／換父物件／排序 | 已實作／穩定化中 | 支援子集已實機測試；仍值得擴大覆蓋 |
| Project bootstrap／Collaboration Invite | 已實作／穩定化中 | r5 已儲存 Guest 重連 PASS；新身分當機復原缺套件／實地證據 |
| 直接 P2P Project 傳輸 | 已實作／穩定化中 | r5 `5091` Stop/Start 與傳輸 PASS；新防火牆／連接埠備援缺替代套件證據 |
| 診斷／復原 UX | 已實作／穩定化中 | r5 含保護隱私的支援封存檔；後續改善相對於 r5 僅存在於原始碼 |
| Windows 路徑韌性／execution alias | 已實作／穩定化中 | r5 真實長／深路徑交接 PASS；惡意／無關別名拒絕仍為自動化 fail-closed 覆蓋 |
| Component／Inspector 同步 | 規劃中 | 不支援一般 Component 新增／移除與 `SerializedProperty` 同步 |
| Prefab／一般 Asset 協作 | 規劃中 | 非目前支援流程 |
| 持久化伺服器／工作階段重啟復原 | 規劃中 | authority／工作階段狀態仍在記憶體 |
| 自動網際網路 NAT 穿透／relay | 研究／未來 | 無 WebRTC、ICE、STUN、TURN、relay、discovery 或自動 NAT 穿透 |

## 確切 r5 實機結案紀錄

此表取代把原始阻礙誤列為尚待實機驗證的舊說法。

| Issue | 結果與目前界線 |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS**：合法協作編輯／儲存 → 關閉 Guest Unity → 重開同一已驗證 Active Project → 無 `guest_handoff_mismatch` 地重返即時工作階段。新／未驗證身分拒絕仍由嚴格實作與自動回歸保護 |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS**：全新 Guest 收到權威 Hierarchy/Transform/Lock 與後續即時 Transform，沒有錯誤的受保護衝突。更多情境仍有價值；原始阻礙已結案 |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS**：競爭失敗方回復權威狀態，協作仍可用。他人持鎖時的 UX 清晰度另由 #79 追蹤 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS**：接收時多次強制終止 Launcher，重用已驗證部分資料並完成續傳，未重現原始 CLR／應用程式錯誤。未來 Runtime 變更仍應保留回歸測試 |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **r5 產品目標部分完成／穩定 Seed 路徑 PASS**：Host Stop/Start 重綁 TCP `5091`，防火牆允許後真實傳輸成功。新自動防火牆引導及連接埠備援仍需確切替代套件實機證據 |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS**：長／深目的地觸發路徑最佳化，Unity 開啟並可協作。惡意／無關／重新指向別名的拒絕仍屬自動化 fail-closed 證據 |

詳細時間線歸 Issues；目前發布影響由 STATUS 管理。

## 自動化與本機證據

PR #81 合併前，其最終整合 head 通過 `docs/MAIN_PATCH_STATUS_2026-08-27.md` 所記錄的保護檢查：

- CI #216：Server、Project Peer、Launcher Runtime loader、Windows Launcher、公開原始碼契約 **PASS**。
- Dependency Review #140 **PASS**。
- Unity Tests #73：Unity Lock Contention E2E、Unity Realtime Authority E2E、Realtime Authority Chaos E2E、Project Transfer Resume E2E **PASS**。
- 先前本機 Unity Test Runner：**143/143 可本機執行測試 PASS**；兩項僅供 CI 的真實伺服器測試刻意在本機略過。
- 同機 A/B 競爭復原 **PASS**；A/B/C 晚加入 Hierarchy/Transform 收斂 **PASS**，該次紀錄中受保護衝突為零。

後續強化也經過針對性的 Project Peer／Launcher／Unity 測試及一般品質檢查。Windows 身分當機／並行套件在支援的 Node 22、24 系列通過；不可用 Seed 連接埠回歸在重現的 Windows 環境通過完整 Project Peer 套件。這增加對目前原始碼的信心，不會為修正之前發布的位元組創造套件證據。

## 雙實機證據

2026-08-22 基線：Host → 簽章邀請 → 全新 Guest → 驗證身分 → 直接傳輸 → Publisher 信任 → 已驗證 Active → Unity 即時連線；Presence 與雙向 Transform；正常鎖定競爭；同一 Scene 支援的建立／重新命名／換父物件／同層排序／刪除。Guest 未儲存即退出再開啟，可從仍在執行的工作階段復原權威 Hierarchy/Transform/Lock。Coordinator TCP 中斷後重試並自動重連，不需重啟 Unity。

2026-08-31 以確切 r5 ZIP/SHA 配對在兩台實體 Windows 電腦完成上述目標情境。同時通過 Seed `5091` Stop/Start 與真實 LAN 傳輸；當時首次防火牆允許仍需手動設定。

## 證據界線

結果只證明實際測過的內容。原始碼 CI 不證明 ZIP 正確；Unity 自動化不涵蓋所有 SceneView 輸入順序、Windows 程序條件、LAN／防火牆狀態或第二台電腦時序。同機測試共用 OS、網路堆疊、時間環境與硬體。r5 實機證據不證明後續 `main`。產品版本不等於位元組身分：確切證據需要成品檔名與 SHA-256。錯誤結案不自動驗證之後同子系統的變更。歷史紀錄對其快照有效，但不取代目前 STATUS 的就緒判定。

## 剩餘發布門檻

在宣稱可普遍安裝的 alpha 前：

1. 保留 r5 #67/#68/#69/#71/#74 已完成的實機結果。
2. 若分發 `main`，發布新的不可變候選版。
3. 在確切替代成品上驗證新防火牆引導、狹窄規則範圍／生命週期、偏好連接埠不可用／衝突備援、公告 Seed 實際可達性、Host Stop/Start 及全新 Guest 傳輸。
4. 同一成品上驗證 Windows Project 身分程序遺失後的安全重啟與復原，並維持模糊／衝突身分的 fail-closed 處理。
5. 以新解壓縮 Host → 全新 Guest → 即時協作做替代套件 smoke test，不能假定承襲 r5 證據。
6. 記錄確切檔名／SHA／原始碼身分，只記載實際執行情境。
7. 持續完善安裝／更新／解除安裝指引，並在廣泛可靠性聲明前取得創作者以外人士的測試／審閱。

伺服器程序重啟目前是**斷線／fail-closed／新工作階段復原**情境，不是持久性測試：尚未實作持久化 authority／工作階段重啟復原。

## 資訊歸屬

能力／阻礙：[English](STATUS.md)；版本：[契約](../release-contract.json)；目前／被取代成品：[builds](../builds/README.md) 加 Release SHA；流程：[運作方式](HOW_IT_WORKS.zh-Hant.md)；規劃：[ROADMAP](ROADMAP.md)；結構：[architecture](architecture.md)；理由：[architecture-decisions](architecture-decisions.md)；測試情境：[TEST_LAB](TEST_LAB.md)；錯誤：Issues；舊測試：具日期證據。未翻譯的深入文件保留英文。
