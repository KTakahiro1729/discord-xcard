import type {
  Env,
  GatewayPayload,
  GuildCreateData,
  MuteResult,
  VoiceSnapshot,
  VoiceState,
} from "./types";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY =
  "wss://gateway.discord.gg/?v=10&encoding=json";
const GATEWAY_INTENTS = (1 << 0) | (1 << 7); // GUILDS | GUILD_VOICE_STATES
const GATEWAY_TIMEOUT_MS = 15_000;

export async function registerSetupCommand(env: Env): Promise<boolean> {
  const response = await discordApi(
    env.DISCORD_BOT_TOKEN,
    `/applications/${env.DISCORD_APPLICATION_ID}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "xcard-setup",
        description: "このチャンネルに匿名セーフティカードを設置します",
        type: 1,
        dm_permission: false,
        default_member_permissions: "32",
      }),
    },
  );

  const registered = response.ok;
  await response.body?.cancel();
  return registered;
}

export function snapshotForUser(
  voiceStates: VoiceState[],
  userId: string,
): VoiceSnapshot | null {
  const actorState = voiceStates.find(
    (state) => state.user_id === userId && state.channel_id !== null,
  );

  if (!actorState?.channel_id) {
    return null;
  }

  return {
    channelId: actorState.channel_id,
    memberIds: voiceStates
      .filter((state) => state.channel_id === actorState.channel_id)
      .map((state) => state.user_id),
  };
}

export async function fetchVoiceSnapshot(
  botToken: string,
  guildId: string,
  userId: string,
): Promise<VoiceSnapshot | null> {
  return new Promise((resolve, reject) => {
    const webSocket = new WebSocket(DISCORD_GATEWAY);
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let sequence: number | null = null;
    let settled = false;

    const finish = (
      error: Error | null,
      snapshot: VoiceSnapshot | null = null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
      try {
        webSocket.close(1000, "snapshot complete");
      } catch {
        // The socket may already be closed.
      }
      if (error) reject(error);
      else resolve(snapshot);
    };

    const timeoutTimer = setTimeout(() => {
      finish(new Error("Discord Gateway snapshot timed out"));
    }, GATEWAY_TIMEOUT_MS);

    webSocket.addEventListener("message", (event) => {
      void (async () => {
        try {
          const raw =
            typeof event.data === "string"
              ? event.data
              : await new Response(event.data).text();
          const payload = JSON.parse(raw) as GatewayPayload;

          if (typeof payload.s === "number") {
            sequence = payload.s;
          }

          if (payload.op === 10) {
            const hello = payload.d as { heartbeat_interval: number };
            const heartbeat = () => {
              webSocket.send(JSON.stringify({ op: 1, d: sequence }));
            };
            heartbeatTimer = setInterval(heartbeat, hello.heartbeat_interval);

            webSocket.send(
              JSON.stringify({
                op: 2,
                d: {
                  token: botToken,
                  intents: GATEWAY_INTENTS,
                  properties: {
                    os: "cloudflare-workers",
                    browser: "discord-x-card",
                    device: "discord-x-card",
                  },
                },
              }),
            );
            return;
          }

          if (payload.op === 1) {
            webSocket.send(JSON.stringify({ op: 1, d: sequence }));
            return;
          }

          if (payload.op === 9) {
            finish(new Error("Discord Gateway rejected the session"));
            return;
          }

          if (payload.op === 0 && payload.t === "GUILD_CREATE") {
            const guild = payload.d as GuildCreateData;
            if (guild.id !== guildId) return;
            finish(null, snapshotForUser(guild.voice_states ?? [], userId));
          }
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error("Invalid Discord Gateway payload"),
          );
        }
      })();
    });

    webSocket.addEventListener("error", () => {
      finish(new Error("Discord Gateway connection failed"));
    });

    webSocket.addEventListener("close", (event) => {
      if (!settled) {
        finish(
          new Error(`Discord Gateway closed unexpectedly (${event.code})`),
        );
      }
    });
  });
}

async function discordApi(
  token: string,
  path: string,
  init: RequestInit,
  retryCount = 0,
): Promise<Response> {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 429 && retryCount < 1) {
    const rateLimit = (await response.json()) as { retry_after?: number };
    const delayMs = Math.ceil((rateLimit.retry_after ?? 1) * 1000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return discordApi(token, path, init, retryCount + 1);
  }

  return response;
}

export async function muteMembers(
  token: string,
  guildId: string,
  memberIds: string[],
): Promise<MuteResult> {
  let succeeded = 0;
  let cursor = 0;
  const concurrency = Math.min(4, memberIds.length);

  const worker = async () => {
    while (cursor < memberIds.length) {
      const index = cursor++;
      const memberId = memberIds[index];
      if (!memberId) continue;

      const response = await discordApi(
        token,
        `/guilds/${guildId}/members/${memberId}`,
        {
          method: "PATCH",
          headers: {
            "X-Audit-Log-Reason": "X-card activated",
          },
          body: JSON.stringify({ mute: true }),
        },
      );

      if (response.ok) succeeded += 1;
      await response.body?.cancel();
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return {
    attempted: memberIds.length,
    succeeded,
    failed: memberIds.length - succeeded,
  };
}

export async function sendChannelMessage(
  token: string,
  channelId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const response = await discordApi(
    token,
    `/channels/${channelId}/messages`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  const ok = response.ok;
  await response.body?.cancel();
  return ok;
}

export async function editDeferredResponse(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
  await response.body?.cancel();
}

export function maxVcMembers(env: Env): number {
  const parsed = Number.parseInt(env.MAX_VC_MEMBERS ?? "40", 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 45) : 40;
}
