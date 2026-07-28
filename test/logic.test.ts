import { afterEach, describe, expect, it, vi } from "vitest";
import {
  maxVcMembers,
  muteMembers,
  registerSetupCommand,
  snapshotForUser,
  unmuteMembers,
} from "../src/discord";
import {
  DEFAULT_AUTO_UNMUTE_SECONDS,
  MAX_AUTO_UNMUTE_SECONDS,
  X_CARD_DELAY_MAX_MS,
  X_CARD_DELAY_MIN_MS,
  autoUnmuteSeconds,
  randomXCardDelayMs,
} from "../src/config";
import { canSetUpCard } from "../src/index";
import {
  signInternalRequest,
  verifyInternalRequest,
} from "../src/security";
import {
  safetyCardMessage,
  timeReasonLabel,
  timeReasonMenu,
} from "../src/responses";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("voice snapshot", () => {
  it("finds the actor's channel and every participant", () => {
    expect(
      snapshotForUser(
        [
          { user_id: "actor", channel_id: "voice-a" },
          { user_id: "friend", channel_id: "voice-a", mute: true },
          { user_id: "other", channel_id: "voice-b" },
        ],
        "actor",
      ),
    ).toEqual({
      channelId: "voice-a",
      memberIds: ["actor", "friend"],
      memberIdsToMute: ["actor"],
    });
  });

  it("returns null when the actor is not in voice", () => {
    expect(
      snapshotForUser([{ user_id: "friend", channel_id: "voice-a" }], "actor"),
    ).toBeNull();
  });
});

describe("setup permissions", () => {
  it("accepts Manage Guild and Administrator", () => {
    expect(canSetUpCard(String(1 << 5))).toBe(true);
    expect(canSetUpCard(String(1 << 3))).toBe(true);
  });

  it("rejects missing or unrelated permissions", () => {
    expect(canSetUpCard(undefined)).toBe(false);
    expect(canSetUpCard("0")).toBe(false);
    expect(canSetUpCard("invalid")).toBe(false);
  });
});

describe("command registration", () => {
  it("registers the setup command globally with Manage Guild permission", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));

    await expect(
      registerSetupCommand({
        DISCORD_APPLICATION_ID: "application",
        DISCORD_BOT_TOKEN: "token",
      } as never),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/applications/application/commands",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"default_member_permissions":"32"'),
      }),
    );
  });
});

describe("server mute changes", () => {
  it("returns the members actually muted and uses distinct audit reasons", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await expect(muteMembers("token", "1", ["2"])).resolves.toMatchObject({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      succeededMemberIds: ["2"],
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://discord.com/api/v10/guilds/1/members/2",
      expect.objectContaining({
        body: '{"mute":true}',
        headers: expect.objectContaining({
          "X-Audit-Log-Reason": "X-card activated",
        }),
      }),
    );

    await unmuteMembers("token", "1", ["2"]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://discord.com/api/v10/guilds/1/members/2",
      expect.objectContaining({
        body: '{"mute":false}',
        headers: expect.objectContaining({
          "X-Audit-Log-Reason": "X-card automatic release",
        }),
      }),
    );
  });
});

describe("configuration", () => {
  it("caps the free-plan safety limit", () => {
    expect(maxVcMembers({ MAX_VC_MEMBERS: "100" } as never)).toBe(45);
    expect(maxVcMembers({ MAX_VC_MEMBERS: "12" } as never)).toBe(12);
    expect(maxVcMembers({ MAX_VC_MEMBERS: "invalid" } as never)).toBe(40);
  });

  it("keeps the X-card delay within the configured random range", () => {
    expect(randomXCardDelayMs(() => 0)).toBe(X_CARD_DELAY_MIN_MS);
    expect(randomXCardDelayMs(() => 0.999999)).toBe(X_CARD_DELAY_MAX_MS);
  });

  it("defaults auto-unmute to five seconds and allows zero to disable it", () => {
    expect(autoUnmuteSeconds()).toBe(DEFAULT_AUTO_UNMUTE_SECONDS);
    expect(autoUnmuteSeconds("0")).toBe(0);
    expect(autoUnmuteSeconds("8")).toBe(8);
    expect(autoUnmuteSeconds("999")).toBe(MAX_AUTO_UNMUTE_SECONDS);
    expect(autoUnmuteSeconds("invalid")).toBe(DEFAULT_AUTO_UNMUTE_SECONDS);
  });

  it("creates persistent Time and X-card buttons", () => {
    const response = safetyCardMessage() as {
      data: {
        components: Array<{
          components: Array<{ custom_id: string; style: number }>;
        }>;
      };
    };
    expect(response.data.components[0]?.components[0]).toMatchObject({
      custom_id: "time:choose",
      style: 1,
    });
    expect(response.data.components[0]?.components[1]).toMatchObject({
      custom_id: "xcard:activate",
      style: 4,
    });
  });

  it("offers the configured anonymous Time categories", async () => {
    const response = await timeReasonMenu().json() as {
      data: {
        flags: number;
        components: Array<{
          components: Array<{
            custom_id: string;
            options: Array<{ label: string; value: string }>;
          }>;
        }>;
      };
    };

    expect(response.data.flags).toBe(64);
    expect(response.data.components[0]?.components[0]).toMatchObject({
      custom_id: "time:reason",
      options: [
        { label: "話題を変えたい", value: "change_topic" },
        {
          label: "一言だけ挟みたい（退席・連絡など）",
          value: "brief_interruption",
        },
        { label: "ペースを落としてほしい", value: "slow_down" },
        { label: "他の人に振ってほしい", value: "pass_to_others" },
        { label: "時間を気にしてほしい", value: "watch_time" },
        {
          label: "言い方を柔らかくしてほしい",
          value: "soften_wording",
        },
        { label: "理由は言わない", value: "no_reason" },
      ],
    });
    expect(timeReasonLabel("watch_time")).toBe("時間を気にしてほしい");
    expect(timeReasonLabel("soften_wording")).toBe(
      "言い方を柔らかくしてほしい",
    );
    expect(timeReasonLabel("unknown")).toBeNull();
  });
});

describe("internal request signing", () => {
  it("accepts only a matching auto-unmute payload signature", async () => {
    const body = JSON.stringify({ guildId: "1", memberIds: ["2"] });
    const signature = await signInternalRequest(body, "bot-token");

    await expect(
      verifyInternalRequest(body, signature, "bot-token"),
    ).resolves.toBe(true);
    await expect(
      verifyInternalRequest(`${body}x`, signature, "bot-token"),
    ).resolves.toBe(false);
  });
});
