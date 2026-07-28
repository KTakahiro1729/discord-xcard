# Discord匿名セーフティカード

Cloudflare Workers上で動作する、知人Discordサーバー向けの匿名イエローカード／Xカードです。

## 動作

### △ イエローカード

押すと、そのチャンネルへBot名義の匿名注意メッセージを投稿します。VC確認、ミュート、非公開ログは行いません。

### ✕ Xカード

1. 専用チャンネルの「Xカード」を押す
2. WorkerがDiscord Gatewayへ一時接続する
3. 押した人が参加しているVCを特定する
4. そのVCにいる全員をサーバーミュートする
5. 公開チャンネルと非公開ログチャンネルへBot名義で通知する
6. Gateway接続を終了する

どちらのカードも発動者のID・名前は保存も出力もしません。Xカードの解除はDiscord標準UIで行います。

## 前提

- Cloudflareアカウント
- Discordサーバーの管理権限
- Discord Botに以下の権限
  - チャンネルを見る
  - メッセージを送信
  - 埋め込みリンク
  - メンバーをミュート
  - メッセージ履歴を読む

Botロールを、ミュート対象になる通常ロールより上に配置してください。

## かんたんセットアップ

普段IT作業をしない人向けの手順です。コマンド入力やプログラムの編集は不要で、同梱のZIPをCloudflareへアップロードして5項目を設定します。

### 1. Discordアプリを作成

1. Discord Developer PortalでApplicationを作成
2. BotページでBotを作成
3. General Informationから以下を控える
   - Application ID
   - Public Key
4. BotページからTokenを発行
5. OAuth2 URL Generatorで `bot` と `applications.commands` を選択
6. 上記の必要権限を選び、Botをサーバーへ追加

`GUILD_VOICE_STATES` は非特権Intentなので、Developer Portalで特別な有効化は不要です。

### 2. ログチャンネルを作成

`#x-card-log` などのテキストチャンネルを作り、通常メンバーの「チャンネルを見る」を拒否します。Botと管理者には閲覧・送信を許可します。

チャンネルIDをコピーしてください。Discordで開発者モードを有効にすると、右クリックからIDをコピーできます。

### 3. CloudflareへZIPをアップロード

1. [`discord-x-card-pages.zip` をダウンロード](https://github.com/KTakahiro1729/discord-xcard/releases/download/easy-install/discord-x-card-pages.zip)する
2. [Cloudflare Dashboard](https://dash.cloudflare.com/) を開く
3. `Workers & Pages` → `Create application` → `Pages` → `Upload assets` を選ぶ
4. プロジェクト名（例: `discord-x-card`）を入力する
5. ダウンロードしたZIPをそのままアップロードして、`Deploy site` を押す

このZIPには、Pagesの高度なモードで動く `_worker.js` が入っています。展開や編集は不要です。

配布ZIPはGitHub Actionsが `main` の更新ごとにテスト・再生成します。ソースコードから手作業で作る必要はありません。

### 4. Cloudflareの設定画面へ5項目を入力

作成したPagesプロジェクトで `Settings` → `Variables and Secrets` を開き、Production環境へ次の項目を追加します。

| 名前 | 種類 | 入力する値 |
|---|---|---|
| `DISCORD_APPLICATION_ID` | Text | DiscordのApplication ID |
| `LOG_CHANNEL_ID` | Text | 手順2で作ったログチャンネルのID |
| `MAX_VC_MEMBERS` | Text | `40` |
| `DISCORD_PUBLIC_KEY` | Secret | DiscordのPublic Key |
| `DISCORD_BOT_TOKEN` | Secret | DiscordのBot Token |

Public KeyとBot Tokenは第三者へ送らず、READMEやチャットにも貼らないでください。項目を保存した後、`Deployments` から同じZIPを再度アップロードして設定を反映します。

### 5. Discordへ接続し、コマンドを自動登録

1. Cloudflareの `Deployments` に表示されたURLを開き、`Discord X-card Worker is running.` と表示されることを確認する
2. URLをコピーする（例: `https://discord-x-card.pages.dev/`）
3. Discord Developer PortalのApplicationを開く
4. `General Information` → `Interactions Endpoint URL` へURLを貼り、保存する

保存時にDiscordから送られる接続確認を受けると、Workerが `/xcard-setup` を自動登録します。Node.jsやコマンド入力は不要です。Discordへ表示されるまで数分かかる場合があります。

### 6. スラッシュコマンドでボタンを設置

DiscordのXカード専用チャンネルで、管理者が次を実行します。

```text
/xcard-setup
```

投稿された△と✕のボタンを押して動作を確認します。テスト時は、解除できる人がVCにいる状態で行ってください。

## 開発者向け: Workersへ直接デプロイ

Node.js 22以上が必要です。

```bash
npm install
```

`wrangler.toml` の `DISCORD_APPLICATION_ID` と `LOG_CHANNEL_ID` を実値へ変更し、秘密情報を登録します。

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npm run check
npm test
npm run deploy
```

表示された `workers.dev` のURLを、Discord Developer Portalの `Interactions Endpoint URL` に設定してください。コマンドは接続確認時に自動登録され、カード設置は上の手順6と同じです。

自動登録されたコマンドが長時間表示されない場合は、開発者向けの手動登録も利用できます。

```bash
DISCORD_APPLICATION_ID="..." \
DISCORD_GUILD_ID="..." \
DISCORD_BOT_TOKEN="..." \
npm run register
```

## 匿名性

保証する範囲:

- 公開投稿に発動者を表示しない
- 非公開ログにも発動者を保存しない
- WorkerのアプリログへInteraction本文を出さない
- Discord監査ログ上の操作主体はBotになる

保証できない範囲:

- Discord社に対する匿名性
- 発動時刻とVC参加者からの推測
- Cloudflareの実行中メモリに対する完全な不可視性

## 無料枠上の制限

`MAX_VC_MEMBERS` の初期値は40です。1回の発動でDiscord REST APIを参加人数分呼ぶため、Workers無料枠の1 Invocationあたりのサブリクエスト上限に余裕を残しています。

知人サーバーでは通常この上限で十分です。45より大きな値はコード側で45に制限されます。

## 障害時

- VCにいない: 押した本人だけにエラーを表示
- Bot権限不足: 公開通知と管理ログに失敗件数を表示
- Gateway取得失敗: 押した本人だけに一般化したエラーを表示
- 重複押下: ミュートは同じ値への更新なので安全。通知が重複する可能性はある

## ローカル開発

`.dev.vars` を作成します。このファイルはGit対象外です。

```dotenv
DISCORD_APPLICATION_ID=...
DISCORD_PUBLIC_KEY=...
DISCORD_BOT_TOKEN=...
LOG_CHANNEL_ID=...
MAX_VC_MEMBERS=40
```

```bash
npm run dev
```
