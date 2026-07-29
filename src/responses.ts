import { MESSAGES, TIME_REASONS } from "./messages";

const EPHEMERAL = 1 << 6;

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

export function safetyCardPayload(): Record<string, unknown> {
  return {
    embeds: [
      {
        title: MESSAGES.safetyCardTitle,
        description: MESSAGES.safetyCardDescription,
        color: 0xd83c3e,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: "time:choose",
            label: MESSAGES.timeButtonLabel,
            emoji: { name: "⏱️" },
          },
          {
            type: 2,
            style: 4,
            custom_id: "xcard:activate",
            label: MESSAGES.xCardButtonLabel,
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
