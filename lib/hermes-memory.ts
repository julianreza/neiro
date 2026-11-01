import "server-only";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { envPath } from "@/lib/hermes-mcp-keys";
import { checkProfile, HermesSkillError } from "@/lib/hermes-skills";

export type ProfileContextKind = "soul" | "memory" | "user";
const LIMITS = { soulMax: 8000, memoryMax: 2200, userMax: 1375 } as const;
const FILES: Record<ProfileContextKind, { folder: string | null; name: string; limit: number }> = {
  soul: { folder: null, name: "SOUL.md", limit: LIMITS.soulMax },
  memory: { folder: "memories", name: "MEMORY.md", limit: LIMITS.memoryMax },
  user: { folder: "memories", name: "USER.md", limit: LIMITS.userMax },
};

async function contextPath(profile: string, kind: ProfileContextKind, rootOverride?: string, create = false): Promise<string> {
  const checked = checkProfile(profile);
  const root = rootOverride ?? dirname(await envPath(checked));
  const spec = FILES[kind];
  if (!spec) throw new HermesSkillError("Invalid context file.", 400);
  const directory = spec.folder ? join(root, spec.folder) : root;
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new HermesSkillError("Profile context directory is not a local directory.", 409);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const file = join(directory, spec.name);
  try {
    if ((await lstat(file)).isSymbolicLink()) throw new HermesSkillError("Profile context file is a symbolic link.", 409);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return file;
}

export async function readProfileContextFiles(profile: string, rootOverride?: string) {
  const read = async (kind: ProfileContextKind) => {
    const file = await contextPath(profile, kind, rootOverride);
    try { return await readFile(file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
  };
  const [soul, memory, user] = await Promise.all([read("soul"), read("memory"), read("user")]);
  return { soul, memory, user, limits: LIMITS };
}

export async function writeProfileContextFile(profile: string, kind: ProfileContextKind, content: string, rootOverride?: string): Promise<void> {
  const spec = FILES[kind];
  if (!spec || typeof content !== "string" || content.length > spec.limit) throw new HermesSkillError("Context exceeds the allowed length or is invalid.", 400);
  const target = await contextPath(profile, kind, rootOverride, true);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}
