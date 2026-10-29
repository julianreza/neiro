import { isIP } from "node:net";

/**
 * Counts failed sign-ins per key (IP, IP/account pair, shared passcode) and locks a key
 * out for a while once it fails too often. Kept in memory: one Neiro server
 * process is the supported setup, and a restart only clears the counters.
 */

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
const MAX_KEYS = 10_000;
const PASSCODE_KEY = "passcode";

type Entry = { failures: number; windowStart: number; lockedUntil: number };

export type LimitCheck = { ok: true } | { ok: false; retryAfterSec: number };

export class LoginLimiter {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxFailures = MAX_FAILURES,
    private readonly windowMs = WINDOW_MS
  ) {}

  /** Blocked when any key is locked or a new key cannot be tracked. */
  check(keys: string[]): LimitCheck {
    const now = this.now();
    let wait = 0;
    if (this.entries.size >= MAX_KEYS) {
      const nextExpiry = this.prune(now);
      if (this.entries.size >= MAX_KEYS && keys.some((key) => !this.entries.has(key))) {
        wait = nextExpiry - now;
      }
    }
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry && entry.lockedUntil > now) wait = Math.max(wait, entry.lockedUntil - now);
    }
    return wait > 0 ? { ok: false, retryAfterSec: Math.ceil(wait / 1000) } : { ok: true };
  }

  recordFailure(keys: string[]): void {
    const now = this.now();
    if (this.entries.size >= MAX_KEYS) this.prune(now);
    for (const key of keys) {
      let entry = this.entries.get(key);
      // In-flight sign-ins can finish after the last slot was taken.
      // check() blocks untracked keys until a slot becomes available.
      if (!entry && this.entries.size >= MAX_KEYS) continue;
      if (entry && entry.lockedUntil > now) continue;
      if (!entry || now - entry.windowStart >= this.windowMs) {
        entry = { failures: 0, windowStart: now, lockedUntil: 0 };
      }
      entry.failures += 1;
      if (entry.failures >= this.maxFailures) {
        entry.lockedUntil = now + this.windowMs;
        console.warn("[auth]", {
          event: "login_lockout",
          keyKind: key === PASSCODE_KEY ? "passcode" : key.startsWith("user:") ? "user" : "ip",
          retryAfterSec: Math.ceil(this.windowMs / 1000),
        });
      }
      this.entries.delete(key); // re-insert so Map order stays oldest-first
      this.entries.set(key, entry);
    }
  }

  recordSuccess(keys: string[]): void {
    for (const key of keys) this.entries.delete(key);
  }

  private prune(now: number): number {
    let nextExpiry = Infinity;
    for (const [key, entry] of this.entries) {
      const expiresAt = Math.max(entry.lockedUntil, entry.windowStart + this.windowMs);
      if (expiresAt <= now) this.entries.delete(key);
      else nextExpiry = Math.min(nextExpiry, expiresAt);
    }
    return nextExpiry;
  }
}

const globalForLimiter = globalThis as typeof globalThis & { __neiroLoginLimiter?: LoginLimiter };

/** One limiter per server process (survives dev HMR). */
export function loginLimiter(): LoginLimiter {
  globalForLimiter.__neiroLoginLimiter ??= new LoginLimiter();
  return globalForLimiter.__neiroLoginLimiter;
}

/**
 * XFF is spoofable without a trusted ingress. Only use a fixed hop from the
 * right when the origin is reachable exclusively through that proxy chain.
 * NextRequest has no socket address; otherwise share one fail-closed bucket.
 */
export function clientAddress(
  headers: Headers,
  trustedProxyHops: number | string | undefined = process.env.NEIRO_TRUSTED_PROXY_HOPS
): string {
  const hops = Number(trustedProxyHops ?? 0);
  if (!Number.isSafeInteger(hops) || hops < 1) return "local";
  const forwarded = headers.get("x-forwarded-for")?.split(",");
  const address = forwarded?.[forwarded.length - hops]?.trim();
  return address && isIP(address) ? address : "local";
}

export function limiterKeys(ip: string, username: string | null): string[] {
  return [
    `ip:${ip}`,
    username ? `user:${JSON.stringify([ip, username.toLowerCase()])}` : PASSCODE_KEY,
  ];
}
