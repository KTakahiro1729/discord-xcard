/**
 * 「タイム」で選べる理由カテゴリです。
 *
 * - label: Discordに表示・投稿される日本語
 * - value: Bot内部で使う重複しない英数字
 *
 * 項目の追加・削除・並べ替えは、この配列だけを編集してください。
 * Discordのセレクトメニュー上限は25項目です。
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

/**
 * Xカードの押下からミュート開始までのランダム遅延です。
 * 発言時刻と発動時刻の直接的な対応を少し曖昧にします。
 */
export const X_CARD_DELAY_MIN_MS = 5_000;
export const X_CARD_DELAY_MAX_MS = 10_000;

export function randomXCardDelayMs(random = Math.random): number {
  const range = X_CARD_DELAY_MAX_MS - X_CARD_DELAY_MIN_MS + 1;
  return X_CARD_DELAY_MIN_MS + Math.floor(random() * range);
}

export const DEFAULT_AUTO_UNMUTE_SECONDS = 5;
export const MAX_AUTO_UNMUTE_SECONDS = 10;

export function autoUnmuteSeconds(value?: string): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_AUTO_UNMUTE_SECONDS;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_AUTO_UNMUTE_SECONDS;
  }

  return Math.min(parsed, MAX_AUTO_UNMUTE_SECONDS);
}
