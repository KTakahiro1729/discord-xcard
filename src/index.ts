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
import {
  randomXCardDelayMs,
  settingsFromXCardCustomId,
  xCardCustomId,
  xCardSettings,
} from "./config";
import { newEventId, writeLog } from "./logging";
import { MESSAGES } from "./messages";
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
  DiscordInteraction,
  Env,
  MuteResult,
} from "./types";

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

function commandOption(
  interaction: DiscordInteraction,
  name: string,
): string | number | boolean | undefined {
  return interaction.data?.options?.find((option) => option.name === name)?.value;
}

export function participantMentionPayload(
  memberIds: string[],
): { content: string; allowed_mentions: Record<string, unknown> } {
  return {
    content: memberIds.map((memberId) => `<@${memberId}>`).join(" "),
    allowed_mentions: { parse: [], users: memberIds },
  };
}

function publicNotification(
  channelId: string,
  memberIds: string[],
  result: MuteResult,
  autoUnmuteAfter: number,
): Record<string, unknown> {
  const releaseNotice =
    autoUnmuteAfter === 0
      ? MESSAGES.manualUnmuteNotice
      : MESSAGES.automaticUnmuteNotice(autoUnmuteAfter);
  const description = MESSAGES.xCardPublicDescription(
    result.failed,
    releaseNotice,
  );

  return {
    ...participantMentionPayload(memberIds),
    embeds: [
      {
        title: MESSAGES.xCardPublicTitle,
        description,
        color: 0xd83c3e,
        fields: [
          { name: MESSAGES.targetVoiceField, value: `<#${channelId}>`, inline: true },
          {
            name: MESSAGES.muteField,
            value: MESSAGES.muteCount(result.succeeded, result.attempted),
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function activateXCard(
  env: Env,
  interaction: DiscordInteraction,
  workerOrigin: string,
): Promise<void> {
  const eventId = newEventId();
  const startedAt = Date.now();
  const settings = settingsFromXCardCustomId(
    interaction.data?.custom_id ?? "xcard:activate",
    env.X_CARD_AUTO_UNMUTE_SECONDS,
  );
  const muteAfter =
    startedAt +
    randomXCardDelayMs(
      Math.random,
      settings.delayMinSeconds * 1000,
      settings.delayMaxSeconds * 1000,
    );
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
      MESSAGES.buttonServerOnly,
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
      const warning = MESSAGES.readinessWarning(readiness.problems);
      await Promise.all([
        sendChannelMessage(env.DISCORD_BOT_TOKEN, publicChannelId, {
          content: warning,
          allowed_mentions: { parse: [] },
        }),
        editDeferredResponse(
          env.DISCORD_APPLICATION_ID,
          interaction.token,
          MESSAGES.xCardReadinessRejected,
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
        MESSAGES.actorNotInVoice,
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
        MESSAGES.memberLimitExceeded(limit),
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
    const autoUnmuteAfter = settings.autoUnmuteSeconds;

    const publicNoticeResult = await sendChannelMessage(
      env.DISCORD_BOT_TOKEN,
      snapshot.channelId,
      publicNotification(
        snapshot.channelId,
        snapshot.memberIds,
        result,
        autoUnmuteAfter,
      ),
    );

    writeLog(result.failed === 0 && publicNoticeResult.ok ? "info" : "warn", "xcard_mute_completed", {
      event_id: eventId,
      attempted: result.attempted,
      succeeded: result.succeeded,
      failed: result.failed,
      public_notice_sent: publicNoticeResult.ok,
      public_notice_status: publicNoticeResult.status,
      public_notice_code: publicNoticeResult.code ?? null,
      public_notice_error_path: publicNoticeResult.errorPath ?? null,
      auto_unmute_seconds: autoUnmuteAfter,
      duration_ms: Date.now() - startedAt,
    });

    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      MESSAGES.xCardActorResult(
        result.succeeded,
        result.failed,
        autoUnmuteAfter,
      ),
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
      MESSAGES.xCardFailed,
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
      MESSAGES.commandServerOnly,
    );
    return;
  }

  const autoOption = commandOption(interaction, "auto_unmute_seconds");
  const delayMinOption = commandOption(interaction, "delay_min_seconds");
  const delayMaxOption = commandOption(interaction, "delay_max_seconds");
  const timeLabelOption = commandOption(interaction, "time_button_label");
  const xCardLabelOption = commandOption(interaction, "xcard_button_label");
  const settings = xCardSettings(
    env.X_CARD_AUTO_UNMUTE_SECONDS,
    typeof autoOption === "number" ? autoOption : undefined,
    typeof delayMinOption === "number" ? delayMinOption : undefined,
    typeof delayMaxOption === "number" ? delayMaxOption : undefined,
  );
  const timeButtonLabel =
    typeof timeLabelOption === "string"
      ? timeLabelOption.trim()
      : MESSAGES.timeButtonLabel;
  const xCardButtonLabel =
    typeof xCardLabelOption === "string"
      ? xCardLabelOption.trim()
      : MESSAGES.xCardButtonLabel;

  if (
    !settings ||
    timeButtonLabel.length < 1 ||
    timeButtonLabel.length > 80 ||
    xCardButtonLabel.length < 1 ||
    xCardButtonLabel.length > 80
  ) {
    writeLog("warn", "setup_rejected", {
      event_id: eventId,
      reason: "invalid_settings",
    });
    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      MESSAGES.setupSettingsInvalid,
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
        content: MESSAGES.readinessWarning(readiness.problems),
        allowed_mentions: { parse: [] },
      }),
      editDeferredResponse(
        env.DISCORD_APPLICATION_ID,
        interaction.token,
        MESSAGES.setupReadinessRejected,
      ),
    ]);
    return;
  }

  const sendResult = await sendChannelMessage(
    env.DISCORD_BOT_TOKEN,
    channelId,
    safetyCardPayload({
      xCardCustomId: xCardCustomId(settings),
      timeButtonLabel,
      xCardButtonLabel,
      settingsSummary: MESSAGES.cardSettingsSummary(
        settings.autoUnmuteSeconds,
        settings.delayMinSeconds,
        settings.delayMaxSeconds,
      ),
    }),
  );
  writeLog(sendResult.ok ? "info" : "warn", "setup_completed", {
    event_id: eventId,
    card_sent: sendResult.ok,
    response_status: sendResult.status,
    discord_code: sendResult.code ?? null,
    error_path: sendResult.errorPath ?? null,
  });
  await editDeferredResponse(
    env.DISCORD_APPLICATION_ID,
    interaction.token,
    sendResult.ok
      ? MESSAGES.setupSucceeded
      : MESSAGES.setupFailed(MESSAGES.messageSendFailure(sendResult)),
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
  const eventId = newEventId();
  const guildId = interaction.guild_id;
  const actorId = interaction.member?.user.id;
  if (!guildId || !actorId) {
    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      MESSAGES.buttonServerOnly,
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
        MESSAGES.actorNotInVoice,
      );
      return;
    }

    const sendResult = await sendChannelMessage(
      env.DISCORD_BOT_TOKEN,
      snapshot.channelId,
      {
        embeds: [
          {
            title: MESSAGES.timeButtonLabel,
            description: reason,
            color: 0x95a5a6,
            timestamp: new Date().toISOString(),
          },
        ],
        allowed_mentions: { parse: [] },
      },
    );

    writeLog(sendResult.ok ? "info" : "warn", "time_post_completed", {
      event_id: eventId,
      posted: sendResult.ok,
      participant_count: snapshot.memberIds.length,
      destination: "voice_channel",
      response_status: sendResult.status,
      discord_code: sendResult.code ?? null,
      error_path: sendResult.errorPath ?? null,
    });
    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      sendResult.ok
        ? MESSAGES.timePostSucceeded
        : MESSAGES.timePostFailed(MESSAGES.messageSendFailure(sendResult)),
    );
  } catch {
    writeLog("error", "time_post_failed", {
      event_id: eventId,
      stage: "voice_snapshot_or_send",
    });
    await editDeferredResponse(
      env.DISCORD_APPLICATION_ID,
      interaction.token,
      MESSAGES.voiceLookupFailed,
    );
  }
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
      return ephemeralMessage(MESSAGES.manageGuildRequired);
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
      return ephemeralMessage(MESSAGES.chooseReasonAgain);
    }
    context.waitUntil(postTime(env, interaction, reason));
    return deferredEphemeral();
  }

  if (
    interaction.type === MESSAGE_COMPONENT &&
    interaction.data?.custom_id?.startsWith("xcard:activate")
  ) {
    context.waitUntil(activateXCard(env, interaction, workerOrigin));
    return deferredEphemeral();
  }

  return ephemeralMessage(MESSAGES.unsupportedInteraction);
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
