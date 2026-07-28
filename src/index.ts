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
  BotReadinessReason,
  DiscordInteraction,
  Env,
  MuteResult,
} from "./types";

const INTERACTION_PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

function readinessWarning(reason: BotReadinessReason): string {
  if (reason === "missing_mute_permission") {
    return "⚠️ Xカードを有効化できません。Botのロールへ「メンバーをミュート」権限を付与してください。設定後に `/xcard-setup` をもう一度実行してください。";
  }
  if (reason === "role_too_low") {
    return "⚠️ Xカードを有効化できません。Botのロールを、参加者へ割り当てるすべてのロールより上へ移動してください。設定後に `/xcard-setup` をもう一度実行してください。";
  }
  return "⚠️ Botの権限とロール位置を確認できなかったため、Xカードを実行しませんでした。管理者はBot設定を確認してください。";
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

function privateLog(
  guildId: string,
  channelId: string,
  result: MuteResult,
): Record<string, unknown> {
  return {
    embeds: [
      {
        title: "Xカード発動ログ",
        color: result.failed === 0 ? 0x57f287 : 0xfee75c,
        fields: [
          { name: "サーバー", value: guildId, inline: false },
          { name: "対象VC", value: `<#${channelId}>`, inline: true },
          { name: "参加人数", value: String(result.attempted), inline: true },
          { name: "成功", value: String(result.succeeded), inline: true },
          { name: "失敗", value: String(result.failed), inline: true },
        ],
        footer: {
          text: "発動者のID・名前は保存していません",
        },
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
  const muteAfter = Date.now() + randomXCardDelayMs();
  const guildId = interaction.guild_id;
  const publicChannelId = interaction.channel_id;
  const actorId = interaction.member?.user.id;

  if (!guildId || !publicChannelId || !actorId) {
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
      const warning = readinessWarning(readiness.reason);
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
      await editDeferredResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        "VCに参加している状態で押してください。",
      );
      return;
    }

    const limit = maxVcMembers(env);
    if (snapshot.memberIds.length > limit) {
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

    await Promise.all([
      sendChannelMessage(
        env.DISCORD_BOT_TOKEN,
        publicChannelId,
        publicNotification(snapshot.channelId, result, autoUnmuteAfter),
      ),
      sendChannelMessage(
        env.DISCORD_BOT_TOKEN,
        env.LOG_CHANNEL_ID,
        privateLog(guildId, snapshot.channelId, result),
      ),
    ]);

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
      );
    }
  } catch {
    // Never include interaction data or the actor ID in runtime logs.
    console.error("X-card activation failed");
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
  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  if (!guildId || !channelId) {
    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      "このコマンドはサーバー内でのみ使用できます。",
    );
    return;
  }

  const readiness = await checkBotReadiness(env.DISCORD_BOT_TOKEN, guildId);
  if (!readiness.ready) {
    await Promise.all([
      sendChannelMessage(env.DISCORD_BOT_TOKEN, channelId, {
        content: readinessWarning(readiness.reason),
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

  const sent = await sendChannelMessage(
    env.DISCORD_BOT_TOKEN,
    channelId,
    safetyCardPayload(),
  );
  await editDeferredResponse(
    env.DISCORD_APPLICATION_ID,
    interaction.token,
    sent
      ? "セーフティカードを設置しました。"
      : "カードを設置できませんでした。Botの送信権限を確認してください。",
  );
}

async function scheduleAutoUnmute(
  workerOrigin: string,
  env: Env,
  guildId: string,
  memberIds: string[],
  delaySeconds: number,
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

  if (!response.ok) {
    console.error("Automatic unmute dispatch failed");
  }
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
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 20_000) {
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
        if (result.failed > 0) {
          console.error("Automatic unmute partially failed");
        }
      })
      .catch(() => {
        console.error("Automatic unmute failed");
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

  const sent = await sendChannelMessage(env.DISCORD_BOT_TOKEN, channelId, {
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

  if (!sent) {
    console.error("Time post failed");
  }
  await editDeferredResponse(
    env.DISCORD_APPLICATION_ID,
    interaction.token,
    sent
      ? "タイムを匿名で投稿しました。あなたの名前は記録されていません。"
      : "タイムの投稿に失敗しました。管理者に連絡してください。",
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
          if (!registered) console.error("Setup command registration failed");
        })
        .catch(() => {
          console.error("Setup command registration failed");
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
