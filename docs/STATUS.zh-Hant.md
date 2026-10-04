# TeamForge 目前狀態

[English](STATUS.md) · [運作方式](HOW_IT_WORKS.zh-Hant.md)

_這份預覽翻譯已與 2026-10-04 版英文權威文件 `STATUS.md` 對照。詳細證據、Issues 與最新判斷仍以英文版為準。_

> **早期公開預覽：不要把 TeamForge 當成重要 Unity Project 的唯一副本或唯一復原方式。** 請保留備份，並優先使用可丟棄的測試 Project。

## 目前摘要

- 產品線：`0.5.1`
- Source lineage：`0.5.1-wp5.1-path-resilience`
- 最新已發布候選：`v0.5.1-prealpha-wp5.1-r7`
- r7 Source commit：`d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a`
- Windows ZIP：`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r7-win-x64.zip`
- SHA-256：`a710acd3cd7189c3f44ae1b4ee46a15239313c850ad7f6982e3a58f2492a13aa`
- 目標：Windows x64
- 發布準備狀態：**FIELD BLOCKED**
- Unity 系列：`6000.3`（已記錄測試 Editor：`6000.3.21f1`）
- Realtime / Project Transfer / Project Manifest：**v1**

## r7 的證據邊界

r7 於 2026-10-03 從上述 commit 發布，之後通過 Windows **Exact Release Validation**。自動流程重新下載 Release ZIP，驗證 SHA-256 與 release manifest 中每個檔案的 hash，從不同 working directory 解壓到含韓文字元與空格的新路徑，並驗證封裝 Runtime/Node、Launcher fail-closed 行為、Windows path resilience 與真實 junction 測試。

這是**針對確切發布套件的自動化證據**。後續一次使用 r6 Host 與確切 r7 Guest 的實體雙機測試中，Guest 重用了既有 managed root，未再出現 `destination_contains_unmanaged_content`；將可信任 Host LAN 的 Windows profile 從 Public 改為 Private 後，流程繼續通過 Publisher trust、Project receive 與 Unity 啟動，並由使用者回報 TeamForge 已成功連線。不過，這仍未證明兩台機器都使用 exact r7、全新非管理員 UAC onboarding、Seed port fallback，或異常 process loss 後的實體 Project identity recovery。因此狀態仍為 FIELD BLOCKED。

2026-08-31 使用確切 r5 在兩台 Windows 電腦取得的實體證據，對當時實際執行的 reconnect、late join、receive/resume、long path、lock contention 與 Seed `5091`/transfer 情境仍然有效。發布 r7 不會改寫 r5 的 bytes 或既有結果。

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
