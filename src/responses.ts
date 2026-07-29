import { MESSAGES, TIME_REASONS } from "./messages";

const EPHEMERAL = 1 << 6;

export interface SafetyCardOptions {
  xCardCustomId: string;
  timeButtonLabel: string;
  xCardButtonLabel: string;
  settingsSummary?: string;
}

export function timeReasonLabel(value?: string): string | null {
  return TIME_REASONS.find((reason) => reason.value === value)?.label ?? null;
}

export function jsonResponse(
  payload: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function ephemeralMessage(content: string): Response {
  return jsonResponse({
    type: 4,
    data: { content, flags: EPHEMERAL },
  });
}

export function deferredEphemeral(): Response {
  return jsonResponse({
    type: 5,
    data: { flags: EPHEMERAL },
  });
}

export function timeReasonMenu(): Response {
  return jsonResponse({
    type: 4,
    data: {
      content: MESSAGES.timeReasonPrompt,
      flags: EPHEMERAL,
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "time:reason",
              placeholder: MESSAGES.timeReasonPlaceholder,
              min_values: 1,
              max_values: 1,
              options: TIME_REASONS,
            },
          ],
        },
      ],
    },
  });
}

export function safetyCardPayload(
  options: SafetyCardOptions = {
    xCardCustomId: "xcard:activate",
    timeButtonLabel: MESSAGES.timeButtonLabel,
    xCardButtonLabel: MESSAGES.xCardButtonLabel,
  },
): Record<string, unknown> {
  const embed: Record<string, unknown> = {
    title: MESSAGES.safetyCardTitle,
    description: MESSAGES.safetyCardDescription,
    color: 0xd83c3e,
  };
  if (options.settingsSummary) {
    embed.fields = [
      { name: MESSAGES.cardSettingsField, value: options.settingsSummary },
    ];
  }

  return {
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            custom_id: "time:choose",
            label: options.timeButtonLabel,
            emoji: { name: "⏱️" },
          },
          {
            type: 2,
            style: 4,
            custom_id: options.xCardCustomId,
            label: options.xCardButtonLabel,
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export function safetyCardMessage(): Record<string, unknown> {
  return { type: 4, data: safetyCardPayload() };
}
