# TeamForge の現在の状況

[English](STATUS.md) · [仕組み](HOW_IT_WORKS.ja.md)

_英語の基準文書 `STATUS.md` の 2026-10-08 版と照合したプレビュー翻訳です。詳細な証拠・Issue・最新の判断では英語版を基準にしてください。_

> **初期公開プレビューです。重要な Unity Project の唯一のコピーや復旧手段として TeamForge を使わないでください。** バックアップを維持し、できれば破棄可能な Project で試してください。

## 現在の概要

- 製品系列: `0.5.1`
- ソース系列: `0.5.1-wp5.1-path-resilience`
- 最新公開候補: `v0.5.1-prealpha-wp5.1-r8`
- r7 ソース commit: `4aff5756329c2fe013d78344859e0760c6a382ef`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r8-win-x64.zip`
- SHA-256: `3a003791043c067009250bf59da4d916e75eb6dc1b1ed0e93d54984a2d23eb21`
- 対象: Windows x64
- リリース準備状態: **FIELD BLOCKED**
- Unity 系列: `6000.3`（記録済み test Editor: `6000.3.21f1`）
- Realtime / Project Transfer / Project Manifest: **v1**

## r8 の公開と検証範囲

r8 は 2026-10-10 に公開され、PR #209 の Direct Seed の状態確認、検証済み Existing-Active の安全な再起動、Project root の入れ子防止が含まれます。公開済み ZIP は Windows Exact Release Validation（run 38019297086）に**合格**しましたが、**r8 を使用した実際の Windows PC 2 台での検証はまだ行っていません**。状態は引き続き **FIELD BLOCKED** です。以下の r7 の検証結果は当時の履歴であり、r8 の実機検証を意味しません。後からマージされた PR #217・#219 は r8 の ZIP に含まれません。

## r7 の証拠範囲

r7 は 2026-10-03 にcommit d88ca4c41ecf1f9cc7aa5d349960f407f158ce9a から公開され、公開後の Windows **Exact Release Validation** に合格しました。Release ZIP の SHA-256 と manifest 内の全ファイル hash、韓国語文字と空白を含む新規展開パス、同梱 Runtime/Node、Launcher の fail-closed 動作、Windows path resilience と実 junction の自動検査を確認しています。

これは **正確なパッケージに対する自動証拠**です。その後の物理試験では r6 Host と exact r7 Guest を使用し、既存 managed root を `destination_contains_unmanaged_content` なしで再利用できました。信頼済み Host LAN の Windows profile を Public から Private に変更すると、Publisher trust → Project receive → Unity 起動まで進み、ユーザーから TeamForge 接続成功が報告されました。ただし両 PC が exact r7 の試験、新規の非管理者 UAC onboarding、Seed port fallback、異常 process loss 後の物理 Project identity recovery はまだ未証明です。そのため FIELD BLOCKED のままです。

2026-08-31 に二台の Windows 実機で行った正確な r5 の試験結果は、当時実行した reconnect、late join、receive/resume、long-path、lock contention、Seed `5091`/転送の履歴証拠として引き続き有効です。r7 の公開は r5 の bytes や過去の結果を書き換えません。

## 後続の r7-on-Host ブロッカーと未マージ修正

後続の実機試験では、Host Ready のまま Direct Project Peer が見つからない `baseline_unavailable`、既存の verified Project を開く際の長いパスの `DirectoryNotFoundException`が確認されました。Source review では、Project UUID ディレクトリを Projects root に選ぶと UUID が入れ子になる可能性も判明しました。

2026-10-08 に PR #209 は `main` にマージされました。修正は現在のソースコードに含まれますが、**公開済み r7 ZIP には含まれません**。更新した PR の CI・Unity Tests・Engineering Quality Gate は通過しています。修正を実証するには別の immutable candidate による exact-release 検証と実機テストが必要です。以前の mixed r6/r7 PASS は当時の試験範囲に限られ、引き続き **FIELD BLOCKED** です。

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## 現在の機能範囲

Presence、Selection、Transform 同期、基本 lock/ownership、対応する Same-Scene Hierarchy 操作、直接 P2P Project transfer、診断/復旧 UX、Windows path resilience は実装済みまたは安定化中です。r7 には post-r5 の Windows firewall onboarding、使用不可/競合 Seed port fallback、Windows Project identity crash recovery、追加 diagnostics、`TeamForge · Locked by <owner>` SceneView feedback が含まれます。

一般的な Component/Inspector 同期、Prefab/一般 Asset collaboration、永続的な server/session restart recovery、自動 Internet NAT traversal/relay は現在の対応機能ではありません。

## 残る実地検証

1. **正確な r7** を二台の Windows PC に新規展開し、Firewall onboarding/UAC、Private + `LocalSubnet` の狭い rule と lifecycle を確認する。
2. 優先 Seed port を使用不可/競合状態にし、fallback 後に実際に通知された endpoint が到達可能であること、Host Stop/Start と新規 Guest transfer を確認する。
3. Project identity 作成/更新中の異常な process loss 後に安全に再開できること、曖昧/競合 identity が引き続き fail closed になることを確認する。
4. Fresh Host → Fresh Guest → Unity realtime smoke を実行し、他 Peer が lock を持つときの表示が理解でき、release/takeover 後に正しく消えることを確認する。
5. #182 は間欠的 CI 監視として残し、再発時に retry/skip で隠さない。#79 は transient SceneView edit の UX follow-up として残す。

## 情報の基準

機能・blocker・証拠の詳細は [English STATUS](STATUS.md)、正確な選定値は [`release-contract.json`](../release-contract.json)、公開 byte identity は [`builds/README.md`](../builds/README.md) と GitHub Release SHA-256 を参照してください。
