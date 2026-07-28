# Discord 匿名セーフティカード

Discord のボイスチャットで使える、匿名のタイム／Xカードです。Cloudflare Workers または Cloudflare Pages 上で動作します。

- **⏱ タイム** — 選択した理由カテゴリだけを、匿名で知らせます
- **✕ Xカード** — 会話をすぐに止めたいとき、同じVCにいる全員をサーバーミュートします

どちらのカードも、発動者のIDや名前を保存・表示しません。身内や小規模なDiscordサーバーでの利用を想定しています。

> [!IMPORTANT]
> Xカードは、押した本人を含むVC参加者全員をサーバーミュートします。解除はDiscordの標準UIから手動で行います。テストするときは、ミュートを解除できる管理者がVCにいる状態で実行してください。

## 仕組み

### ⏱ タイム

ボタンを押すと、本人だけに理由カテゴリのセレクトメニューを表示します。選択後、ボタンが押されたチャンネルへBot名義でカテゴリだけを匿名投稿します。VCの確認、参加者のミュート、非公開ログへの記録は行いません。

選べるカテゴリ:

- 話題を変えたい
- 一言だけ挟みたい（退席・連絡など）
- ペースを落としてほしい
- 他の人に振ってほしい
- 時間を気にしてほしい
- 理由は言わない

### ✕ Xカード

1. 発動者が専用チャンネルの「Xカード」を押す
2. WorkerがDiscord Gatewayへ一時的に接続する
3. 発動者が参加しているVCを特定する
4. そのVCにいる全員をサーバーミュートする
5. 公開チャンネルと非公開ログチャンネルへ、Bot名義で結果を通知する
6. Gateway接続を終了する

## 導入に必要なもの

- Cloudflareアカウント
- Discordサーバーの管理権限
- 以下の権限を持つDiscord Bot
  - チャンネルを見る
  - メッセージを送信
  - 埋め込みリンク
  - メンバーをミュート
  - メッセージ履歴を読む

Botのロールは、ミュート対象となる通常メンバーのロールより上に配置してください。

## かんたんセットアップ

コマンド入力やプログラムの編集は必要ありません。配布ZIPをCloudflare Pagesへアップロードし、5つの設定値を入力します。

### 1. Discordアプリを作成する

1. [Discord Developer Portal](https://discord.com/developers/applications) でApplicationを作成する
2. `Bot` ページでBotを作成する
3. `General Information` で次の値を控える
   - Application ID
   - Public Key
4. `Bot` ページでTokenを発行する
5. `OAuth2` → `URL Generator` で `bot` と `applications.commands` を選ぶ
6. 「導入に必要なもの」に記載したBot権限を選び、Botをサーバーへ追加する

`GUILD_VOICE_STATES` は非特権Intentのため、Developer Portalで個別に有効化する必要はありません。

### 2. 非公開ログチャンネルを作成する

1. `#x-card-log` などのテキストチャンネルを作る
2. 通常メンバーの「チャンネルを見る」を拒否する
3. Botと管理者には閲覧と送信を許可する
4. チャンネルIDをコピーする

チャンネルIDは、Discordの開発者モードを有効にすると右クリックメニューからコピーできます。

### 3. Cloudflare Pagesへデプロイする

1. [`discord-x-card-pages.zip` をダウンロード](https://github.com/KTakahiro1729/discord-xcard/releases/download/easy-install/discord-x-card-pages.zip)する
2. [Cloudflare Dashboard](https://dash.cloudflare.com/) を開く
3. `Workers & Pages` → `Create application` → `Pages` → `Upload assets` を選ぶ
4. プロジェクト名（例: `discord-x-card`）を入力する
5. ZIPを展開せずにアップロードし、`Deploy site` を押す

配布ZIPには、Pagesの高度なモードで動作する `_worker.js` が含まれています。ZIPはGitHub Actionsによって `main` の更新ごとにテスト・再生成されるため、ソースコードから手作業でビルドする必要はありません。

### 4. 環境変数を設定する

作成したPagesプロジェクトで `Settings` → `Variables and Secrets` を開き、Production環境に次の5項目を追加します。

| 名前 | 種類 | 値 |
|---|---|---|
| `DISCORD_APPLICATION_ID` | Text | DiscordのApplication ID |
| `LOG_CHANNEL_ID` | Text | 手順2で作成したログチャンネルのID |
| `MAX_VC_MEMBERS` | Text | `40` |
| `DISCORD_PUBLIC_KEY` | Secret | DiscordのPublic Key |
| `DISCORD_BOT_TOKEN` | Secret | DiscordのBot Token |

> [!CAUTION]
> Public KeyとBot Tokenは第三者へ送らず、READMEやチャットにも貼らないでください。

保存後、`Deployments` から同じZIPをもう一度アップロードし、設定を反映します。

### 5. Discordと接続する

1. Cloudflareの `Deployments` に表示されたURLを開く
2. `Discord X-card Worker is running.` と表示されることを確認する
3. URL（例: `https://discord-x-card.pages.dev/`）をコピーする
4. Discord Developer Portalで対象のApplicationを開く
5. `General Information` → `Interactions Endpoint URL` にURLを貼り、保存する

Discordから送られる接続確認を受けると、Workerが `/xcard-setup` を自動登録します。Discordに表示されるまで数分かかることがあります。

### 6. カードを設置する

Xカード用のチャンネルで、サーバー管理権限を持つユーザーが次のコマンドを実行します。

```text
/xcard-setup
```

投稿された⏱と✕のボタンを押し、動作を確認してください。

## 匿名性について

このBotが保証する範囲:

- 公開メッセージに発動者を表示しない
- 非公開ログに発動者を保存しない
- WorkerのアプリケーションログにInteraction本文を出力しない
- Discordの監査ログでは、操作主体がBotとして記録される

保証できない範囲:

- Discord社に対する匿名性
- 発動時刻やVC参加者から発動者を推測される可能性
- Cloudflareの実行中メモリに対する完全な不可視性

## 制限事項

`MAX_VC_MEMBERS` の初期値は40です。Xカードは参加者1人につき1回Discord REST APIを呼び出すため、Cloudflare Workers無料枠のサブリクエスト上限に余裕を持たせています。

設定値を45より大きくしても、コード側で45に制限されます。

## エラー時の動作

| 状況 | 動作 |
|---|---|
| 発動者がVCにいない | 発動者だけにエラーを表示 |
| Botの権限が不足している | 公開通知と管理ログに失敗人数を表示 |
| GatewayからVC情報を取得できない | 発動者だけに一般化したエラーを表示 |
| ボタンが重複して押された | 同じミュート状態への更新を行う。通知は重複する可能性がある |

## 開発者向けセットアップ

Cloudflare Workersへソースコードから直接デプロイする場合は、Node.js 22以上が必要です。

```bash
npm install
```

`wrangler.toml` の `DISCORD_APPLICATION_ID` と `LOG_CHANNEL_ID` を実際の値へ変更し、秘密情報を登録します。

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npm run check
npm test
npm run deploy
```

表示された `workers.dev` のURLを、Discord Developer Portalの `Interactions Endpoint URL` に設定してください。接続確認時にコマンドが自動登録されます。カードの設置方法は「かんたんセットアップ」の手順6と同じです。

コマンドが長時間表示されない場合は、手動登録も利用できます。

```bash
DISCORD_APPLICATION_ID="..." \
DISCORD_GUILD_ID="..." \
DISCORD_BOT_TOKEN="..." \
npm run register
```

### ローカル開発

Git管理対象外の `.dev.vars` を作成します。

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

## ライセンス

[MIT License](LICENSE)
