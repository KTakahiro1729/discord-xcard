# Discord 匿名セーフティカード

Discord のボイスチャットで使える、匿名のタイム／Xカードです。Cloudflare Workers 上で動作します。

- **⏱ タイム** — 選択した理由カテゴリだけを、匿名で知らせます
- **✕ Xカード** — 会話をすぐに止めたいとき、同じVCにいる全員をサーバーミュートします

どちらのカードも、発動者のIDや名前を保存・表示しません。身内や小規模なDiscordサーバーでの利用を想定しています。

> [!IMPORTANT]
> Xカードは、押した本人を含むVC参加者全員をサーバーミュートします。初期設定では5秒後にBotが自動解除します。自動解除は短時間のベストエフォート処理なので、テストするときは手動解除できる管理者がVCにいる状態で実行してください。

## 仕組み

### ⏱ タイム

ボタンを押すと、本人だけに理由カテゴリのセレクトメニューを表示します。選択後、発動者が参加しているVCのチャットへ、Bot名義でカテゴリだけを匿名投稿します。タイムでは参加者へのメンションを行いません。発動者がVCに参加していない場合は投稿しません。参加者のミュートや非公開ログへの記録は行いません。

選べるカテゴリ:

- 話題を変えたい
- 一言だけ挟みたい（退席・連絡など）
- ペースを落としてほしい
- 他の人に振ってほしい
- 時間を気にしてほしい
- 言い方を柔らかくしてほしい
- 理由は言わない

### ✕ Xカード

1. 発動者が専用チャンネルの「Xカード」を押す
2. Workerがカードに設定された範囲（初期値5〜10秒）からランダムな発火時刻を決める
3. Discord Gatewayへ一時的に接続し、発動者が参加しているVCを特定する
4. 発火時刻まで待ち、そのVCにいた全員をサーバーミュートする
5. 対象VCのチャットへ結果を投稿し、そのVCの参加者全員へ個別メンションする。個人を識別しない処理結果だけをCloudflare Workers Logsへ記録する
6. 設定時間後、今回Botがミュートできたメンバーだけを自動解除する
7. Gateway接続を終了する

## 導入に必要なもの

- Cloudflareアカウント
- GitHubアカウントと、このリポジトリへのアクセス権
- Discordサーバーの管理権限
- 以下の権限を持つDiscord Bot
  - チャンネルを見る
  - メッセージを送信
  - 埋め込みリンク
  - メンバーをミュート

> [!IMPORTANT]
> Botのロールは、参加者へ割り当てるすべてのロールより上に配置してください。また、Botのロールへ「メンバーをミュート」権限を付与してください。このBotは安全側へ倒すため、Discordの最低要件より保守的にこの条件を必須とします。

## かんたんセットアップ

コマンド入力やプログラムの編集は必要ありません。GitHubリポジトリをCloudflareへ接続し、設定値を入力します。以後は `main` ブランチの更新が自動デプロイされます。

### 1. Discordアプリを作成する

1. [Discord Developer Portal](https://discord.com/developers/applications) でApplicationを作成する
2. `Bot` ページでBotを作成する
3. `General Information` で次の値を控える
   - Application ID
   - Public Key
4. `Bot` ページでTokenを発行する
5. `OAuth2` → `URL Generator` で `bot` と `applications.commands` を選ぶ
6. 「導入に必要なもの」に記載したBot権限を選び、Botをサーバーへ追加する
7. サーバー設定のロール一覧で、Botのロールを参加者へ割り当てるすべてのロールより上へ移動する

`GUILD_VOICE_STATES` は非特権Intentのため、Developer Portalで個別に有効化する必要はありません。

### 2. GitHubリポジトリをCloudflareへ接続する

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) を開く
2. `Workers & Pages` → `Create application` を選ぶ
3. `Import a repository` の `Get started` を選ぶ
4. GitHubを接続し、`KTakahiro1729/discord-xcard` を選ぶ
5. 次のビルド設定を確認する

| 項目 | 設定値 |
|---|---|
| Project name | `discord-x-card` |
| Production branch | `main` |
| Build command | 空欄 |
| Deploy command | `npx wrangler deploy` |
| Root directory | 空欄 |

6. `Save and Deploy` を押す
7. デプロイ完了後、表示された `workers.dev` のURLを控える

> [!IMPORTANT]
> Cloudflare上のWorker名は `discord-x-card` にしてください。`wrangler.toml` の名前と異なる場合、Git連携のビルドは失敗します。
>
> Git連携には対象リポジトリへのアクセス権が必要です。第三者へ配布する場合は、このリポジトリを公開するか、利用者自身がアクセス可能なコピーを用意する必要があります。

### 3. 環境変数を設定する

作成したWorkerで `Settings` → `Variables & Secrets` を開き、Production環境に必須の4項目を追加します。自動解除時間は任意で追加できます。ビルド時の変数ではなく、Workerのランタイム変数として設定してください。

| 名前 | 種類 | 値 |
|---|---|---|
| `DISCORD_APPLICATION_ID` | Text | DiscordのApplication ID |
| `MAX_VC_MEMBERS` | Text | `40` |
| `DISCORD_PUBLIC_KEY` | Secret | DiscordのPublic Key |
| `DISCORD_BOT_TOKEN` | Secret | DiscordのBot Token |
| `X_CARD_AUTO_UNMUTE_SECONDS` | Text（任意） | 自動解除までの秒数。未設定は`5`、`0`で無効、最大`10` |

> [!CAUTION]
> Public KeyとBot Tokenは第三者へ送らず、READMEやチャットにも貼らないでください。

保存後、WorkerのURLをもう一度開き、正常に応答することを確認します。今後 `main` が更新されると、Cloudflare Workers Buildsが自動的にビルドとデプロイを行います。

以前のバージョンから更新する場合、`LOG_CHANNEL_ID` は使われなくなったためCloudflareのVariablesから削除できます。Discord側の非公開ログチャンネルも不要です。必要な過去ログを確認してから、管理者の判断で削除してください。

### 4. Discordと接続する

1. Cloudflareの `Deployments` に表示されたURLを開く
2. `Discord X-card Worker is running.` と表示されることを確認する
3. URL（例: `https://discord-x-card.<アカウント名>.workers.dev/`）をコピーする
4. Discord Developer Portalで対象のApplicationを開く
5. `General Information` → `Interactions Endpoint URL` にURLを貼り、保存する

Discordから送られる接続確認を受けると、Workerが `/xcard-setup` を自動登録します。Discordに表示されるまで数分かかることがあります。

### 5. カードを設置する

Xカード用のチャンネルで、サーバー管理権限を持つユーザーが次のコマンドを実行します。

```text
/xcard-setup
```

必要なら、コマンドの候補から次の設定を指定できます。省略した項目は初期値になります。

| オプション | 初期値 | 指定範囲 |
|---|---:|---|
| `auto_unmute_seconds` | 環境変数、未設定なら5秒 | 0〜10秒（0で自動解除なし） |
| `delay_min_seconds` | 5秒 | 0〜20秒 |
| `delay_max_seconds` | 10秒 | 0〜20秒（最短以上） |
| `time_button_label` | タイム | 1〜80文字 |
| `xcard_button_label` | Xカード | 1〜80文字 |

例:

```text
/xcard-setup auto_unmute_seconds:5 delay_min_seconds:5 delay_max_seconds:10 time_button_label:ちょっと待って xcard_button_label:ストップ
```

設定は設置したカード自体に保存されるため、KVやD1は不要です。設定を変える場合はコマンドを再実行して新しいカードを設置してください。既存カードの設定は変わりません。

実行時にBotの「メンバーをミュート」権限とロール位置を確認します。要件を満たさない場合はカードを設置せず、そのチャンネルへ公開警告を投稿します。

警告には満たしていない要件を省略せず列挙します。権限不足とロール位置不正が同時にある場合は両方を表示します。Discord APIの確認に失敗した場合も、Bot情報・ロール一覧・サーバー内Bot情報のどれを取得できなかったかを表示します。

カードまたはタイムの投稿に失敗した場合は、DiscordのHTTPステータスとエラーコードから、Token不正、チャンネル非表示、送信権限不足、レート制限、Discord API障害、カードデータ不正を区別して本人へ表示します。同じステータスとコードはCloudflare Workers Logsにも記録します。

投稿された⏱と✕のボタンを、VCへ参加した状態で押して動作を確認してください。通常の通知はカード設置チャンネルではなく、参加中VCのチャットへ投稿されます。Xカード通知だけは、`@everyone` ではなく確認時点のVC参加者を個別メンションします。タイム通知ではメンションしません。X発動直前にも同じ確認を行うため、設置後にロール設定が変わった場合は誰もミュートせず公開警告を投稿します。

## 運用ルールの例

以下は使用例です。Botが強制する規則ではありません。サーバー管理者が参加者やセッションに合わせて、採用・変更してください。

> - タイムやXが出た理由、発動者、原因になった人を詮索しない
> - ツールを使わなかったことを、同意した証拠として扱わない
> - 使用頻度を参加者個人の評価に使わず、まず卓全体を見直す材料にする
> - 休憩、退出、その日の中止を正当な選択肢として扱う
> - 妨害目的の利用が疑われる場合の対応は、ツール外で管理者が判断する

## 匿名性について

このBotが保証する範囲:

- 公開メッセージに発動者を表示しない
- Discord内に非公開ログチャンネルを作成せず、発動履歴を投稿しない
- Workers Logsに発動者ID、名前、Interaction本文、VC・チャンネル・メンバーID、タイムの理由カテゴリを出力しない
- Workers Logsにはランダムな処理ID、成否、件数、処理時間、一般化した失敗理由だけを構造化して出力する
- Discordの監査ログでは、操作主体がBotとして記録される

保証できない範囲:

- Discord社に対する匿名性
- 発動時刻やVC参加者から発動者を推測される可能性
- Cloudflareの実行中メモリに対する完全な不可視性
- Cloudflareアカウントの管理者に対する処理時刻や集計結果の不可視性

## Cloudflareでログを確認する

Discord内のログチャンネルは使用しません。Cloudflare Dashboardで `Workers & Pages` → `discord-x-card` → `Observability` → `Logs` を開くと、保存済みログを検索できます。`Logs` → `Live` ではリアルタイムログを確認できます。

主なイベント:

| イベント | 内容 |
|---|---|
| `xcard_mute_completed` | ミュートの試行・成功・失敗人数、公開通知の成否、処理時間 |
| `xcard_rejected` | VC未参加、人数上限、権限・ロール不備などの一般化した中止理由 |
| `auto_unmute_dispatched` | 自動解除処理の受付結果 |
| `auto_unmute_completed` | 自動解除の試行・成功・失敗人数 |
| `setup_completed` / `setup_rejected` | カード設置の成否 |
| `time_post_completed` | タイム投稿の成否。理由カテゴリは記録しない |
| `request_rejected` | Discord署名検証に失敗したリクエスト |

すべてJSONオブジェクトとして記録されるため、Cloudflare上で `event`、`failed`、`reason` などを条件に絞り込めます。各操作にはランダムな `event_id` を付けますが、Discordユーザーとの対応情報は保存しません。

Workers無料プランの保存ログは最大3日間です。長期的な監査記録ではなく、障害調査と権限設定の確認を目的とします。

## 制限事項

`MAX_VC_MEMBERS` の初期値は40です。Xカードは参加者1人につき1回Discord REST APIを呼び出すため、Cloudflare Workers無料枠のサブリクエスト上限に余裕を持たせています。

設定値を45より大きくしても、コード側で45に制限されます。

`X_CARD_AUTO_UNMUTE_SECONDS` は未設定時5秒です。値を `0` にすると自動解除せず、従来どおりDiscordの標準UIで解除します。1〜10秒を指定でき、それより大きい値は10秒に制限されます。

自動解除にはKV、D1、Durable Objects、Workflowsを使用しません。ミュート後に署名付きの内部リクエストを同じWorkerへ送り、別の実行枠で解除します。追加サービスやbindingは不要です。

> [!WARNING]
> 自動解除はCloudflareの短時間バックグラウンド処理に依存するベストエフォート機能です。WorkerやDiscord APIの障害時には解除されない可能性があるため、管理者は手動解除できる状態を維持してください。重複したXは独立して処理され、先に発動したXの自動解除が、後から発動したXのミュートを早めに解除する場合があります。これは連打で停止時間が延び続けないよう、早い解除を優先する仕様です。

## エラー時の動作

| 状況 | 動作 |
|---|---|
| 発動者がVCにいない | 発動者だけにエラーを表示 |
| Botに「メンバーをミュート」権限がない | カード設置またはX実行を中止し、チャンネルへ公開警告を表示 |
| Botのロールが参加者用ロール以下にある | カード設置またはX実行を中止し、ロールを上へ移動するよう公開警告を表示 |
| VC固有の権限などにより一部処理できない | 公開通知とCloudflare Workers Logsに失敗人数を記録 |
| GatewayからVC情報を取得できない | 発動者だけに一般化したエラーを表示 |
| ボタンが重複して押された | 各Xを独立処理する。通知は重複し、先の自動解除が後のミュートを早めに解除する場合がある |
| 自動解除の内部呼び出しに失敗した | 一般化したエラーだけをWorkerログへ出力。管理者がDiscord標準UIで解除する |

## 開発者向けセットアップ

Cloudflare Workersへソースコードから直接デプロイする場合は、Node.js 22以上が必要です。

```bash
npm install
```

ランタイム変数はCloudflare DashboardまたはWranglerで設定します。`wrangler.toml` にBot Tokenなどの実値を書き込まないでください。秘密情報をWranglerで登録する場合は次を実行します。

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npm run check
npm test
npm run deploy
```

表示された `workers.dev` のURLを、Discord Developer Portalの `Interactions Endpoint URL` に設定してください。接続確認時にコマンドが自動登録されます。カードの設置方法は「かんたんセットアップ」の手順5と同じです。

コマンドが長時間表示されない場合は、手動登録も利用できます。

```bash
DISCORD_APPLICATION_ID="..." \
DISCORD_GUILD_ID="..." \
DISCORD_BOT_TOKEN="..." \
npm run register
```

### 表示文言を変更する

Discordへ表示する文言は [`src/messages.ts`](src/messages.ts) に一元化しています。

- カードのタイトル・説明
- ボタン名
- タイムの理由カテゴリ
- 成功・失敗メッセージ
- 権限とロールの警告
- Discord APIエラーの案内
- `/xcard-setup` の説明

タイムの理由は同ファイルの `TIME_REASONS` を編集します。

- `label`: Discordに表示・投稿する文言
- `value`: Bot内部で使う重複しない英数字
- 最大25項目

処理時間など、動作に関する設定は [`src/config.ts`](src/config.ts) に分離しています。

- `X_CARD_DELAY_MIN_MS`: 最短待機時間（初期値5秒）
- `X_CARD_DELAY_MAX_MS`: 最長待機時間（初期値10秒）

自動解除はCloudflareの環境変数 `X_CARD_AUTO_UNMUTE_SECONDS` で変更します。コードの再ビルドは不要です。

`main`へ反映すると、接続済みのCloudflare Workers Buildsが変更を自動デプロイします。GitHub Actionsは型チェック、テスト、デプロイ可能性の検証だけを行います。

### ローカル開発

Git管理対象外の `.dev.vars` を作成します。

```dotenv
DISCORD_APPLICATION_ID=...
DISCORD_PUBLIC_KEY=...
DISCORD_BOT_TOKEN=...
MAX_VC_MEMBERS=40
X_CARD_AUTO_UNMUTE_SECONDS=5
```

```bash
npm run dev
```

## ライセンス

[MIT License](LICENSE)
