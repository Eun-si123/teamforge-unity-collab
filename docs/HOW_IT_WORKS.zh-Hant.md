# TeamForge 如何運作

本頁解釋**使用者主持、加入、傳輸專案、編輯 Scene、斷線或從失敗復原時，TeamForge 內部會發生什麼事**。這是引導式說明，不是完整協定規格或原始碼地圖。

能力／阻礙見[狀態](STATUS.zh-Hant.md)；拓撲與信任界線見 [architecture](architecture.md)；檔案導覽見 [CODEMAP](../CODEMAP.md)；設計理由見 [architecture-decisions](architecture-decisions.md)。未翻譯的深入文件仍為英文；[English](HOW_IT_WORKS.md) 是語意依據。

## 60 秒模型

兩條刻意分開的資料路徑：

- Host／Guest Unity Editor 透過 WebSocket 將即時操作送至 Server 的 Session Authority。
- Host Unity 使用 Host Project Peer／Seed，Guest Launcher 使用 Guest Project Peer。Peer 間以直接 HTTP 傳送專案內容，Guest Peer 再將已驗證 Active 專案交給 Guest Unity。
- Server 與兩者協調簽章中繼資料，但不成為專案檔案 relay。
- Guest 必須通過信任、完整性、啟用及 Unity 交接檢查，才會開啟接收內容。

大型傳輸因而與延遲敏感的協作流量分離，並保留一個清楚的即時權威。

## 主要程序

### Unity Editor 套件

提供 Host 流程、連線生命週期、Presence、支援的 Transform/Lock 與同一 Scene Hierarchy 協作、診斷／復原呈現，以及將核准遠端狀態套用至本機 Scene。用戶端**觀察權威**；本機值不會只因存在於某個 Editor 就變成權威值。

### TeamForge Server

**Session Authority** 負責成員、共用修訂／順序、lock/lease、保留的受支援 Scene 狀態、replay／冪等保護與即時效果。**Project Coordinator** 負責簽章 Project／Publisher／baseline／Peer 協調中繼資料。Server 不儲存或轉送一般 Manifest/File/Chunk 內容。

### Project Peer

負責簽章邀請驗證、確定性 manifest／hash、直接 HTTP、驗證式續傳、staging、不可變 Active 修訂、檔案系統／路徑安全與 Project／Publisher 信任。下載成功不足以啟用專案；完整驗證與信任流程仍必須通過。

### Windows Guest Launcher

全新 Guest 從 Unity 外部開始，因為可能尚無專案可開。Launcher 驗證內附 Runtime、邀請及信任，透過 Peer 接收專案，驗證最終 Active 與所需 Unity 版本後才交接。一般套件 Guest 不需安裝或手動操作系統 Node.js/npm。

目前 Launcher 原始碼也可建立**手動本機支援封存檔**：範圍有限且已遮蔽敏感資料的觀察用 ZIP。不自動上傳、不授予權威，也不繞過邀請、信任、啟用、Runtime、路徑或 Unity 交接驗證。套件是否含此動作取決於確切成品；[狀態](STATUS.zh-Hant.md)與 [builds](../builds/README.md) 區分原始碼及發布套件。

## Host 開始協作

1. 選擇 **Publish & Start**。
2. Unity 檢查本機專案與已儲存 Scene 前提。
3. Peer 準備確定性 baseline，檔案／chunk 取得完整性識別。
4. Host Peer 啟動直接傳輸 Seed。
5. 與 Server 協調 Project／Publisher／baseline／Peer 中繼資料。
6. 建立簽章 Collaboration Invite，Host 準備接受 Guest。

實作另有 fail-closed 檢查。**Host Ready 不只是開了一個連接埠**：Guest 所需的傳輸與即時工作階段契約已建立。邀請不應攜帶存取碼、私人簽章金鑰或任意本機專案路徑；使用存取碼時須另外分享。

## 全新 Guest 加入

1. 開啟 Windows Guest Launcher，驗證內附 Runtime。
2. 載入／貼上邀請，驗證結構與簽章。
3. 檢查 Project／Owner／Publisher 身分與信任。
4. 連絡協調後的 Host／Seed，接收 descriptor／manifest／inventory。
5. 只下載所需 chunk，驗證 chunk、檔案、manifest 與專案完整性。
6. 在 staging 建構並驗證完整候選專案。
7. 建立不可變 Active 修訂，移動小型目前專案指標。
8. 驗證所需 Unity 執行檔與最終交接，開啟已驗證專案。

任意部分下載目錄不會被當作目前專案。接收新版或啟用失敗時，先前已驗證 Active 修訂可繼續保留。

### 續傳仍須驗證

傳輸契約允許時可重用已驗證內容，不是信任磁碟上碰巧存在的任何檔案；hash 與啟用契約仍具決定性。

## 編輯支援的 Scene 物件

1. 使用者移動 GameObject，Unity Transform 服務觀察變更。
2. 解析權威認定的標準物件身分。
3. 檢查 lock/lease 與目前連線權威，透過 WebSocket 送出 Transform 操作。
4. Server 驗證並套用順序／修訂／冪等規則。
5. 廣播核准效果至其他用戶端。
6. 接收方更新 Authority View，Unity 安全套用核准的遠端 Transform。

**身分：**兩個 Editor 必須指向同一邏輯物件，而非僅同名或同 Hierarchy 路徑。已儲存 Scene 物件以穩定 Unity 身分為基線；支援的工作階段新建物件可在權威綁定後取得 TeamForge 邏輯身分。模糊身分採 fail-closed，不以名稱、同層索引或路徑猜測。

**權威：**Server 決定可接受的共用即時狀態；用戶端回報意圖並套用核准結果，不各自維護競爭版本的真相。

**修訂／順序：**接受操作會推進共用權威順序。修訂資訊用於判斷過時狀態、晚加入、replay，以及操作是否依預期共用狀態評估。

**Lock／lease：**由權威控制，防止兩人同時默默覆寫物件。用戶端消失時 lease 會到期，不變成永久鎖。

**Replay／冪等：**同一操作的合法重試不同於另一操作重用識別。訊息重送不能造成共用狀態重複變更。

## Hierarchy 變更

同一 Scene 內的建立／刪除／重新命名／換父物件／同層排序走獨立權威路徑，不假裝成一般 Transform。Transform 相對於物件結構；父物件或身分不同，即使本機數字相同也可能產生不同 Scene。不能據此推論一般 Component/Inspector/Prefab/Asset 同步或任意跨 Scene 結構受支援；請見[狀態](STATUS.zh-Hant.md)。

## 重連與連線世代

重連不是舊權威仍有效的證明：失去連線 → 停止信任該連線範圍權威 → 重連／握手 → 收到目前協商能力及權威狀態 → 在新連線世代重新綁定支援物件 → 必要狀態就緒後才恢復協作。持久別名或本機身分快取可協助解析，但本身不授予重連後權威。

## 失敗與復原

保留已驗證狀態，不強行通過未知狀態：

- Runtime 損毀：執行未驗證套件程式碼前停止；
- 邀請無效／衝突：不改動既有 Project 綁定；
- 傳輸失敗：保留允許重用的已驗證進度；
- 啟用失敗：不取代先前已驗證 Active；
- Unity 路徑問題：僅使用另行驗證的 TeamForge 自有路徑韌性策略；
- baseline／身分不符：要求協調／更新，不猜測；
- 所需連接埠有未知程序：不能只因 TeamForge 想用就終止它。

復原**由狀態決定**。Retry、Paste New Invite、Use Latest Project、Open Existing Verified Project、Choose Unity 只在具有明確安全意義的狀態提供。

**診斷是觀察，不是復原權威。** 複製診斷與手動 ZIP 用於描述本次執行。儲存封存檔不會改選 Project、重試、信任 Publisher、啟用內容或放寬檢查。只收集範圍有限的安全狀態視圖，而非廣泛專案／機器資料；公開分享前仍應檢查。

## 為何分開傳輸與即時協作

即時協作需要小型有序權威訊息；專案 bootstrap 涉及大量檔案、位元組串流、重試、續傳、hash、staging 與磁碟作業。分離避免專案位元組變成隱藏的伺服器瓶頸，也使安全／失敗界線清楚。

代價是 Guest 必須真正連得到 Host Peer。目前直接傳輸適合相同 PC、可達 LAN 或受管理 VPN。自動網際網路探索／NAT 穿透／relay 是獨立的未來傳輸問題，不是 P2P 一詞暗示的承諾。

## 狀態存放位置與壽命

| 狀態 | 位置／壽命 |
| --- | --- |
| 即時 Session Authority | 存活工作階段的 Server 記憶體 |
| Project 協調登錄 | Server 記憶體 |
| 用戶端 Authority View | 目前 Unity 連線 |
| 傳輸內容／staging | Project Peer 受管理儲存 |
| 已驗證 Active 修訂 | 持久的受管理 Project 儲存 |
| 目前 Active 指標 | 小型持久中繼資料 |
| Launcher 診斷歷程 | 有限的本次執行歷程 |
| 手動支援封存檔 | 使用者建立的本機有限／遮蔽 ZIP；不自動上傳 |

已下載專案可持久保存，不代表即時權威歷程持久保存；診斷成品也不成為協作權威。重啟、重連、續傳、復原時必須區分。

## 沿行為追查原始碼

確切檔名／測試由 [CODEMAP](../CODEMAP.md) 維護。典型路徑：連線 → Unity `TeamForgeConnectionService` + Server WebSocket host；Transform/Lock → Transform 服務 + Authority View + Session Authority；Hierarchy → Unity 服務 + Server Hierarchy 模型／Session Authority；bootstrap／傳輸 → Peer Host/Guest 協調器 + 直接來源 + content store；Guest 啟動／復原 → Windows Launcher + Launcher Core + Guest 協調器；支援診斷 → 診斷 UI + Core 封存／遮蔽；路徑韌性 → Launcher Core + 共用 Project Peer 契約。使用程式碼地圖而非在此複製檔名，讓概念說明在重構後仍有用。
