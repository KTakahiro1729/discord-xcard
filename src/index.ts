import {
  editDeferredResponse,
  fetchVoiceSnapshot,
  maxVcMembers,
  muteMembers,
  registerSetupCommand,
  sendChannelMessage,
} from "./discord";
import { randomXCardDelayMs } from "./config";
import {
  deferredEphemeral,
  ephemeralMessage,
  jsonResponse,
  safetyCardMessage,
  timeReasonLabel,
  timeReasonMenu,
} from "./responses";
import { verifyDiscordRequest } from "./security";
import type { DiscordInteraction, Env, MuteResult } from "./types";

const INTERACTION_PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

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
): Record<string, unknown> {
  const description =
    result.failed === 0
      ? "このVCでXカードが使用されました。必要な確認が終わったら、Discordの標準操作でサーバーミュートを解除してください。"
      : `このVCでXカードが使用されました。${result.failed}名のミュートに失敗したため、権限設定を確認してください。`;

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
      snapshot.memberIds,
    );

    await Promise.all([
      sendChannelMessage(
        env.DISCORD_BOT_TOKEN,
        publicChannelId,
        publicNotification(snapshot.channelId, result),
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
        ? `${result.succeeded}名をサーバーミュートしました。あなたの名前は記録されていません。`
        : `${result.succeeded}名をミュートしましたが、${result.failed}名に失敗しました。あなたの名前は記録されていません。`,
    );
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
    return jsonResponse(safetyCardMessage());
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
    context.waitUntil(activateXCard(env, interaction));
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
    if (request.method === "GET") {
      return new Response("Discord X-card Worker is running.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
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

    return handleInteraction(interaction, env, context);
  },
} satisfies ExportedHandler<Env>;
