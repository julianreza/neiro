import type { Role, Session } from "@/lib/auth";
import { OWNER_SUB } from "@/lib/auth";

/**
 * A signed cookie stays valid for days, so a deleted or demoted user must be
 * re-checked against the database. Results are cached briefly per user so
 * this costs at most one lookup per user every TTL_MS.
 */
export const ROLE_CACHE_TTL_MS = 30_000;

type Lookup = (userId: string) => Promise<Role | null>;
type Cached = { role: Role | null; at: number };

export class RoleCache {
  private cache = new Map<string, Cached>();

  constructor(
    private readonly lookup: Lookup,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = ROLE_CACHE_TTL_MS
  ) {}

  /**
   * The session with the user's CURRENT role, or null when the account is
   * gone. The owner never hits the database. When the lookup itself fails
   * the session is refused (fail closed).
   */
  async refresh(session: Session): Promise<Session | null> {
    if (session.sub === OWNER_SUB) return session;
    const now = this.now();
    const hit = this.cache.get(session.sub);
    let role: Role | null;
    if (hit && now - hit.at < this.ttlMs) {
      role = hit.role;
    } else {
      try {
        role = await this.lookup(session.sub);
      } catch {
        return null;
      }
      this.cache.set(session.sub, { role, at: now });
      if (this.cache.size > 5_000) this.cache.delete(this.cache.keys().next().value as string);
    }
    return role ? { sub: session.sub, role } : null;
  }

  /** Drop a user's cached role right after an admin changes or deletes it. */
  forget(userId: string): void {
    this.cache.delete(userId);
  }
}
