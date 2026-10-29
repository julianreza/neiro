import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROJECTS_TABLE, findProjectFor, projectName } from "@/lib/projects";

/**
 * The project a new mission or question belongs to: the deepest saved
 * project folder that holds `path`, else a new project for `path` itself.
 * Best effort: returns null (and logs) when the projects table is missing,
 * so missions and questions still start.
 */
export async function projectIdFor(supabase: SupabaseClient, path: string | null): Promise<string | null> {
  const clean = path?.trim().replace(/\/+$/, "");
  if (!clean) return null;
  try {
    const { data, error } = await supabase.from(PROJECTS_TABLE).select("id, path");
    if (error) throw new Error(error.message);
    const found = findProjectFor(
      (data ?? []).map((row) => ({ id: String(row.id), path: String(row.path) })),
      clean,
    );
    if (found) return found.id;

    const { data: added, error: addError } = await supabase
      .from(PROJECTS_TABLE)
      .upsert({ path: clean, name: projectName(clean) }, { onConflict: "path" })
      .select("id")
      .single();
    if (addError) throw new Error(addError.message);
    return added ? String(added.id) : null;
  } catch (err: unknown) {
    console.warn(`[projects] link skipped for ${clean}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Set `project_id` on a mission or question row, after it is saved.
 * Best effort: a database without the link migration keeps working.
 */
export async function linkToProject(
  supabase: SupabaseClient,
  table: "missions" | "ask_questions",
  id: string,
  path: string | null,
): Promise<void> {
  const projectId = await projectIdFor(supabase, path);
  if (!projectId) return;
  try {
    const { error } = await supabase.from(table).update({ project_id: projectId }).eq("id", id);
    if (error) console.warn(`[projects] could not link ${table} ${id}:`, error.message);
  } catch (err: unknown) {
    console.warn(`[projects] could not link ${table} ${id}:`, err);
  }
}
