import "server-only";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";

const exec = promisify(execFile);

/** Canonical checkout root; different subfolders and symlinks share one key. */
export async function workspaceReservationKey(folder: string): Promise<string> {
  const resolved = await realpath(folder);
  try {
    const { stdout } = await exec("git", ["-C", resolved, "rev-parse", "--show-toplevel"], { timeout: 5000 });
    return `workspace:${await realpath(stdout.trim())}`;
  } catch (error) {
    if (error && typeof error === "object" && "stderr" in error && /not a git repository/i.test(String(error.stderr))) {
      return `workspace:${resolved}`;
    }
    throw error;
  }
}

export type WorkspaceReservation = { resourceKey: string; missionId: string; taskId: string; ownerToken: string };

async function reservationRpc(db: SupabaseClient, method: string, reservation: WorkspaceReservation): Promise<boolean> {
  const { data, error } = await db.rpc(method, {
    p_resource_key: reservation.resourceKey,
    p_mission_id: reservation.missionId,
    p_task_id: reservation.taskId,
    p_owner_token: reservation.ownerToken,
  });
  if (error) throw new Error(`Workspace reservation unavailable: ${error.message}. Apply supabase/manual/20261107_workspace_reservations.sql.`);
  return data === true;
}

export const claimWorkspaceReservation = (db: SupabaseClient, reservation: WorkspaceReservation) =>
  reservationRpc(db, "claim_workspace_reservation", reservation);

export const releaseWorkspaceReservation = (db: SupabaseClient, reservation: WorkspaceReservation) =>
  reservationRpc(db, "release_workspace_reservation", reservation);
