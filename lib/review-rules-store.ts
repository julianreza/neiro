import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_REVIEW_RULES, MAX_REVIEW_RULES_CHARS } from "@/lib/code-review";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * The editable review rules, kept in app_state (no migration needed).
 * Only the middle part of the reviewer's instructions: the safety rules and
 * the answer format stay in code (lib/code-review.ts reviewInstructions).
 */

export const REVIEW_RULES_KEY = "code_review_rules";

export type ReviewRules = {
  /** The rules in use: the saved text, or the default. */
  text: string;
  defaultText: string;
  custom: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export async function getReviewRules(client?: SupabaseClient): Promise<ReviewRules> {
  const base: ReviewRules = { text: DEFAULT_REVIEW_RULES, defaultText: DEFAULT_REVIEW_RULES, custom: false, updatedAt: null, updatedBy: null };
  const { data, error } = await (client ?? getSupabaseAdmin())
    .from("app_state")
    .select("value, updated_at")
    .eq("key", REVIEW_RULES_KEY)
    .maybeSingle();
  if (error) throw new Error(`[review-rules] read: ${error.message}`);
  const value = (data?.value ?? {}) as Record<string, unknown>;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!text) return base;
  return {
    ...base,
    text,
    custom: true,
    updatedAt: typeof data?.updated_at === "string" ? data.updated_at : null,
    updatedBy: typeof value.updatedBy === "string" ? value.updatedBy : null,
  };
}

/** The saved text for a prompt, or null to use the default. Never throws. */
export async function loadReviewRulesText(): Promise<string | null> {
  try {
    const rules = await getReviewRules();
    return rules.custom ? rules.text : null;
  } catch (err) {
    console.warn("[review-rules] using the default rules:", err instanceof Error ? err.message : err);
    return null;
  }
}

export type SaveRulesResult = { ok: true; rules: ReviewRules } | { ok: false; status: number; error: string };

/** Save the rules; `null` or empty text goes back to the default. */
export async function saveReviewRules(text: unknown, by: string, client?: SupabaseClient): Promise<SaveRulesResult> {
  const db = client ?? getSupabaseAdmin();
  if (text === null || (typeof text === "string" && text.trim() === "")) {
    const { error } = await db.from("app_state").delete().eq("key", REVIEW_RULES_KEY);
    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true, rules: await getReviewRules(db) };
  }
  if (typeof text !== "string") return { ok: false, status: 400, error: "Send text (a string), or null to go back to the default." };
  if (text.length > MAX_REVIEW_RULES_CHARS) {
    return { ok: false, status: 400, error: `The rules can be at most ${MAX_REVIEW_RULES_CHARS} characters.` };
  }
  const now = new Date().toISOString();
  const { error } = await db
    .from("app_state")
    .upsert({ key: REVIEW_RULES_KEY, value: { text: text.trim(), updatedBy: by }, updated_at: now });
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, rules: await getReviewRules(db) };
}
