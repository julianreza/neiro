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

export type Role = "admin" | "viewer";
export const ROLES: readonly Role[] = ["admin", "viewer"];

export function isRole(value: unknown): value is Role {
  return value === "admin" || value === "viewer";
}

/** Who a request acts as. `sub` is a user id, or OWNER_SUB for the passcode. */
export type Session = { sub: string; role: Role };

/** The DASHBOARD_SECRET holder: always admin, not a row in app_users. */
export const OWNER_SUB = "owner";
export const OWNER_SESSION: Session = { sub: OWNER_SUB, role: "admin" };

function base64UrlEncode(text: string): string {
  const bytes = encoder.encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await getHmacKey(secret);
  return bufferToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}

async function hmacMatches(secret: string, data: string, sigHex: string): Promise<boolean> {
  const sigBytes = hexToUint8Array(sigHex);
  if (!sigBytes) return false;
  try {
    const key = await getHmacKey(secret);
    return await crypto.subtle.verify("HMAC", key, sigBytes as unknown as BufferSource, encoder.encode(data));
  } catch {
    return false;
  }
}

/**
 * Signs a session token: `v2.${exp}.${base64url(json session)}.${hmacHex}`.
 * The HMAC covers everything before the last dot, so the role can't be edited.
 */
export async function signSessionToken(
  secret: string,
  expiresAtMs: number = Date.now() + SESSION_TTL_MS,
  session: Session = OWNER_SESSION
): Promise<string> {
  const body = `v2.${expiresAtMs}.${base64UrlEncode(JSON.stringify({ sub: session.sub, role: session.role }))}`;
  return `${body}.${await hmacHex(secret, body)}`;
}

/**
 * Returns the session a token carries, or null when it is forged, expired or
 * malformed. Legacy `${exp}.${hmacHex}` tokens (issued before user accounts)
 * stay valid until they expire and act as the owner.
 */
export async function readSessionToken(
  token: string | undefined,
  secret: string | undefined
): Promise<Session | null> {
  if (!token || !secret || secret.length < MIN_SECRET_LENGTH) return null;

  const parts = token.split(".");
  if (parts.length === 2) {
    const [expStr, sig] = parts;
    const exp = parseInt(expStr, 10);
    if (Number.isNaN(exp) || exp <= Date.now()) return null;
    return (await hmacMatches(secret, expStr, sig)) ? OWNER_SESSION : null;
  }

  if (parts.length !== 4 || parts[0] !== "v2") return null;
  const [, expStr, payload, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (Number.isNaN(exp) || exp <= Date.now()) return null;
  if (!(await hmacMatches(secret, `v2.${expStr}.${payload}`, sig))) return null;

  const json = base64UrlDecode(payload);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { sub?: unknown; role?: unknown };
    if (typeof parsed.sub !== "string" || !parsed.sub || !isRole(parsed.role)) return null;
    return { sub: parsed.sub, role: parsed.role };
  } catch {
    return null;
  }
}

/** Verifies a session token's signature and expiry. */
export async function verifySessionToken(
  token: string | undefined,
  secret: string | undefined
): Promise<boolean> {
  return (await readSessionToken(token, secret)) !== null;
}

/**
 * The session behind a request: the Bearer DASHBOARD_SECRET (cron, scripts)
 * is the owner; otherwise the signed neiro_session cookie decides.
 */
export async function getRequestSession(request: NextRequest): Promise<Session | null> {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    warnWeakSecretOnce(secret);
    return null;
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && timingSafeEqualString(token, secret)) return OWNER_SESSION;
  }

  return readSessionToken(request.cookies.get(SESSION_COOKIE)?.value, secret);
}

/** Checks whether an incoming NextRequest is authorized via cookie or Bearer header. */
export async function isAuthorizedRequest(request: NextRequest): Promise<boolean> {
  return (await getRequestSession(request)) !== null;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Role policy for API calls. Admins may do anything. Viewers may read, and
 * may sign out, but may not change anything or see the user list.
 */
export function roleAllows(role: Role, method: string, pathname: string): boolean {
  if (role === "admin") return true;
  if (pathname === "/api/users" || pathname.startsWith("/api/users/")) return false;
  if (pathname === "/api/auth" && method.toUpperCase() === "DELETE") return true;
  return READ_METHODS.has(method.toUpperCase());
}
