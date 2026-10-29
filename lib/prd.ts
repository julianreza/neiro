/**
 * PRD versions, review notes and version diffs. Pure helpers shared by the
 * orchestrator (server) and the PRD page (client).
 *
 * Storage, all in mission_artifacts (no extra table):
 *   prd:<mission>          kind "prd"        PRD v1
 *   prd:<mission>:v<N>     kind "prd"        PRD vN (N >= 2)
 *   prd-notes:<mission>:v<N> kind "prd_notes" the notes that asked to revise vN
 * So the PRD a spec run must write is always v(1 + number of notes).
 */
import type { MissionArtifact } from "@/lib/types";

export type PrdVersion = { version: number; artifact: MissionArtifact };
export type PrdNote = { quote: string | null; note: string };
export type PrdRevision = PrdVersion & { notes: MissionArtifact | null };

export const MAX_PRD_NOTES = 20;
export const MAX_NOTE_CHARS = 2000;
export const MAX_QUOTE_CHARS = 500;

export function prdKey(missionId: string, version: number): string {
  return version <= 1 ? `prd:${missionId}` : `prd:${missionId}:v${version}`;
}

export function prdNotesKey(missionId: string, version: number): string {
  return `prd-notes:${missionId}:v${version}`;
}

export function prdTitle(version: number): string {
  return version <= 1 ? "Product Requirements Document (PRD)" : `Product Requirements Document (PRD) v${version}`;
}

function versionOf(key: string | null | undefined, prefix: string): number | null {
  if (!key) return null;
  if (key === prefix) return 1;
  if (!key.startsWith(`${prefix}:v`)) return null;
  const n = Number(key.slice(prefix.length + 2));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Every PRD of the mission, oldest first. */
export function prdVersions(artifacts: MissionArtifact[], missionId: string): PrdVersion[] {
  const out: PrdVersion[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind !== "prd") continue;
    const version = versionOf(artifact.dedupeKey, `prd:${missionId}`);
    if (version !== null) out.push({ version, artifact });
  }
  return out.sort((a, b) => a.version - b.version);
}

/** Notes that asked to revise version `version`, if any. */
export function prdNotesFor(
  artifacts: MissionArtifact[],
  missionId: string,
  version: number,
): MissionArtifact | null {
  const key = prdNotesKey(missionId, version);
  return artifacts.find((a) => a.kind === "prd_notes" && a.dedupeKey === key) ?? null;
}

/** Each PRD with the notes that later asked to revise it. */
export function prdRevisions(artifacts: MissionArtifact[], missionId: string): PrdRevision[] {
  return prdVersions(artifacts, missionId).map((v) => ({
    ...v,
    notes: prdNotesFor(artifacts, missionId, v.version),
  }));
}

/** The version the next spec run writes: one past the last revised PRD. */
export function nextPrdVersion(artifacts: MissionArtifact[], missionId: string): number {
  let revised = 0;
  for (const a of artifacts) {
    if (a.kind !== "prd_notes") continue;
    const v = versionOf(a.dedupeKey, `prd-notes:${missionId}`);
    if (v !== null && v > revised) revised = v;
  }
  return revised + 1;
}

/** Validate notes from the PRD page. */
export function parsePrdNotes(input: unknown): { ok: true; notes: PrdNote[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "Add at least one note." };
  }
  if (input.length > MAX_PRD_NOTES) {
    return { ok: false, error: `Send at most ${MAX_PRD_NOTES} notes at once.` };
  }
  const notes: PrdNote[] = [];
  for (const raw of input) {
    const r = (raw ?? {}) as { quote?: unknown; note?: unknown };
    const note = typeof r.note === "string" ? r.note.trim() : "";
    if (!note) return { ok: false, error: "A note is empty." };
    if (note.length > MAX_NOTE_CHARS) return { ok: false, error: `A note is longer than ${MAX_NOTE_CHARS} characters.` };
    const quote = typeof r.quote === "string" ? r.quote.replace(/\s+/g, " ").trim() : "";
    notes.push({ quote: quote ? quote.slice(0, MAX_QUOTE_CHARS) : null, note });
  }
  return { ok: true, notes };
}

/** Notes as markdown: readable in Artifacts and pasted as-is into the spec prompt. */
export function formatPrdNotes(notes: PrdNote[]): string {
  return notes
    .map((n, i) => {
      const body = n.note.replace(/\n/g, "\n   ");
      return n.quote ? `${i + 1}. On "${n.quote}":\n   ${body}` : `${i + 1}. ${body}`;
    })
    .join("\n");
}

export type DiffLine = { type: "same" | "add" | "del"; text: string };

/** Line diff (LCS). PRDs are a few hundred lines, so O(n*m) is fine. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i++] });
    } else {
      out.push({ type: "add", text: b[j++] });
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

export type OutlineItem = { level: number; text: string; id: string };

export function headingId(text: string): string {
  return (
    "prd-" +
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/** h1-h3 headings outside code fences, for the table of contents. */
export function prdOutline(markdown: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2], id: headingId(m[2]) });
  }
  return out;
}
