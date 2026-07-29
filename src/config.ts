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
