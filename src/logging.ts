export type LogLevel = "info" | "warn" | "error";

export type LogValue = string | number | boolean | null;

export function writeLog(
  level: LogLevel,
  event: string,
  fields: Record<string, LogValue> = {},
): void {
  const entry = {
    service: "discord-xcard",
    event,
    ...fields,
  };

  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

export function newEventId(): string {
  return crypto.randomUUID();
}
