import { TIME_REASONS } from "./config";

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
      content: "匿名で通告する理由カテゴリを1つ選んでください。",
      flags: EPHEMERAL,
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "time:reason",
              placeholder: "理由カテゴリを選択",
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

export function safetyCardMessage(): Record<string, unknown> {
  return {
    type: 4,
    data: {
      embeds: [
        {
          title: "セーフティカード",
          description:
            "**⏱ タイム**: 理由カテゴリを選び、匿名で通告します。\n\n**✕ Xカード**: 会話を止める必要があるときに使用します。押した時点で参加しているVCの全員がサーバーミュートされます。\n\nどちらも押した人の名前は表示・保存されません。",
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
              label: "タイム",
              emoji: { name: "⏱️" },
            },
            {
              type: 2,
              style: 4,
              custom_id: "xcard:activate",
              label: "Xカード",
              emoji: { name: "✕" },
            },
          ],
        },
      ],
      allowed_mentions: { parse: [] },
    },
  };
}
