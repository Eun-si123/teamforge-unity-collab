# TeamForge の現在の状況

[English](STATUS.md) · [仕組み](HOW_IT_WORKS.ja.md)

_英語原文の文書確認日：2026-09-10 UTC。main にある r5 後の Windows ネットワーク・診断・Project identity 強化、公開 r5 成果物、2026-08-31 の正確な r5 実機結果を照合した内容。公開パッケージと新しいソースの証拠は別です。_

> **初期公開プレビュー：重要な Unity プロジェクトの唯一のコピーや復旧手段として TeamForge を使わないでください。** 元の WP5.1 Windows ブロッカーには正確な r5 で相当の実機検証があります。ただし main は r5 より新しく、追加されたネットワーク・identity 動作を含む一つの置換パッケージの実機検証はまだありません。バックアップを取り、破棄できるテスト用プロジェクトを優先してください。

現在の機能・リリース準備状況の基準は[英語 STATUS](STATUS.md)です。ほかの文書で独立したブロッカー一覧を維持しないでください。正確な選定値は[release-contract.json](../release-contract.json)、パッケージのバイト同一性と旧ビルドの扱いは[builds/README.md](../builds/README.md)、詳細な不具合・再現履歴は GitHub Issues を参照します。

## 現在の概要

- 製品系列：`0.5.1`
- ソース系列：`0.5.1-wp5.1-path-resilience`
- 最新公開候補：`v0.5.1-prealpha-wp5.1-r5`
- r5 ソース/tag commit：`a97b6ba5649e2888b909bf3c99c64acfd7042ba6`
- ZIP：`Unity-TeamForge-0.5.1-WP5.1-path-resilience-candidate-r5-win-x64.zip`
- SHA-256：`5944abf2263502ee40f49d0ac2c8a9826a809dc4cd1b20c9edf82f94ba35f8cc`
- パッケージ対象：Windows x64
- リリース準備状態：**FIELD BLOCKED（実地検証条件が未充足）**
- Unity 系列：`6000.3`、記録済み候補テスト Editor：`6000.3.21f1`
- Realtime Protocol / Project Transfer Protocol / Project Manifest Schema：いずれも **v1**

## ソースと公開候補の区別

#67、#68/#74、#69、#70、#71 の元の WP5.1 安定化修正は PR #81 までにマージされました。上記 commit の r5 はそれらと r4 後の Launcher **Save support bundle** 統合を含みます。

2026-08-31、正確な r5 を二台の Windows 実機で検証しました。保存済み Guest の再接続、新規遅延参加の Transform snapshot、受信中の強制終了と再開、長い/深いパスの execution alias 引き渡し、古い lock 競合による protected conflict の復旧を解消確認しました。必要なファイアウォール許可後、Seed TCP `5091` で Host Stop/Start の再バインドと実際の Guest 転送も確認しました。

これらは最初の r5 実機再試験を待っている状態ではありません。一方、新しいソース変更を r5 の機能と見なしたり、一般にインストール可能な alpha と見なしたりする根拠にはなりません。公開候補の主張は r5 とその 2026-08-31 の証拠に限定し、main とバイト/動作が同等とは表現しないでください。古い一覧のために解消済み試験を未完了扱いせず、main を配布するなら新しい不変成果物を発行して r5 後の動作をその成果物で検証します。

## r5 に含まれない後続のソース強化

- ユーザーと UAC の明示承認後、Private プロファイル・LocalSubnet に限定した Coordinator/Seed 受信規則を作成できる Windows LAN 導入処理。TeamForge 所有規則の調整/削除もあります。r5 実機では手動許可が必要だったため、この処理には新しい正確なパッケージでの実機証拠が必要です。
- 優先/既定ポートが使用中または利用不可（Windows bind-context `EACCES` を含む）の場合、Host は OS 選択ポートで一度再試行し、選んだ端点を通知します。Windows Project Peer 自動テストはありますが r5 後の動作です。
- Project identity 作成の直列化と Windows クラッシュ復旧：OS 所有 named-pipe live lock と旧 writer 用の恒久的 compatibility fence。Windows Node 22/24 のクラッシュ/並行試験は合格しましたが、この変更を含む公開パッケージの実機証拠はありません。
- Coordinator 拒否時の後処理、HTTP キャンセル/期限の強化、Host 診断情報、WebSocket client-role ログ、Launcher 招待と `TF1` 接続コードの区別。

以上はソース/自動化の事実です。Linux/macOS の Project identity stale-lock 復旧は Windows 固有の変更範囲外です。

## 機能の状況

| 領域 | ソースの状態 | 証拠の範囲 |
| --- | --- | --- |
| 接続ユーザーの Presence | 実装・実行済み | 二台実機の基準試験成功。広い外部試験は有益 |
| 選択/Editor 状況共有 | 実装・実行済み | 広い外部試験は有益 |
| Transform 同期 | 実装・安定化中 | r5 二台遅延参加/競合復旧合格。実地範囲と UX 改善は残る |
| 基本 lock/所有権 | 実装・安定化中 | r5 競合/復旧合格。他者ロック中の編集 UX は #79 |
| 同じ Scene の Hierarchy 作成/削除/改名/親変更/順序 | 実装・安定化中 | 対象子集合を実機確認。広い試験は有益 |
| 初期転送/Collaboration Invite | 実装・安定化中 | r5 保存済み Guest 再接続合格。後続 identity クラッシュ復旧はパッケージ/実地未確認 |
| 直接 P2P 転送 | 実装・安定化中 | r5 `5091` Stop/Start と実転送合格。後続 firewall/ポート fallback は置換パッケージ未確認 |
| 診断/復旧 UX | 実装・安定化中 | r5 はプライバシーに配慮した support bundle を含む。後続改善はソースのみ |
| Windows パス耐性/execution alias | 実装・安定化中 | r5 長い/深いパス引き渡し合格。不正/無関係 alias 拒否は自動 fail-closed 試験 |
| Component/Inspector 同期 | 計画 | 一般的な Component 追加/削除、SerializedProperty 同期は未対応 |
| Prefab/一般 Asset 協作 | 計画 | 現在の対応フローではない |
| 永続的な server/session 再起動復旧 | 計画 | authority/session はメモリ内 |
| 自動 Internet NAT 穿透/relay | 研究・将来 | WebRTC、ICE、STUN、TURN、relay、discovery、自動 NAT 穿透なし |

## 正確な r5 実機の解消記録

この表は元のブロッカーが実機未確認とする古い記述を置き換えます。

| Issue | 結果と残る範囲 |
| --- | --- |
| [#67](https://github.com/Eun-si123/teamforge-unity-collab/issues/67) | **PASS**：正当な共同編集/保存→Guest Unity 終了→同じ検証済み Active Project 再開→`guest_handoff_mismatch` なしで再参加。新規/未検証 identity 拒否は厳格な実装と自動回帰で保護 |
| [#68](https://github.com/Eun-si123/teamforge-unity-collab/issues/68) | **PASS**：新規 Guest が権威ある Hierarchy/Transform/Lock と後続 Transform を誤った protected conflict なしで受信。広い試験は有益だが元のブロッカーは解消 |
| [#74](https://github.com/Eun-si123/teamforge-unity-collab/issues/74) | **PASS**：競合の敗者が権威状態へ復旧し協作継続。他者 lock 中の UX は別途 #79 |
| [#69](https://github.com/Eun-si123/teamforge-unity-collab/issues/69) | **PASS**：受信中に Launcher を繰り返し強制終了。検証済み部分データを再利用して完了、元の CLR/application error は再現せず。将来の runtime 変更でも回帰保護を維持 |
| [#70](https://github.com/Eun-si123/teamforge-unity-collab/issues/70) | **r5 製品目標は PARTIAL／安定 Seed 経路は PASS**：TCP `5091` Stop/Start 再バインドと許可済み firewall での実転送成功。新しい自動 firewall 導入と使用不可ポート fallback は置換パッケージ実機証拠が必要 |
| [#71](https://github.com/Eun-si123/teamforge-unity-collab/issues/71) | **PASS**：長い/深い宛先でパス最適化が動き、Unity 起動と即時協作成功。不正/無関係/付け替え alias の拒否は自動 fail-closed 試験 |

詳細な時系列は Issues、現在のリリースへの影響は英語 STATUS が管理します。

## 自動化とローカルの証拠

PR #81 マージ前の統合 head は `docs/MAIN_PATCH_STATUS_2026-08-27.md` に記録した保護ゲートに合格しました。

- CI #216：Server、Project Peer、Launcher runtime loader、Windows Launcher、公開ソース契約 **PASS**。
- Dependency Review #140：**PASS**。
- Unity Tests #73：Lock Contention E2E、Realtime Authority E2E、Realtime Authority Chaos E2E、Project Transfer Resume E2E **PASS**。
- 以前のローカル Unity Test Runner：実行可能な **143/143 PASS**。CI 専用実サーバーテスト二件は意図的にローカル除外。
- 同一マシン A/B 競合復旧 **PASS**。A/B/C 遅延参加 Hierarchy/Transform 収束 **PASS**、記録回の protected conflict はゼロ。

後続強化にも Project Peer/Launcher/Unity の重点試験と通常ゲートがあります。特に Windows identity クラッシュ/並行試験は対応 Node 22/24、Seed ポート使用不可回帰は再現 Windows 環境の Project Peer 全スイートで合格。修正前の公開バイトに対するパッケージ証拠にはなりません。

## 記録された二台実機の証拠

2026-08-22 の基準試験：Host→署名招待→新規 Guest→認証→直接転送→Publisher 信頼→検証済み Active→Unity 即時接続、Presence/双方向 Transform、通常の lock 競合、対応 Hierarchy 作成/改名/親変更/兄弟順序/削除を確認。未保存 Guest の終了/再開では継続中セッションから Hierarchy/Transform/Lock を復旧。Coordinator TCP 中断後は Unity 再起動なしで再試行/自動再接続しました。

2026-08-31 は上記の正確な r5 ZIP/SHA を二台で使い、保存再接続、遅延参加、受信再開、長いパス、競合復旧を解消確認。安定 Seed `5091` と LAN 転送も確認しましたが、当時の新規 firewall 許可は手動でした。

## 証拠の限界

結果が証明するのは実行した範囲だけです。ソース CI は ZIP の正しさを証明せず、Unity 自動化は全 SceneView 入力順、Windows プロセス状態、LAN/firewall、二台目のタイミングを再現しません。同機試験は OS・ネットワークスタック・時間条件・ハードウェアを共有します。r5 実機証拠は r5 のバイトと試験対象だけで、後続 main の証拠ではありません。版番号はバイト同一性ではなく、正確なファイル名/SHA-256 が必要です。Issue 解消で後続の全変更が実機確認済みにはなりません。歴史資料は当時の記録として有効ですが、現在の準備状況は英語 STATUS が優先します。

## 残るリリース条件

1. r5 実機結果を完了済みとして保存し、#67/#68/#69/#71/#74 を未解消扱いしない。
2. main を配布するなら r5 後の動作を含む新しい不変候補を公開する。
3. その正確な成果物で、新規 firewall 導入、狭い規則範囲とライフサイクル、優先ポート使用不可/競合 fallback、公告 Seed の実到達性、Host Stop/Start、新規 Guest 転送を実機検証する。
4. Windows identity クラッシュ後の安全な再起動と、曖昧/競合 identity の継続した fail-closed を同じ成果物で検証する。
5. 新規展開 Host→新規 Guest→即時協作の smoke を実行し、r5 の証拠を新しい統合へ自動継承しない。
6. 正確な候補ファイル名/SHA/ソース身分と、実際に行った試験だけを記録する。
7. インストール/更新/アンインストール案内を進め、広い信頼性主張の前に作者以外の試験/レビューを得る。

サーバープロセス再起動は現在、**切断/fail-closed/新セッション復旧**です。永続 authority/session 復旧は未実装で、永続性試験ではありません。

## 情報の管理元

現在の機能/ブロッカーは[英語 STATUS](STATUS.md)、精確な選定は[release-contract.json](../release-contract.json)、公開/旧バイトは[builds/README.md](../builds/README.md)と Release SHA-256、全体フローは[仕組み](HOW_IT_WORKS.ja.md)、計画は[ROADMAP](ROADMAP.md)、構造は[architecture](architecture.md)、判断理由は[architecture-decisions](architecture-decisions.md)、試験シナリオは[TEST_LAB](TEST_LAB.md)、不具合詳細は Issues、過去の試験は日付付き記録を参照してください。未翻訳の詳細文書は英語です。
