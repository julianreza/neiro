import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "neiro_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const encoder = new TextEncoder();

export const MIN_SECRET_LENGTH = 8;

/**
 * Returns a human message when DASHBOARD_SECRET cannot authorize anything
 * (missing or shorter than MIN_SECRET_LENGTH), or null when it is usable.
 * A short secret silently rejects every request, so callers surface this.
 */
export function dashboardSecretProblem(secret = process.env.DASHBOARD_SECRET): string | null {
  if (!secret) return "DASHBOARD_SECRET is not set in .env.local";
  if (secret.length < MIN_SECRET_LENGTH) {
    return `DASHBOARD_SECRET is too short: ${secret.length} characters, minimum ${MIN_SECRET_LENGTH}. Update .env.local and restart the server.`;
  }
  return null;
}

let warnedWeakSecret = false;
function warnWeakSecretOnce(secret: string | undefined) {
  if (warnedWeakSecret) return;
  warnedWeakSecret = true;
  console.warn(`[neiro] ${dashboardSecretProblem(secret)} Every request will be rejected as Unauthorized.`);
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function hexToUint8Array(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const val = parseInt(hex.substring(i, i + 2), 16);
    if (Number.isNaN(val)) return null;
    bytes[i / 2] = val;
  }
  return bytes;
}

/**
 * Constant-time byte array comparison using timing-safe XOR
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let c = 0;
  for (let i = 0; i < a.length; i++) {
    c |= a[i] ^ b[i];
  }
  return c === 0;
}

/**
 * Constant-time string comparison using UTF-8 bytes
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  return constantTimeEqual(bufA, bufB);
}

/**
 * Signs a session token with format: `${exp}.${hmacHex}`
 */
export async function signSessionToken(
  secret: string,
  expiresAtMs: number = Date.now() + SESSION_TTL_MS
): Promise<string> {
  const key = await getHmacKey(secret);
  const data = encoder.encode(expiresAtMs.toString());
  const signature = await crypto.subtle.sign("HMAC", key, data);
  const hmacHex = bufferToHex(signature);
  return `${expiresAtMs}.${hmacHex}`;
}

/**
 * Verifies the HMAC-SHA256 signature and expiration timestamp of a session token
 */
export async function verifySessionToken(
  token: string | undefined,
  secret: string | undefined
): Promise<boolean> {
  if (!token || !secret || secret.length < MIN_SECRET_LENGTH) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }

  const [expStr, hmacHex] = parts;
  const expiresAtMs = parseInt(expStr, 10);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    return false;
  }

  const sigBytes = hexToUint8Array(hmacHex);
  if (!sigBytes) {
    return false;
  }

  try {
    const key = await getHmacKey(secret);
    const data = encoder.encode(expStr);
    return await crypto.subtle.verify("HMAC", key, sigBytes as unknown as BufferSource, data);
  } catch {
    return false;
  }
}

/**
 * Checks whether an incoming NextRequest is authorized via cookie or Bearer header
 */
export async function isAuthorizedRequest(request: NextRequest): Promise<boolean> {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    warnWeakSecretOnce(secret);
    return false;
  }

  // 1. Check Bearer Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && timingSafeEqualString(token, secret)) {
      return true;
    }
  }

  // 2. Check neiro_session cookie
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && (await verifySessionToken(cookie, secret))) {
    return true;
  }

  return false;
}
