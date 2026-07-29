import type { XCardSettings } from "./types";

/**
 * Xカードの押下からミュート開始までのランダム遅延です。
 * 発言時刻と発動時刻の直接的な対応を少し曖昧にします。
 */
export const X_CARD_DELAY_MIN_MS = 5_000;
export const X_CARD_DELAY_MAX_MS = 10_000;
export const MAX_X_CARD_DELAY_SECONDS = 20;

export function randomXCardDelayMs(
  random = Math.random,
  minMs = X_CARD_DELAY_MIN_MS,
  maxMs = X_CARD_DELAY_MAX_MS,
): number {
  const range = maxMs - minMs + 1;
  return minMs + Math.floor(random() * range);
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

export function xCardSettings(
  autoUnmuteDefault?: string,
  autoUnmuteOption?: number,
  delayMinOption?: number,
  delayMaxOption?: number,
): XCardSettings | null {
  const settings = {
    autoUnmuteSeconds:
      autoUnmuteOption ?? autoUnmuteSeconds(autoUnmuteDefault),
    delayMinSeconds:
      delayMinOption ?? X_CARD_DELAY_MIN_MS / 1000,
    delayMaxSeconds:
      delayMaxOption ?? X_CARD_DELAY_MAX_MS / 1000,
  };

  if (
    !Number.isInteger(settings.autoUnmuteSeconds) ||
    settings.autoUnmuteSeconds < 0 ||
    settings.autoUnmuteSeconds > MAX_AUTO_UNMUTE_SECONDS ||
    !Number.isInteger(settings.delayMinSeconds) ||
    settings.delayMinSeconds < 0 ||
    settings.delayMinSeconds > MAX_X_CARD_DELAY_SECONDS ||
    !Number.isInteger(settings.delayMaxSeconds) ||
    settings.delayMaxSeconds < 0 ||
    settings.delayMaxSeconds > MAX_X_CARD_DELAY_SECONDS ||
    settings.delayMinSeconds > settings.delayMaxSeconds
  ) {
    return null;
  }
  return settings;
}

export function xCardCustomId(settings: XCardSettings): string {
  return `xcard:activate:${settings.autoUnmuteSeconds}:${settings.delayMinSeconds}:${settings.delayMaxSeconds}`;
}

export function settingsFromXCardCustomId(
  customId: string,
  autoUnmuteDefault?: string,
): XCardSettings {
  const match = /^xcard:activate:(\d+):(\d+):(\d+)$/.exec(customId);
  if (match) {
    const parsed = xCardSettings(
      autoUnmuteDefault,
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
    if (parsed) return parsed;
  }

  return xCardSettings(autoUnmuteDefault) as XCardSettings;
}
