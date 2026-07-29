import type {
  BotReadinessProblem,
  SendMessageResult,
} from "./types";

/**
 * Discordに表示する文言はこのファイルで一元管理します。
 * 処理ロジックで使うID、ログイベント名、Discord監査ログ理由は対象外です。
 */
export const TIME_REASONS = [
  { label: "話題を変えたい", value: "change_topic" },
  { label: "一言だけ挟みたい（退席・連絡など）", value: "brief_interruption" },
  { label: "ペースを落としてほしい", value: "slow_down" },
  { label: "他の人に振ってほしい", value: "pass_to_others" },
  { label: "時間を気にしてほしい", value: "watch_time" },
  { label: "言い方を柔らかくしてほしい", value: "soften_wording" },
  { label: "理由は言わない", value: "no_reason" },
] as const;

export const READINESS_MESSAGES: Record<BotReadinessProblem, string> = {
  missing_mute_permission:
    "Botロールに「メンバーをミュート」権限がありません。",
  role_too_low:
    "Botロールが参加者へ割り当て可能なロール以下にあります。Botロールをすべての参加者用ロールより上へ移動してください。",
  bot_user_fetch_failed:
    "Bot TokenでBot情報を取得できません。Tokenが正しく、失効していないか確認してください。",
  roles_fetch_failed:
    "サーバーのロール一覧を取得できません。Botがこのサーバーへ追加されているか確認してください。",
  bot_member_fetch_failed:
    "サーバー内のBotメンバー情報を取得できません。アプリを「サーバーへ追加（Guild Install）」し直してください。",
  invalid_discord_response:
    "Discordから受け取ったBotまたはロール情報の形式が不正でした。時間を置いて再実行してください。",
  discord_api_unreachable:
    "Discord APIへ接続できませんでした。時間を置いて再実行してください。",
};

export const MESSAGES = {
  setupCommandDescription:
    "このチャンネルに匿名セーフティカードを設置します",

  timeReasonPrompt:
    "匿名で通告する理由カテゴリを1つ選んでください。",
  timeReasonPlaceholder: "理由カテゴリを選択",
  safetyCardTitle: "セーフティカード",
  safetyCardDescription:
    "**⏱ タイム**: 理由カテゴリを選び、匿名で通告します。\n\n**✕ Xカード**: 会話を止める必要があるときに使用します。押した時点で参加しているVCの全員がサーバーミュートされます。\n\nどちらも押した人の名前は表示・保存されません。",
  timeButtonLabel: "タイム",
  xCardButtonLabel: "Xカード",

  buttonServerOnly: "このボタンはサーバー内でのみ使用できます。",
  commandServerOnly: "このコマンドはサーバー内でのみ使用できます。",
  xCardReadinessRejected:
    "Botの権限またはロール位置が要件を満たしていないため、Xカードを実行しませんでした。",
  setupReadinessRejected:
    "Botの設定が要件を満たしていないため、カードを設置しませんでした。",
  actorNotInVoice: "VCに参加している状態で押してください。",
  voiceLookupFailed:
    "参加中のVCを確認できませんでした。時間を置いて再実行してください。",
  memberLimitExceeded: (limit: number) =>
    `このVCの参加者数が安全上限（${limit}名）を超えています。管理者に連絡してください。`,
  xCardFailed:
    "Xカードの処理に失敗しました。管理者に連絡してください。",
  setupSucceeded: "セーフティカードを設置しました。",
  setupSettingsInvalid:
    "設定値が不正です。ランダム遅延は0〜20秒で、最短を最長以下にしてください。自動解除は0〜10秒です。",
  cardSettingsField: "カード設定",
  cardSettingsSummary: (
    autoUnmuteSeconds: number,
    delayMinSeconds: number,
    delayMaxSeconds: number,
  ) =>
    `自動解除: ${autoUnmuteSeconds === 0 ? "なし" : `${autoUnmuteSeconds}秒`} / ランダム遅延: ${delayMinSeconds}〜${delayMaxSeconds}秒`,
  setupFailed: (detail: string) =>
    `カードを設置できませんでした。\n${detail}`,
  timePostSucceeded:
    "タイムを匿名で投稿しました。あなたの名前は記録されていません。",
  timePostFailed: (detail: string) =>
    `タイムの投稿に失敗しました。\n${detail}`,
  manageGuildRequired:
    "この操作には「サーバー管理」権限が必要です。",
  chooseReasonAgain: "理由カテゴリを選び直してください。",
  unsupportedInteraction: "未対応の操作です。",

  xCardPublicTitle: "Xカードが使用されました",
  targetVoiceField: "対象VC",
  muteField: "ミュート",
  muteCount: (succeeded: number, attempted: number) =>
    `${succeeded}/${attempted}名`,
  manualUnmuteNotice:
    "必要な確認が終わったら、Discordの標準操作でサーバーミュートを解除してください。",
  automaticUnmuteNotice: (seconds: number) =>
    `約${seconds}秒後にBotが自動解除します。`,
  xCardPublicDescription: (
    failed: number,
    releaseNotice: string,
  ) =>
    failed === 0
      ? `このVCでXカードが使用されました。${releaseNotice}`
      : `このVCでXカードが使用されました。${failed}名のミュートに失敗しました。${releaseNotice}`,
  xCardActorResult: (
    succeeded: number,
    failed: number,
    autoUnmuteSeconds: number,
  ) => {
    const release =
      autoUnmuteSeconds === 0
        ? "自動解除は無効です。"
        : failed === 0
          ? `約${autoUnmuteSeconds}秒後に自動解除します。`
          : `成功したメンバーは約${autoUnmuteSeconds}秒後に自動解除します。`;
    return failed === 0
      ? `${succeeded}名をサーバーミュートしました。${release}あなたの名前は記録されていません。`
      : `${succeeded}名をミュートしましたが、${failed}名に失敗しました。${release}あなたの名前は記録されていません。`;
  },

  readinessWarning: (problems: BotReadinessProblem[]) => {
    const details = problems
      .map((problem) => `• ${READINESS_MESSAGES[problem]}`)
      .join("\n");
    return `⚠️ Xカードの要件を満たしていないため実行できません。\n${details}\n設定後に \`/xcard-setup\` をもう一度実行してください。`;
  },

  messageSendFailure: (result: SendMessageResult) => {
    const reference = `HTTP ${result.status}${result.code === undefined ? "" : ` / Discord code ${result.code}`}`;
    if (result.status === 401) {
      return `Bot Tokenが無効または失効しています。Cloudflareの DISCORD_BOT_TOKEN を再設定してください。（${reference}）`;
    }
    if (result.code === 10003 || result.status === 404) {
      return `対象チャンネルが削除されているか、Botから見えません。対象チャンネルで「チャンネルを見る」を許可してください。（${reference}）`;
    }
    if (result.code === 50001) {
      return `Botが対象チャンネルへアクセスできません。カテゴリとチャンネルの権限上書きで「チャンネルを見る」を許可してください。（${reference}）`;
    }
    if (result.code === 50013 || result.status === 403) {
      return `対象チャンネルでBotに必要な権限がありません。「チャンネルを見る」「メッセージを送信」「埋め込みリンク」を許可してください。スレッドでは「スレッドでメッセージを送信」も必要です。（${reference}）`;
    }
    if (result.status === 429) {
      return `Discord APIのレート制限に達しました。少し待ってから再実行してください。（${reference}）`;
    }
    if (result.code === 50035 || result.status === 400) {
      const field = result.errorPath
        ? ` 不正と判定された項目: ${result.errorPath}。`
        : "";
      return `Botが送信したカードデータをDiscordが受理しませんでした。${field}Botのバージョンを確認してください。（${reference}）`;
    }
    if (result.status >= 500) {
      return `Discord APIで一時障害が発生しています。時間を置いて再実行してください。（${reference}）`;
    }
    return `Discordへの投稿に失敗しました。Cloudflare Workers Logsで setup_completed を確認してください。（${reference}）`;
  },
} as const;
