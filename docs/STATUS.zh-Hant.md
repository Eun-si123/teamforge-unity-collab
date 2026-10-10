# TeamForge 目前狀態

[English](STATUS.md) · [運作方式](HOW_IT_WORKS.zh-Hant.md)

_這份預覽翻譯已與 2026-10-08 版英文權威文件 `STATUS.md` 對照。詳細證據、Issues 與最新判斷仍以英文版為準。_

> **早期公開預覽：不要把 TeamForge 當成重要 Unity Project 的唯一副本或唯一復原方式。** 請保留備份，並優先使用可丟棄的測試 Project。

## 目前摘要

- 產品線：`0.5.1`
- Source lineage：`0.5.1-wp5.1-path-resilience`
- 最新已發布候選：`v0.5.1-prealpha-wp5.1-r8`
- r7 Source commit：`4aff5756329c2fe013d78344859e0760c6a382ef`
- Windows ZIP：`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r8-win-x64.zip`
- SHA-256：`3a003791043c067009250bf59da4d916e75eb6dc1b1ed0e93d54984a2d23eb21`
- 目標：Windows x64
- 發布準備狀態：**FIELD BLOCKED**
- Unity 系列：`6000.3`（已記錄測試 Editor：`6000.3.21f1`）
- Realtime / Project Transfer / Project Manifest：**v1**

## r8 發布及驗證範圍

r8 於 2026-10-10 發布，包含 PR #209 的 Direct Seed 健康狀態檢查、已驗證 Existing-Active 的安全重新開啟，以及拒絕巢狀 Project 根目錄等修正。已發布 ZIP 通過 Windows Exact Release Validation（執行 38019297086），但**尚未在兩台實際 Windows 電腦上完成 r8 測試**；發布狀態仍為 **FIELD BLOCKED**。下方 r7 測試結果僅為歷史證據，不能當作 r8 實機驗證。之後合併的 PR #217 與 #219 不包含在 r8 ZIP 中。

## r7 的證據邊界

r7 於 2026-10-03 從 commit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a 發布，之後通過 Windows **Exact Release Validation**。自動流程重新下載 Release ZIP，驗證 SHA-256 與 release manifest 中每個檔案的 hash，從不同 working directory 解壓到含韓文字元與空格的新路徑，並驗證封裝 Runtime/Node、Launcher fail-closed 行為、Windows path resilience 與真實 junction 測試。

這是**針對確切發布套件的自動化證據**。後續一次使用 r6 Host 與確切 r7 Guest 的實體雙機測試中，Guest 重用了既有 managed root，未再出現 `destination_contains_unmanaged_content`；將可信任 Host LAN 的 Windows profile 從 Public 改為 Private 後，流程繼續通過 Publisher trust、Project receive 與 Unity 啟動，並由使用者回報 TeamForge 已成功連線。不過，這仍未證明兩台機器都使用 exact r7、全新非管理員 UAC onboarding、Seed port fallback，或異常 process loss 後的實體 Project identity recovery。因此狀態仍為 FIELD BLOCKED。

2026-08-31 使用確切 r5 在兩台 Windows 電腦取得的實體證據，對當時實際執行的 reconnect、late join、receive/resume、long path、lock contention 與 Seed `5091`/transfer 情境仍然有效。發布 r7 不會改寫 r5 的 bytes 或既有結果。

## 後續 r7-on-Host 阻礙與未合併修正

後續實體測試發現 Host 顯示 Ready 時缺少可探索的 Direct Project Peer（`baseline_unavailable`）；開啟既有已驗證 Project 時出現長路徑 `DirectoryNotFoundException`。Source 檢查也發現，將個別 Project UUID 目錄選為 Projects root 可能產生巢狀 UUID。

PR #209 已於 2026-10-08 **合併至 `main`**。修正現已納入原始碼，但**不在已發布的 r7 ZIP** 中。更新後的 PR CI、Unity Tests 與 Engineering Quality Gate 均通過；仍需另一個不可變 Candidate 的 Exact-release 驗證及實機測試。先前 mixed r6/r7 PASS 只適用於原本測試範圍，狀態仍為 **FIELD BLOCKED**。

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-and-pending-source-fixes)

## 目前功能範圍

Presence、Selection、Transform 同步、基本 lock/ownership、受支援的 Same-Scene Hierarchy 操作、直接 P2P Project transfer、診斷/復原 UX 與 Windows path resilience 已實作或正在穩定化。r7 也包含 post-r5 Windows firewall onboarding、Seed port 忙碌/不可用時的 fallback、Windows Project identity crash recovery、額外 diagnostics，以及 SceneView `TeamForge · Locked by <owner>` 提示。

一般 Component/Inspector 同步、Prefab/一般 Asset collaboration、持久化 server/session restart recovery、自動 Internet NAT traversal/relay 目前仍不支援。

## 尚待實機驗證

1. 在兩台 Windows PC 上全新解壓**確切 r7**，驗證 Firewall onboarding/UAC、限制為 Private + `LocalSubnet` 的窄 rule 與其 lifecycle。
2. 人為造成偏好的 Seed port 衝突/不可用，確認 fallback 後實際公布的 endpoint 可從另一台機器到達，並測試 Host Stop/Start 與 Fresh Guest transfer。
3. 在 Project identity 期間模擬異常 process loss，確認能安全 recovery，且模糊/衝突 identity 仍維持 fail closed。
4. 執行 Fresh Host → Fresh Guest → Unity realtime smoke；確認 foreign-lock feedback 容易理解，並在 release/takeover 後正確消失。
5. #182 維持為間歇 CI 監看，不以 retry/skip 隱藏；#79 繼續追蹤 transient SceneView edit 的 UX。

## 參考來源

功能、blocker 與證據細節請看 [English STATUS](STATUS.md)；精確選定值請看 [`release-contract.json`](../release-contract.json)；發布 byte identity 請看 [`builds/README.md`](../builds/README.md) 與 GitHub Release SHA-256。
