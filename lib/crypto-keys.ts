import "server-only";

const PREFIX = "enc:v1:";

async function encryptionKey(): Promise<CryptoKey> {
  const secret = process.env.NEIRO_ENCRYPTION_KEY || process.env.DASHBOARD_SECRET;
  if (!secret) throw new Error("NEIRO_ENCRYPTION_KEY or DASHBOARD_SECRET is required to encrypt agent credentials.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptAgentKey(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(plaintext));
  return `${PREFIX}${Buffer.from(iv).toString("base64url")}:${Buffer.from(encrypted).toString("base64url")}`;
}

export async function decryptAgentKey(stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error("Invalid encrypted agent credential.");
  const iv = new Uint8Array(Buffer.from(parts[0], "base64url"));
  const data = new Uint8Array(Buffer.from(parts[1], "base64url"));
  if (iv.length !== 12 || data.length < 16) throw new Error("Invalid encrypted agent credential.");
  try {
    const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(), data);
    return new TextDecoder().decode(clear);
  } catch {
    throw new Error("Could not decrypt agent credential. Check NEIRO_ENCRYPTION_KEY or DASHBOARD_SECRET.");
  }
}
