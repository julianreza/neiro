import "server-only";
import { RoleCache } from "@/lib/role-cache";
import { currentRole } from "@/lib/users-store";

const globalForRoles = globalThis as typeof globalThis & { __neiroRoleCache?: RoleCache };

/** One role cache per server process, shared by the proxy and the users API. */
export function sessionRoles(): RoleCache {
  globalForRoles.__neiroRoleCache ??= new RoleCache(currentRole);
  return globalForRoles.__neiroRoleCache;
}
