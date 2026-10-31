import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { applyProjectDefaults, parseProjectDefaults } from "@/lib/project-defaults";
import { resolveFolder } from "@/lib/folders";
import { inProject } from "@/lib/projects";

/** Merge shared defaults without overriding explicit values, and bind project to its folder. */
export async function resolveProjectDefaults(body: unknown): Promise<unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const input = body as Record<string, unknown>;
  if (input.project_id === undefined || input.project_id === null) return input;
  if (typeof input.project_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.project_id)) throw new Error("Invalid project id");
  const { data, error } = await getSupabaseAdmin().from("projects").select("path, mission_defaults").eq("id", input.project_id).maybeSingle();
  if (error) throw new Error(/mission_defaults/.test(error.message) ? "Apply the project defaults migration first." : error.message);
  if (!data) throw new Error("Project not found");
  const path = typeof input.workspace_path === "string" ? input.workspace_path.trim() : "";
  if (!path || !inProject(await resolveFolder(String(data.path)), await resolveFolder(path))) throw new Error("Workspace must be inside the selected project folder");
  const defaults = parseProjectDefaults(data.mission_defaults ?? {});
  if (!defaults.ok) throw new Error(`Invalid project defaults: ${defaults.error}`);
  return applyProjectDefaults(input, defaults.value);
}
