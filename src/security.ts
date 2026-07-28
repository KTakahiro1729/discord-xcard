function hexToBuffer(hex: string): ArrayBuffer {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hexadecimal value");
  }

  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return buffer;
}

function encodeToBuffer(value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function internalSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encodeToBuffer(`discord-x-card:auto-unmute:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signInternalRequest(
  body: string,
  secret: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await internalSigningKey(secret),
    encodeToBuffer(body),
  );
  return bufferToHex(signature);
}

export async function verifyInternalRequest(
  body: string,
  signatureHex: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHex) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await internalSigningKey(secret),
      hexToBuffer(signatureHex),
      encodeToBuffer(body),
    );
  } catch {
    return false;
  }
}

export async function verifyDiscordRequest(
  request: Request,
  body: string,
  publicKeyHex: string,
): Promise<boolean> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBuffer(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const message = encodeToBuffer(timestamp + body);
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBuffer(signature),
      message,
    );
  } catch {
    return false;
  }
}
