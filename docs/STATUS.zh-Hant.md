# TeamForge 目前狀態

> **2026-11-22 原始碼進度（並非新版發行）：** #578、#611、#610、#613 與 #608 已合併至 main；#612 亦已合併，Unity 原生編輯 #607 仍為草稿。外部 Prefab 的即時同步及兩台實體 Windows Editor 的驗證尚未完成。已發布的 r11 ZIP 沒有變更，準備狀態仍為 **FIELD BLOCKED**。詳情請參閱[最新英文狀態](STATUS.md)。

> **r11 release update (2026-11-21):** [r11 Windows test ZIP](https://github.com/Eun-si123/teamforge-unity-collab/releases/tag/v0.5.1-prealpha-wp5.1-r11) passed exact ZIP validation, but new M1–M4 functions have NOT passed two-physical-PC Windows tests; **FIELD BLOCKED** remains. The text below is a dated translation snapshot; refer to the [current English STATUS](STATUS.md) for up-to-date claims.

[English](STATUS.md) · [運作方式](HOW_IT_WORKS.zh-Hant.md)

_這份預覽翻譯已與 2026-11-20 版英文權威文件 `STATUS.md` 對照。詳細證據、Issues 與最新判斷仍以英文版為準。_

**2026-11-20 原始碼狀態更新：** M4（#572）的選擇式 SQLite Session 持久復原已合併至 main。r9/r10 使用兩台實體 Windows PC 進行的基本協作、重新連線測試早已執行，並由測試者回報 PASS；這些結果未涵蓋新 M4。已發布 r10 ZIP 不變，發布準備度仍為 **FIELD BLOCKED**。


> **早期公開預覽：不要把 TeamForge 當成重要 Unity Project 的唯一副本或唯一復原方式。** 請保留備份，並優先使用可丟棄的測試 Project。

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## 目前摘要

- 產品線：`0.5.1`
- Source lineage：`0.5.1-wp5.1-path-resilience`
- 最新已發布候選：`v0.5.1-prealpha-wp5.1-r11`
- r11 Source commit：`5868efe02975aa94b2acd79f5dec39a7b830aa26`
- Windows ZIP：`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r11-win-x64.zip`
- SHA-256：`28774bccb9fb20da0d72fce38d9bab7645dac1b876de182fbd33ee421170a989`
- 目標：Windows x64
- 發布準備狀態：**FIELD BLOCKED**
- Unity 系列：`6000.3`（已記錄測試 Editor：`6000.3.21f1`）
- Realtime / Project Transfer / Project Manifest：**v1**

## M1 原始碼整合：Collider 共同編輯

M1 需要明確啟用原始碼選項，不包含在已發布的 r10 ZIP。它將已儲存、非 Prefab Scene 中 BoxCollider/SphereCollider 的 trigger、center、size/radius 接上實際的簽章 Scene/meta 資料驗證 → Server Authority → WebSocket → Unity Editor 路徑。首次驗證後，未儲存的 Scene 可透過伺服器 runtime ledger、共同 revision/history 和 GameObject lock 連續編輯。Collider Collaboration 視窗提供只針對自己變更的條件式 Undo/Redo，以及供使用者檢視未確認本機值並明確重新提交的復原收件匣。伺服器提交、Editor 套用回報與磁碟儲存分別顯示。

證據分成四個階段。**實作**：M1 已透過 [PR #533](https://github.com/Eun-si123/teamforge-unity-collab/pull/533) 合併至 main。**自動驗證**：實際 Node WebSocket 測試通過。**Unity 整合**：[準確原始碼的 CI](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/43329700733) 在三個 Unity 版本上通過一個真實 Editor＋Node peer 的 Collider 編輯、條件式 Undo 與重新連線；本地 Linux 上的 Unity 執行仍是 NOT RUN。**封裝及 Windows 實機**：兩台實體 Editor 和新封裝驗證仍是 **NOT RUN**。已發布的 r10 ZIP 未變，狀態仍是 **FIELD BLOCKED**。M2 元件新增/移除 [#559](https://github.com/Eun-si123/teamforge-unity-collab/pull/559) 與晚加入修正 [#565](https://github.com/Eun-si123/teamforge-unity-collab/pull/565) 已於 2026-11-18 合併至 main，屬於預設關閉的原始碼功能。三個 Unity 版本中一個真實 Editor＋Node peer 的 CI 通過，但兩台實體 Editor 與新封裝驗證仍是 **NOT RUN**，已發布的 r10 不包含 M1/M2。 2026-11-19，M3 內建 Cube/Sphere 共同建立與刪除已透過 PR #569 合併至 main，屬於須明確啟用的原始碼功能。三個 Unity 版本中真實 Editor 1 個與 Node peer 的 CI 通過（40 項 PR 檢查）。兩台實體 Editor 與新封裝仍是 NOT RUN；已發布 r10 不含 M3，狀態仍為 FIELD BLOCKED。

目前限制為每個 Session 一個 Scene、最多保留 128 個記憶體 Session、512 個 Collider／1536 個屬性，數值須有限且位於 ±100／0–100。未支援欄位僅在本機生效；Component 新增刪除、Prefab、已加入 Collider 的所屬物件或祖先刪除需要 M2，活動 M1 路徑會拒絕這些操作。編輯者必須協商並加入相容能力。所有 peer 離線後 ledger 仍留在記憶體，但**未啟用 M4 時，伺服器重新啟動仍會遺失記憶體狀態**。現已合併的選擇式 M4 會將確認後的 Session 狀態保存至 SQLite。本機復原箱不代表伺服器持久化。兩個 Unity Editor、三人 late join、儲存重開、8 Editor 一小時 soak 與確切 Windows 套件驗證仍是獨立待驗項目。M2/M3/M4 已合併至原始碼；新功能的實體雙機驗證仍須另行進行。詳見[最新英文 STATUS](STATUS.md)及[執行設定](../server/README.md)。

## r8 發布及驗證範圍

r8 於 2026-10-10 發布，包含 PR #209 的 Direct Seed 健康狀態檢查、已驗證 Existing-Active 的安全重新開啟，以及拒絕巢狀 Project 根目錄等修正。已發布 ZIP 通過 Windows Exact Release Validation（執行 38019297086），但**尚未在兩台實際 Windows 電腦上完成 r8 測試**；發布狀態仍為 **FIELD BLOCKED**。下方 r7 測試結果僅為歷史證據，不能當作 r8 實機驗證。之後合併的 PR #217 與 #219 不包含在 r8 ZIP 中。

## r7 的證據邊界

r7 於 2026-10-03 從 commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a 發布，之後通過 Windows **Exact Release Validation**。自動流程重新下載 Release ZIP，驗證 SHA-256 與 release manifest 中每個檔案的 hash，從不同 working directory 解壓到含韓文字元與空格的新路徑，並驗證封裝 Runtime/Node、Launcher fail-closed 行為、Windows path resilience 與真實 junction 測試。

這是**針對確切發布套件的自動化證據**。後續一次使用 r6 Host 與確切 r7 Guest 的實體雙機測試中，Guest 重用了既有 managed root，未再出現 `destination_contains_unmanaged_content`；將可信任 Host LAN 的 Windows profile 從 Public 改為 Private 後，流程繼續通過 Publisher trust、Project receive 與 Unity 啟動，並由使用者回報 TeamForge 已成功連線。不過，這仍未證明兩台機器都使用 exact r7、全新非管理員 UAC onboarding、Seed port fallback，或異常 process loss 後的實體 Project identity recovery。因此狀態仍為 FIELD BLOCKED。

2026-08-31 使用確切 r5 在兩台 Windows 電腦取得的實體證據，對當時實際執行的 reconnect、late join、receive/resume、long path、lock contention 與 Seed `5091`/transfer 情境仍然有效。發布 r7 不會改寫 r5 的 bytes 或既有結果。

## 後續 r7-on-Host 阻礙與 r8 重測

後續實體測試發現 Host 顯示 Ready 時缺少可探索的 Direct Project Peer（`baseline_unavailable`）；開啟既有已驗證 Project 時出現長路徑 `DirectoryNotFoundException`。Source 檢查也發現，將個別 Project UUID 目錄選為 Projects root 可能產生巢狀 UUID。

PR #209 已於 2026-10-08 合併至 `main`，修正**已包含在發布的 r8 ZIP 中**。r8 的 Windows Exact Release Validation（執行 38019297086）已通過，但仍需在兩台 Windows 實機重新測試：Direct Seed 消失時撤回 Ready、透過短路徑重新開啟 Existing-Active，以及拒絕將 Project UUID 目錄選為 Projects root。最初 Seed 消失的原因尚未確認。先前 mixed r6/r7 PASS 僅適用於原本測試範圍，狀態仍為 **FIELD BLOCKED**。

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## 目前功能範圍

Presence、Selection、Transform 同步、基本 lock/ownership、受支援的 Same-Scene Hierarchy 操作、直接 P2P Project transfer、診斷/復原 UX 與 Windows path resilience 已實作或正在穩定化。r7 也包含 post-r5 Windows firewall onboarding、Seed port 忙碌/不可用時的 fallback、Windows Project identity crash recovery、額外 diagnostics，以及 SceneView `TeamForge · Locked by <owner>` 提示。

一般 Component/Inspector 同步、Prefab/一般 Asset collaboration、自動 Internet NAT traversal/relay 仍不支援。M4 選擇式 Session 持久復原已在原始碼實作，但尚未通過新的雙機及發行套件驗證。

## 尚待實機驗證

1. 在兩台 Windows PC 上全新解壓**確切 r11**，驗證 Firewall onboarding/UAC、限制為 Private + `LocalSubnet` 的窄 rule 與其 lifecycle。
2. 人為造成偏好的 Seed port 衝突/不可用，確認 fallback 後實際公布的 endpoint 可從另一台機器到達，並測試 Host Stop/Start 與 Fresh Guest transfer。
3. 在 Project identity 期間模擬異常 process loss，確認能安全 recovery，且模糊/衝突 identity 仍維持 fail closed。
4. 執行 Fresh Host → Fresh Guest → Unity realtime smoke；確認 foreign-lock feedback 容易理解，並在 release/takeover 後正確消失。
5. #182 維持為間歇 CI 監看，不以 retry/skip 隱藏；#79 繼續追蹤 transient SceneView edit 的 UX。

## 參考來源

功能、blocker 與證據細節請看 [English STATUS](STATUS.md)；精確選定值請看 [`release-contract.json`](../release-contract.json)；發布 byte identity 請看 [`builds/README.md`](../builds/README.md) 與 GitHub Release SHA-256。
