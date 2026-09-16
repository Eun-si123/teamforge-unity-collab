# TeamForge の仕組み

このページは、**Host の開始、参加、プロジェクト転送、Scene 編集、切断、障害復旧で内部に何が起こるか**を説明します。完全なプロトコル仕様やソース一覧ではなく、流れに沿った解説です。

現在の対応/未対応範囲は[状況](STATUS.ja.md)、構造と信頼境界は[architecture](architecture.md)、ファイル単位の実装案内は[CODEMAP](../CODEMAP.md)、設計理由は[architecture-decisions](architecture-decisions.md)を参照してください。詳細な未翻訳資料は英語です。[英語原文](HOW_IT_WORKS.md)が意味の基準です。

## 60 秒でわかる構造

二つのデータ経路を意図的に分離しています。

- Host/Guest の Unity Editor は WebSocket で TeamForge Server の Session Authority と即時操作をやり取りします。
- Host Unity は Host Project Peer / Seed を使い、Guest Launcher は Guest Project Peer を使います。両 Peer が直接 HTTP でプロジェクトのデータを転送し、検証済み Active を Guest Unity へ渡します。
- Server は両 Peer に署名付き調整メタデータを提供しますが、プロジェクトファイルの relay にはなりません。
- Guest は信頼、完全性、activation、Unity 引き渡しの検査が通るまで受信内容を開きません。

大きな転送を遅延に敏感な協作通信から分けつつ、即時状態の権威を一つに保ちます。

## 主なプロセス

### Unity Editor パッケージ

Host フロー、即時接続ライフサイクル、Presence、対象 Transform/Lock・同じ Scene の Hierarchy、診断/復旧表示、承認された遠隔状態のローカル Scene への適用を担当します。クライアントは**権威を観測**します。一つの Editor に値があるだけで共有の正解にはなりません。

### TeamForge Server

二つの役割があります。**Session Authority** はメンバー、共有 revision/順序、lock/lease、保持する対象 Scene 状態、replay/冪等性保護、即時 effect を管理します。**Project Coordinator** は署名付き project/publisher/baseline/peer メタデータを調整します。通常の Manifest/File/Chunk データを保存・中継しません。

### Project Peer

署名招待の検証、決定的 manifest/hash、直接 HTTP、検証付き resume、staging、不変 Active revision、ファイル/パス安全性、project/publisher 信頼を担当します。ダウンロード成功だけでは activation できず、全検証・信頼経路の通過が必要です。

### Windows Guest Launcher

新規 Guest は開くプロジェクトがまだないため Unity の外から開始します。Launcher は同梱 Runtime、招待、信頼を検証し、Project Peer で受信、最終 Active と必要 Unity を検証して引き渡します。通常のパッケージ利用者にシステム Node.js/npm のインストールや手動操作は不要です。

現在の Launcher ソースには**手動のローカル support bundle**作成もあります。これは範囲を限定し機密情報を除去した観測 ZIP で、自動アップロード、権威の付与、招待/信頼/activation/Runtime/パス/Unity 検証の迂回は行いません。実際に含まれるかは正確なパッケージ次第です。[状況](STATUS.ja.md)と[builds](../builds/README.md)がソースと公開パッケージを区別します。

## Host が協作を始めるとき

1. Host が **Publish & Start** を選択。
2. Unity がローカルプロジェクトと保存済み Scene の前提を検査。
3. Project Peer が決定的 baseline を準備し、ファイル/チャンクに完全性識別子を付与。
4. Host Peer が直接転送 Seed を開始。
5. project/publisher/baseline/peer メタデータを Server と調整。
6. 署名付き Collaboration Invite を作成し、Guest を受け入れる準備が完了。

実装にはさらに fail-closed 検査があります。**Host Ready は単にポートが開いたという意味ではなく**、Guest に必要な転送/即時セッション契約が成立した状態です。招待はアクセスコード、秘密署名鍵、任意のローカルパスを持ち運ぶものではありません。アクセスコードを使う場合は別途共有します。

## 新規 Guest が参加するとき

1. Windows Guest Launcher を開き、同梱 Runtime を検証。
2. 招待を読み込み/貼り付け、構造と署名を検証。
3. Project / Owner / Publisher の身分と信頼を確認。
4. 調整された Host / Seed に接続し、descriptor / manifest / inventory を取得。
5. 必要なチャンクだけを受信し、chunk/file/manifest/project の完全性を検証。
6. staging で構築し、候補プロジェクト全体を検証。
7. 不変 Active revision を作成し、小さな current-project ポインターを移動。
8. 必要な Unity 実行ファイルと最終引き渡しを検証し、検証済みプロジェクトを Unity で開く。

部分ダウンロードの任意ディレクトリを現在のプロジェクト扱いしません。新 revision の受信中や activation 失敗時も以前の検証済み Active を保持できます。

### Resume も検証に従う

中断時、契約で許される検証済みデータを再利用できます。ディスク上に存在するファイルを無条件で信用するのではなく、hash と activation 契約が基準です。

## 対象 Scene オブジェクトを編集するとき

1. ユーザーが対象 GameObject を移動し、Unity Transform サービスが変化を検知。
2. 権威に基づく正規オブジェクト identity を解決。
3. lock/lease と現在の接続権威を確認し、WebSocket で Transform 操作を送る。
4. Server が操作を検証し、順序/revision/冪等性規則を適用。
5. 承認 effect を他クライアントへ配信。
6. 受信側が Authority View を更新し、Unity が承認された遠隔 Transform を安全に適用。

**Identity：** 二つの Editor は同じ名前や Hierarchy パスではなく、**同じ論理オブジェクト**を指す必要があります。保存済み Scene は安定した Unity identity を基準にし、対象のセッション生成物は権威的な結び付け後に TeamForge identity を得られます。曖昧さは名前・兄弟番号・パスで推測せず fail-closed です。

**Authority：** Server が受理する共有即時状態を決めます。クライアントは意図を送り承認結果を適用し、独立して競合する正解を作りません。

**Revision と順序：** 受理操作が共有順序を進めます。revision により古い状態、遅延参加、replay、期待する共有状態に対して評価されたかを判断できます。

**Lock/lease：** 権威管理の lock/lease で二人による無言の上書きを防ぎます。クライアント消失時、lease は永続 lock にならず期限切れになります。

**Replay/冪等性：** 同じ操作の正当な再試行と、識別子を流用する別操作を区別します。二重配送で状態を二度変更してはいけません。

## Hierarchy の変更

同じ Scene 内の対象作成/削除/改名/親変更/兄弟順序は独立の権威経路を使い、通常の Transform 操作に見せかけません。Transform は構造に依存するため、親や identity が異なると同じローカル数値でも異なる Scene になります。一般的な Component/Inspector/Prefab/Asset 同期や任意の Scene 間構造まで対応すると推定しないでください。[状況](STATUS.ja.md)が範囲を示します。

## 再接続と connection epoch

再接続だけで旧権威が有効とはなりません。切断→接続に属する権威を信用しない→再接続/handshake→現在の合意機能と権威状態を取得→新 epoch に対象 object authority を再結合→必要状態が揃ってから協作再開、という流れです。保存 alias やローカル identity cache は解決を助けても、自身で権威を与えません。

## 障害と復旧

未知の状態を強行突破せず、検証済み状態を守ります。

- Runtime 破損：未検証コード実行前に停止。
- 不正/競合招待：既存 project binding を変更しない。
- 転送失敗：許可される検証済み進捗を保存。
- activation 失敗：以前の検証済み Active を置換しない。
- Unity パス問題：個別検証された TeamForge 所有のパス耐性戦略だけを使用。
- baseline/identity 不一致：推測せず調整/更新を要求。
- 必要ポートの未知プロセス：ポートが欲しいという理由で終了させない。

復旧は**状態に基づきます**。Retry、Paste New Invite、Use Latest Project、Open Existing Verified Project、Choose Unity は、安全な意味が定義された状態でだけ提示します。

**診断は観測であって復旧権威ではありません。** 診断コピーや手動 ZIP は実行の説明に役立ちますが、保存だけで Project 選択、再試行、Publisher 信頼、activation、検査緩和は起きません。広範なプロジェクト/マシンデータではなく限定的な安全状態を収集し、それでも公開前の内容確認は必要です。

## 転送と即時協作を分離する理由

即時協作には小さく順序付きの権威メッセージが適します。一方初期転送は多数ファイル、大量バイト、再試行/resume/hash/staging/ディスク処理を含みます。分離で Server の隠れた転送ボトルネックを避け、安全/障害境界を理解しやすくします。

代償は Guest が Host Peer に実際に到達する必要があることです。同機、到達可能 LAN、管理 VPN に適します。自動 Internet discovery/NAT 穿透/relay は別の将来課題で、P2P という語には含まれません。

## 状態の所在と寿命

| 状態 | 所在/寿命 |
| --- | --- |
| Session Authority | 生きているセッションの Server メモリ |
| Project coordination registry | Server メモリ |
| Client Authority View | 現在の Unity 接続 |
| 転送データ/staging | 管理 Project Peer ストレージ |
| 検証済み Active revision | 永続的な管理 Project ストレージ |
| current Active ポインター | 小さな永続メタデータ |
| Launcher 診断履歴 | 現在の実行内、範囲限定 |
| 手動 support bundle | ユーザー作成のローカル限定/機密除去 ZIP、自動送信なし |

永続ダウンロードは即時権威履歴の永続性を意味せず、保存された診断も協作権威にはなりません。再起動、再接続、resume、復旧ではこの区別が重要です。

## 実装をたどる

正確なファイル名とテストは[CODEMAP](../CODEMAP.md)を使い、この解説へ複製しません。典型的な担当は、接続：Unity `TeamForgeConnectionService` + Server WebSocket host、Transform/Lock：Unity Transform + Authority View + Session Authority、Hierarchy：Unity Hierarchy + Server Hierarchy/Session Authority、転送：Peer Host/Guest orchestrator + direct-transfer source + content store、Guest 起動/復旧：Windows Launcher + Launcher Core + Guest orchestrator、診断：Launcher UI + Core support-bundle/redaction、パス耐性：Launcher Core + Peer 共通契約です。これによりファイル再編後も解説が有用なままです。
