import {
  checkBotReadiness,
  editDeferredResponse,
  fetchVoiceSnapshot,
  maxVcMembers,
  muteMembers,
  registerSetupCommand,
  sendChannelMessage,
  unmuteMembers,
} from "./discord";
import { autoUnmuteSeconds, randomXCardDelayMs } from "./config";
import { newEventId, writeLog } from "./logging";
import {
  deferredEphemeral,
  ephemeralMessage,
  jsonResponse,
  safetyCardPayload,
  timeReasonLabel,
  timeReasonMenu,
} from "./responses";
import {
  signInternalRequest,
  verifyDiscordRequest,
  verifyInternalRequest,
} from "./security";
import type {
  AutoUnmutePayload,
  BotReadiness,
  BotReadinessProblem,
  DiscordInteraction,
  Env,
  MuteResult,
  SendMessageResult,
} from "./types";

const INTERACTION_PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

const READINESS_MESSAGES: Record<BotReadinessProblem, string> = {
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

function readinessWarning(readiness: BotReadiness): string {
  const details = readiness.problems
    .map((problem) => `• ${READINESS_MESSAGES[problem]}`)
    .join("\n");
  return `⚠️ Xカードの要件を満たしていないため実行できません。\n${details}\n設定後に \`/xcard-setup\` をもう一度実行してください。`;
}

export function messageSendFailure(result: SendMessageResult): string {
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
    return `Botが送信したカードデータをDiscordが受理しませんでした。Botのバージョンを確認してください。（${reference}）`;
  }
  if (result.status >= 500) {
    return `Discord APIで一時障害が発生しています。時間を置いて再実行してください。（${reference}）`;
  }
  return `Discordへの投稿に失敗しました。Cloudflare Workers Logsで setup_completed を確認してください。（${reference}）`;
}

export function canSetUpCard(permissions?: string): boolean {
  if (!permissions) return false;
  try {
    const bits = BigInt(permissions);
    return (bits & (MANAGE_GUILD | ADMINISTRATOR)) !== 0n;
  } catch {
    return false;
  }
}

function publicNotification(
  channelId: string,
  result: MuteResult,
  autoUnmuteAfter: number,
): Record<string, unknown> {
  const releaseNotice =
    autoUnmuteAfter === 0
      ? "必要な確認が終わったら、Discordの標準操作でサーバーミュートを解除してください。"
      : `約${autoUnmuteAfter}秒後にBotが自動解除します。`;
  const description =
    result.failed === 0
      ? `このVCでXカードが使用されました。${releaseNotice}`
      : `このVCでXカードが使用されました。${result.failed}名のミュートに失敗しました。${releaseNotice}`;

  return {
    embeds: [
      {
        title: "Xカードが使用されました",
        description,
        color: 0xd83c3e,
        fields: [
          { name: "対象VC", value: `<#${channelId}>`, inline: true },
          {
            name: "ミュート",
            value: `${result.succeeded}/${result.attempted}名`,
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

async function activateXCard(
  env: Env,
  interaction: DiscordInteraction,
  workerOrigin: string,
): Promise<void> {
  const eventId = newEventId();
  const startedAt = Date.now();
  const muteAfter = startedAt + randomXCardDelayMs();
  const guildId = interaction.guild_id;
  const publicChannelId = interaction.channel_id;
  const actorId = interaction.member?.user.id;

  if (!guildId || !publicChannelId || !actorId) {
    writeLog("warn", "xcard_rejected", {
      event_id: eventId,
      reason: "invalid_context",
    });
    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "このボタンはサーバー内でのみ使用できます。",
    );
    return;
  }

  try {
    const readiness = await checkBotReadiness(
      env.DISCORD_BOT_TOKEN,
      guildId,
    );
    if (!readiness.ready) {
      writeLog("warn", "xcard_rejected", {
        event_id: eventId,
        problems: readiness.problems.join(","),
      });
      const warning = readinessWarning(readiness);
      await Promise.all([
        sendChannelMessage(env.DISCORD_BOT_TOKEN, publicChannelId, {
          content: warning,
          allowed_mentions: { parse: [] },
        }),
        editDeferredResponse(
          env.DISCORD_APPLICATION_ID,
          interaction.token,
          "Botの権限またはロール位置が要件を満たしていないため、Xカードを実行しませんでした。",
        ),
      ]);
      return;
    }

    const snapshot = await fetchVoiceSnapshot(
      env.DISCORD_BOT_TOKEN,
      guildId,
      actorId,
    );

    if (!snapshot) {
      writeLog("info", "xcard_rejected", {
        event_id: eventId,
        reason: "actor_not_in_voice",
      });
      await editDeferredResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        "VCに参加している状態で押してください。",
      );
      return;
    }

    const limit = maxVcMembers(env);
    if (snapshot.memberIds.length > limit) {
      writeLog("warn", "xcard_rejected", {
        event_id: eventId,
        reason: "member_limit_exceeded",
        participant_count: snapshot.memberIds.length,
        configured_limit: limit,
      });
      await editDeferredResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        `このVCの参加者数が安全上限（${limit}名）を超えています。管理者に連絡してください。`,
      );
      return;
    }

    const remainingDelay = muteAfter - Date.now();
    if (remainingDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    }

    const result = await muteMembers(
      env.DISCORD_BOT_TOKEN,
      guildId,
      snapshot.memberIdsToMute,
    );
    const autoUnmuteAfter = autoUnmuteSeconds(
      env.X_CARD_AUTO_UNMUTE_SECONDS,
    );

    const publicNoticeResult = await sendChannelMessage(
      env.DISCORD_BOT_TOKEN,
      publicChannelId,
      publicNotification(snapshot.channelId, result, autoUnmuteAfter),
    );

    writeLog(result.failed === 0 && publicNoticeResult.ok ? "info" : "warn", "xcard_mute_completed", {
      event_id: eventId,
      attempted: result.attempted,
      succeeded: result.succeeded,
      failed: result.failed,
      public_notice_sent: publicNoticeResult.ok,
      public_notice_status: publicNoticeResult.status,
      public_notice_code: publicNoticeResult.code ?? null,
      auto_unmute_seconds: autoUnmuteAfter,
      duration_ms: Date.now() - startedAt,
    });

    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      result.failed === 0
        ? `${result.succeeded}名をサーバーミュートしました。${autoUnmuteAfter === 0 ? "自動解除は無効です。" : `約${autoUnmuteAfter}秒後に自動解除します。`}あなたの名前は記録されていません。`
        : `${result.succeeded}名をミュートしましたが、${result.failed}名に失敗しました。${autoUnmuteAfter === 0 ? "自動解除は無効です。" : `成功したメンバーは約${autoUnmuteAfter}秒後に自動解除します。`}あなたの名前は記録されていません。`,
    );

    if (autoUnmuteAfter > 0 && result.succeededMemberIds.length > 0) {
      await scheduleAutoUnmute(
        workerOrigin,
        env,
        guildId,
        result.succeededMemberIds,
        autoUnmuteAfter,
        eventId,
      );
    }
  } catch {
    writeLog("error", "xcard_failed", {
      event_id: eventId,
      stage: "activation",
      duration_ms: Date.now() - startedAt,
    });
    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "Xカードの処理に失敗しました。管理者に連絡してください。",
    );
  }
}

async function setupSafetyCards(
  env: Env,
  interaction: DiscordInteraction,
): Promise<void> {
  const eventId = newEventId();
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  if (!guildId || !channelId) {
    writeLog("warn", "setup_rejected", {
      event_id: eventId,
      reason: "invalid_context",
    });
    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "このコマンドはサーバー内でのみ使用できます。",
    );
    return;
  }

  const readiness = await checkBotReadiness(env.DISCORD_BOT_TOKEN, guildId);
  if (!readiness.ready) {
    writeLog("warn", "setup_rejected", {
      event_id: eventId,
      problems: readiness.problems.join(","),
    });
    await Promise.all([
      sendChannelMessage(env.DISCORD_BOT_TOKEN, channelId, {
        content: readinessWarning(readiness),
        allowed_mentions: { parse: [] },
      }),
      editDeferredResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        "Botの設定が要件を満たしていないため、カードを設置しませんでした。",
      ),
    ]);
    return;
  }

  const sendResult = await sendChannelMessage(
    env.DISCORD_BOT_TOKEN,
    channelId,
    safetyCardPayload(),
  );
  writeLog(sendResult.ok ? "info" : "warn", "setup_completed", {
    event_id: eventId,
    card_sent: sendResult.ok,
    response_status: sendResult.status,
    discord_code: sendResult.code ?? null,
  });
  await editDeferredResponse(
    env.DISCORD_APPLICATION_ID,
    interaction.token,
    sendResult.ok
      ? "セーフティカードを設置しました。"
      : `カードを設置できませんでした。\n${messageSendFailure(sendResult)}`,
  );
}

async function scheduleAutoUnmute(
  workerOrigin: string,
  env: Env,
  guildId: string,
  memberIds: string[],
  delaySeconds: number,
  eventId: string,
): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, delaySeconds * 1000),
  );

  const payload: AutoUnmutePayload = {
    guildId,
    memberIds,
    issuedAt: Date.now(),
  };
  const body = JSON.stringify(payload);
  const signature = await signInternalRequest(
    body,
    env.DISCORD_BOT_TOKEN,
  );
  const response = await fetch(
    new URL("/internal/auto-unmute", workerOrigin),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-XCard-Signature": signature,
      },
      body,
    },
  );

  writeLog(response.ok ? "info" : "error", "auto_unmute_dispatched", {
    event_id: eventId,
    member_count: memberIds.length,
    delay_seconds: delaySeconds,
    response_status: response.status,
  });
  await response.body?.cancel();
}

function validAutoUnmutePayload(
  payload: unknown,
): payload is AutoUnmutePayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Partial<AutoUnmutePayload>;
  return (
    typeof value.guildId === "string" &&
    /^\d{1,20}$/.test(value.guildId) &&
    Array.isArray(value.memberIds) &&
    value.memberIds.length <= 45 &&
    value.memberIds.every(
      (memberId) =>
        typeof memberId === "string" && /^\d{1,20}$/.test(memberId),
    ) &&
    typeof value.issuedAt === "number" &&
    Math.abs(Date.now() - value.issuedAt) <= 60_000
  );
}

async function handleAutoUnmute(
  request: Request,
  env: Env,
  context: ExecutionContext,
): Promise<Response> {
  const eventId = newEventId();
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 20_000) {
    writeLog("warn", "internal_request_rejected", {
      event_id: eventId,
      reason: "payload_too_large",
    });
    return new Response("Payload Too Large", { status: 413 });
  }

  const body = await request.text();
  if (body.length > 20_000) {
    return new Response("Payload Too Large", { status: 413 });
  }

  const validSignature = await verifyInternalRequest(
    body,
    request.headers.get("X-XCard-Signature"),
    env.DISCORD_BOT_TOKEN,
  );
  if (!validSignature) {
    writeLog("warn", "internal_request_rejected", {
      event_id: eventId,
      reason: "invalid_signature",
    });
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!validAutoUnmutePayload(payload)) {
    return new Response("Invalid payload", { status: 400 });
  }

  context.waitUntil(
    unmuteMembers(
      env.DISCORD_BOT_TOKEN,
      payload.guildId,
      payload.memberIds,
    )
      .then((result) => {
        writeLog(result.failed === 0 ? "info" : "warn", "auto_unmute_completed", {
          event_id: eventId,
          attempted: result.attempted,
          succeeded: result.succeeded,
          failed: result.failed,
        });
      })
      .catch(() => {
        writeLog("error", "auto_unmute_failed", {
          event_id: eventId,
          stage: "discord_api",
        });
      }),
  );
  return new Response(null, { status: 202 });
}

async function postTime(
  env: Env,
  interaction: DiscordInteraction,
  reason: string,
): Promise<void> {
  const channelId = interaction.channel_id;
  if (!channelId) {
    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "このボタンはサーバー内でのみ使用できます。",
    );
    return;
  }

  const sendResult = await sendChannelMessage(env.DISCORD_BOT_TOKEN, channelId, {
    embeds: [
      {
        title: "⏱ タイム",
        description: reason,
        color: 0xfee75c,
        timestamp: new Date().toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  });

  writeLog(sendResult.ok ? "info" : "warn", "time_post_completed", {
    event_id: newEventId(),
    posted: sendResult.ok,
    response_status: sendResult.status,
    discord_code: sendResult.code ?? null,
  });
  await editDeferredResponse(
    env.DISCORD_APPLICATION_ID,
    interaction.token,
    sendResult.ok
      ? "タイムを匿名で投稿しました。あなたの名前は記録されていません。"
      : `タイムの投稿に失敗しました。\n${messageSendFailure(sendResult)}`,
  );
}

async function handleInteraction(
  interaction: DiscordInteraction,
  env: Env,
  context: ExecutionContext,
  workerOrigin: string,
): Promise<Response> {
  if (interaction.type === INTERACTION_PING) {
    context.waitUntil(
      registerSetupCommand(env)
        .then((registered) => {
          writeLog(registered ? "info" : "warn", "command_registration_completed", {
            registered,
          });
        })
        .catch(() => {
          writeLog("error", "command_registration_failed");
        }),
    );
    return jsonResponse({ type: 1 });
  }

  if (
    interaction.type === APPLICATION_COMMAND &&
    interaction.data?.name === "xcard-setup"
  ) {
    if (!canSetUpCard(interaction.member?.permissions)) {
      return ephemeralMessage("この操作には「サーバー管理」権限が必要です。");
    }
    context.waitUntil(setupSafetyCards(env, interaction));
    return deferredEphemeral();
  }

  if (
    interaction.type === MESSAGE_COMPONENT &&
    (interaction.data?.custom_id === "time:choose" ||
      interaction.data?.custom_id === "yellowcard:post")
  ) {
    return timeReasonMenu();
  }

  if (
    interaction.type === MESSAGE_COMPONENT &&
    interaction.data?.custom_id === "time:reason"
  ) {
    const reason = timeReasonLabel(interaction.data.values?.[0]);
    if (!reason) {
      return ephemeralMessage("理由カテゴリを選び直してください。");
    }
    context.waitUntil(postTime(env, interaction, reason));
    return deferredEphemeral();
  }

  if (
    interaction.type === MESSAGE_COMPONENT &&
    interaction.data?.custom_id === "xcard:activate"
  ) {
    context.waitUntil(activateXCard(env, interaction, workerOrigin));
    return deferredEphemeral();
  }

  return ephemeralMessage("未対応の操作です。");
}

export default {
  async fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET") {
      return new Response("Discord X-card Worker is running.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (url.pathname === "/internal/auto-unmute") {
      return handleAutoUnmute(request, env, context);
    }

    const body = await request.text();
    const valid = await verifyDiscordRequest(
      request,
      body,
      env.DISCORD_PUBLIC_KEY,
    );
    if (!valid) {
      writeLog("warn", "request_rejected", {
        event_id: newEventId(),
        reason: "invalid_discord_signature",
      });
      return new Response("Invalid request signature", { status: 401 });
    }

    let interaction: DiscordInteraction;
    try {
      interaction = JSON.parse(body) as DiscordInteraction;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    return handleInteraction(interaction, env, context, url.origin);
  },
} satisfies ExportedHandler<Env>;
