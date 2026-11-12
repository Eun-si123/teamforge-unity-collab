# TeamForge の現在の状況

[English](STATUS.md) · [仕組み](HOW_IT_WORKS.ja.md)

_英語の基準文書 `STATUS.md` の 2026-11-11 版と照合したプレビュー翻訳です。詳細な証拠・Issue・最新の判断では英語版を基準にしてください。_

> **初期公開プレビューです。重要な Unity Project の唯一のコピーや復旧手段として TeamForge を使わないでください。** バックアップを維持し、できれば破棄可能な Project で試してください。

> **2026-10-20 r9 field evidence:** Published r9 passed exact-release validation; user-reported two-PC basic collaboration and Guest reconnect PASS. Full recovery/negative field gate remains BLOCKED. [Current detail](https://github.com/Eun-si123/teamforge-unity-collab/blob/main/docs/STATUS.md).
> **2026-11-04 r10 user-reported two-PC field signal (not a package certification):** Basic Host/Guest collaboration, receive/reconnect, access-code rejection and one long destination were reported PASS; separate installed ZIP hashes were **not** checked on both machines. The published r10 ZIP passed [automated Exact Release Validation #41630492102](https://github.com/Eun-si123/teamforge-unity-collab/actions/runs/41630492102), but an actual Guest Wi-Fi/NIC outage was **NOT RUN** ([#457](https://github.com/Eun-si123/teamforge-unity-collab/issues/457)) and repeated Launcher startup exposed a defect (fixed in later source [#456](https://github.com/Eun-si123/teamforge-unity-collab/pull/456), **not** in r10). Full field readiness is **FIELD BLOCKED**. [Dated evidence](PHYSICAL_FIELD_EVIDENCE_2026-11-04_R10.md).

## M1 ソース統合：Collider の共同編集

M1 は明示的に有効化するソース機能で、公開済み r10 ZIP には含まれません。保存済みの非 Prefab Scene にある BoxCollider/SphereCollider の trigger・center・size/radius を、署名付き Scene/meta の実データ検証 → Server Authority → WebSocket → Unity Editor の経路で共有します。最初の検証後は未保存の Scene でもサーバーの runtime ledger、共通 revision/history、GameObject lock を使って連続編集できます。Collider Collaboration ウィンドウでは、自分の変更だけを対象とする条件付き Undo/Redo と、未確定のローカル値を確認して明示的に再送する復旧ボックスを提供します。サーバー確定、Editor 適用報告、ディスク保存は別の状態です。

証拠は四段階に分けます。**実装**：ソース経路は存在し、最終レビューと PR チェックが必要です。**自動検証**：実際の Node WebSocket による成功・競合・重複・late join・再接続と署名付きソースのテストは通過し、最終 SHA の結果は PR に記録します。**Unity 統合**：この環境には Unity Editor がなく、ローカルでは **NOT RUN**。CI の実 Editor 1 個＋Node peer の結果待ちは PASS ではありません。**パッケージ・Windows 実機**：M1 は **NOT RUN**、新たな配布昇格はなく、r10 の証拠と FIELD BLOCKED を維持します。

上限は Session ごとに Scene 1 個、メモリ保持 Session 128 個、Collider 512 個／プロパティ 1536 個、有限値 ±100／0–100 です。未対応フィールドはローカル専用です。Component 追加・削除、Prefab、参加済み Collider の所有オブジェクトや祖先の削除は M2 が必要で、この M1 経路では拒否します。編集者は互換機能をネゴシエートして参加する必要があります。全 peer の切断後も ledger はメモリに残りますが、**サーバー再起動で失われます**。永続復旧は M4 です。Unity 2 Editor、3 人 late join、保存・再読込、8 Editor の 1 時間 soak、正確な Windows 配布物は別途未検証です。次は M2 の Component ライフサイクルです。[最新の英語 STATUS](STATUS.md) と [実行設定](../server/README.md)を参照してください。

## 現在の概要

- 製品系列: `0.5.1`
- ソース系列: `0.5.1-wp5.1-path-resilience`
- 最新公開候補: `v0.5.1-prealpha-wp5.1-r10`
- r10 ソース commit: `693d3a9d647f9a511012f1ebba3209834531656e`
- Windows ZIP: `Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r10-win-x64.zip`
- SHA-256: `01afb269bd6235470bd75d1dda6a6c0119d0e21acea87087fe1115d0cd002f89`
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

## 後続の r7-on-Host ブロッカーと r8 再検証

後続の実機試験では、Host Ready のまま Direct Project Peer が見つからない `baseline_unavailable`、既存の verified Project を開く際の長いパスの `DirectoryNotFoundException`が確認されました。Source review では、Project UUID ディレクトリを Projects root に選ぶと UUID が入れ子になる可能性も判明しました。

PR #209 は 2026-10-08 に `main` にマージされ、修正は公開済み **r8 ZIP に含まれます**。r8 の Windows Exact Release Validation（run 38019297086）は通過していますが、実際の Windows PC 2 台での再検証はまだ必要です。Direct Seed が失われたときの Ready 解除、長いパスでの Existing-Active 再起動、Project UUID ディレクトリを Projects root に選んだ場合の拒否を確認してください。元の Seed 消失原因は未確定で、以前の mixed r6/r7 PASS は当時の範囲にのみ有効です。状態は **FIELD BLOCKED** のままです。

[PR #209](https://github.com/Eun-si123/teamforge-unity-collab/pull/209) · [English evidence/status](https://eun-si123.github.io/teamforge-unity-collab/status/#later-r7-on-host-blockers-now-packaged-for-r8-retest)

## 現在の機能範囲

Presence、Selection、Transform 同期、基本 lock/ownership、対応する Same-Scene Hierarchy 操作、直接 P2P Project transfer、診断/復旧 UX、Windows path resilience は実装済みまたは安定化中です。r7 には post-r5 の Windows firewall onboarding、使用不可/競合 Seed port fallback、Windows Project identity crash recovery、追加 diagnostics、`TeamForge · Locked by <owner>` SceneView feedback が含まれます。

一般的な Component/Inspector 同期、Prefab/一般 Asset collaboration、永続的な server/session restart recovery、自動 Internet NAT traversal/relay は現在の対応機能ではありません。

## 残る実地検証

1. **正確な r10** を二台の Windows PC に新規展開し、Firewall onboarding/UAC、Private + `LocalSubnet` の狭い rule と lifecycle を確認する。
2. 優先 Seed port を使用不可/競合状態にし、fallback 後に実際に通知された endpoint が到達可能であること、Host Stop/Start と新規 Guest transfer を確認する。
3. Project identity 作成/更新中の異常な process loss 後に安全に再開できること、曖昧/競合 identity が引き続き fail closed になることを確認する。
4. Fresh Host → Fresh Guest → Unity realtime smoke を実行し、他 Peer が lock を持つときの表示が理解でき、release/takeover 後に正しく消えることを確認する。
5. #182 は間欠的 CI 監視として残し、再発時に retry/skip で隠さない。#79 は transient SceneView edit の UX follow-up として残す。

## 情報の基準

機能・blocker・証拠の詳細は [English STATUS](STATUS.md)、正確な選定値は [`release-contract.json`](../release-contract.json)、公開 byte identity は [`builds/README.md`](../builds/README.md) と GitHub Release SHA-256 を参照してください。
