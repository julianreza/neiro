"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Picker } from "@/components/ui/picker";
import { useRole } from "@/hooks/use-role";
import { sendJson, timeAgo } from "@/lib/client-api";

type User = { id: string; username: string; role: "admin" | "viewer"; createdAt: string };

const ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer" },
  { value: "admin", label: "Admin" },
];

export function UsersManager() {
  const role = useRole();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<User["role"]>("viewer");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Couldn't load (${res.status})`);
        return;
      }
      setError(null);
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch {
      setError("Couldn't reach Neiro. Check your connection.");
    }
  }, []);

  useEffect(() => {
    if (role === "viewer") return;
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load, role]);

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const result = await sendJson("/api/users", "POST", { username: username.trim(), password, role: newRole });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${username.trim()} added`);
    setUsername("");
    setPassword("");
    void load();
  }

  async function changeRole(user: User, next: User["role"]) {
    const result = await sendJson(`/api/users/${user.id}`, "PATCH", { role: next });
    if (!result.ok) return toast.error(result.error);
    toast.success(`${user.username} is now ${next === "admin" ? "an admin" : "a viewer"}`);
    void load();
  }

  async function resetPassword(user: User) {
    const next = window.prompt(`New password for ${user.username} (at least 10 characters)`);
    if (!next) return;
    const result = await sendJson(`/api/users/${user.id}`, "PATCH", { password: next });
    if (!result.ok) return toast.error(result.error);
    toast.success(`Password changed for ${user.username}`);
  }

  async function remove(user: User) {
    if (!window.confirm(`Delete ${user.username}? They are signed out at once. This can't be undone.`)) return;
    const result = await sendJson(`/api/users/${user.id}`, "DELETE");
    if (!result.ok) return toast.error(result.error);
    toast.success(`${user.username} deleted`);
    void load();
  }

  if (role === "viewer") {
    return (
      <div className="w-full px-4 py-6 md:px-8">
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only admins can manage users.</p>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-6 md:px-8">
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="text-sm text-muted-foreground">
        Admins can change everything. Viewers can look but can&apos;t change anything. The passcode in{" "}
        <code className="code-chip">DASHBOARD_SECRET</code> always signs in as an admin.
      </p>

      <form onSubmit={addUser} className="mt-5 grid gap-3 rounded-2xl border bg-card p-4 text-card-foreground sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="new-username">Username</Label>
          <Input
            id="new-username"
            required
            autoComplete="off"
            pattern="[a-zA-Z0-9._\-]{3,32}"
            title="3-32 letters, digits, dot, dash or underscore"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-password">Password</Label>
          <Input
            id="new-password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-role">Role</Label>
          <Picker id="new-role" value={newRole} onChange={(v) => setNewRole(v as User["role"])} options={ROLE_OPTIONS} />
        </div>
        <Button type="submit" disabled={saving}>
          Add user
        </Button>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-destructive/40 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {users === null && !error && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      )}
      {users && users.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">No users yet. Everyone signs in with the passcode until you add one.</p>
      )}
      {users && users.length > 0 && (
        <ul className="mt-4 divide-y rounded-2xl border bg-card text-card-foreground">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{user.username}</p>
                <p className="text-xs text-muted-foreground">Added {timeAgo(user.createdAt)}</p>
              </div>
              <Picker
                id={`role-${user.id}`}
                size="sm"
                aria-label={`Role for ${user.username}`}
                value={user.role}
                onChange={(v) => void changeRole(user, v as User["role"])}
                options={ROLE_OPTIONS}
              />
              <Button size="sm" variant="outline" onClick={() => void resetPassword(user)}>
                Reset password
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${user.username}`} onClick={() => void remove(user)}>
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
