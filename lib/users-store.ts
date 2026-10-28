import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isRole } from "@/lib/auth";
import type { Role } from "@/lib/auth";

/** A user as the API returns it: never includes the password hash. */
export type PublicUser = {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  created_at: string;
};

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export function usernameProblem(username: unknown): string | null {
  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    return "Username must be 3-32 characters: letters, digits, dot, dash or underscore.";
  }
  return null;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: isRole(row.role) ? row.role : "viewer",
    createdAt: row.created_at,
  };
}

export async function listUsers(): Promise<PublicUser[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_users")
    .select("id, username, password_hash, role, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as UserRow[]).map(toPublic);
}

/** The row needed to check a password at sign-in, matched case-insensitively. */
export async function findUserForLogin(
  username: string
): Promise<{ user: PublicUser; passwordHash: string } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_users")
    .select("id, username, password_hash, role, created_at")
    .ilike("username", username.replace(/[\\%_]/g, (c) => `\\${c}`))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as UserRow;
  return { user: toPublic(row), passwordHash: row.password_hash };
}

export async function createUser(username: string, passwordHash: string, role: Role): Promise<PublicUser> {
  const { data, error } = await getSupabaseAdmin()
    .from("app_users")
    .insert({ username, password_hash: passwordHash, role })
    .select("id, username, password_hash, role, created_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new UserConflictError();
    throw new Error(error.message);
  }
  return toPublic(data as UserRow);
}

export async function updateUser(
  id: string,
  changes: { role?: Role; passwordHash?: string }
): Promise<PublicUser | null> {
  const patch: Record<string, string> = { updated_at: new Date().toISOString() };
  if (changes.role) patch.role = changes.role;
  if (changes.passwordHash) patch.password_hash = changes.passwordHash;
  const { data, error } = await getSupabaseAdmin()
    .from("app_users")
    .update(patch)
    .eq("id", id)
    .select("id, username, password_hash, role, created_at")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toPublic(data as UserRow) : null;
}

export async function deleteUser(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().from("app_users").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** The user's current role, or null when the account no longer exists. */
export async function currentRole(id: string): Promise<Role | null> {
  const { data, error } = await getSupabaseAdmin().from("app_users").select("role").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data && isRole(data.role) ? data.role : null;
}

export class UserConflictError extends Error {
  constructor() {
    super("That username is already taken.");
  }
}
