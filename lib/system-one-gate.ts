import "server-only";
import type { QuestionDef } from "laya-ts";
import { systemOneRunner, withTimeout, routerTimeoutMs } from "@/lib/task-router";

export const TOOL_APPROVAL_SCHEMA = {
  type: "object",
  properties: {
    risk_level: { type: "integer", minimum: 0, maximum: 3, description: "0 = read-only, 1 = local edit, 2 = network or installation, 3 = destructive or secrets." },
    is_destructive: { type: "boolean", description: "Could this delete data, force push or alter files outside the workspace?" },
    touches_secrets: { type: "boolean", description: "Could this read or reveal credentials, environment files or keys?" },
  },
  required: ["risk_level", "is_destructive", "touches_secrets"],
} as const;

type Assessment = { values: Record<string, unknown>; confidence: Record<string, number> };
type Decide = (input: string) => Promise<Assessment>;

/** Model scores alone cannot authorize shell execution; only exact read-only commands qualify. */
export async function evaluateSafeApproval(control: { tool?: string; command?: string }, decide: Decide = decideToolRisk): Promise<boolean> {
  if (!control.tool || !/^(bash|shell|terminal)$/i.test(control.tool)) return false;
  if (!control.command || !/^(?:pwd|ls|git status(?: --short)?)$/.test(control.command.trim())) return false;
  try {
    const result = await decide(`${control.tool}: ${control.command}`);
    return result.values.risk_level === 0 && result.values.is_destructive === false && result.values.touches_secrets === false
      && ["risk_level", "is_destructive", "touches_secrets"].every((key) => Number.isFinite(result.confidence[key]) && result.confidence[key] >= .85);
  } catch { return false; }
}

async function decideToolRisk(state: string): Promise<Assessment> {
  const { decide } = await import("laya-ts");
  const runner = await systemOneRunner();
  const result = await withTimeout(decide(runner, state, TOOL_APPROVAL_SCHEMA, { returnDetails: true }), routerTimeoutMs());
  const confidence = { ...result.confidence };
  for (const key of ["is_destructive", "touches_secrets"]) {
    const answer = result.answers[key] as { noul?: unknown } | undefined;
    if (typeof answer?.noul === "number" && Number.isFinite(answer.noul) && answer.noul >= 0 && answer.noul <= 1) confidence[key] = Math.max(answer.noul, 1 - answer.noul);
  }
  return { values: result.values, confidence };
}

type GuardResult = { answers?: Record<string, { noul?: unknown }> };
type GuardPredict = (state: { prompt: string }, questions: Record<string, unknown>) => Promise<GuardResult>;

/** Results are advisory; a missing or uncertain result is never called safe. */
export async function guardExternalPrompt(text: string, predict?: GuardPredict): Promise<"flagged" | "clear" | "unknown"> {
  try {
    const { guardQuestions } = await import("laya-ts");
    const questions = guardQuestions();
    const ask = predict ?? (async (state, q) => {
      const runner = await systemOneRunner();
      const prediction: Promise<unknown> = runner.predict(state, q as Record<string, QuestionDef>);
      return await withTimeout(prediction, routerTimeoutMs()) as GuardResult;
    });
    const result = await ask({ prompt: text.slice(0, 12_000) }, { jailbreak: questions.jailbreak, prompt_injection: questions.prompt_injection });
    const injection = result.answers?.prompt_injection?.noul;
    const jailbreak = result.answers?.jailbreak?.noul;
    if ([injection, jailbreak].some((value) => typeof value === "number" && value >= .85 && value <= 1)) return "flagged";
    if ([injection, jailbreak].every((value) => typeof value === "number" && value >= 0 && value <= .15)) return "clear";
    return "unknown";
  } catch { return "unknown"; }
}

type TriageAnswer = { type?: string; choice?: unknown; score?: unknown; noul?: unknown };
type TriagePredict = (state: { request: string }, questions: Record<string, unknown>) => Promise<{ answers?: Record<string, TriageAnswer> }>;

/** Suggestions are advisory and never change mission settings without the operator. */
export async function triageMission(prompt: string, predict?: TriagePredict): Promise<{ suggestedMode: "plan" | "build" | "fix"; complexity: number; recommendedWorkers: number; ambiguous: boolean } | null> {
  try {
    const { routerQuestions } = await import("laya-ts");
    const questions = {
      difficulty: routerQuestions().difficulty,
      suggested_mode: { type: "choice", instructions: "Which mission mode best matches the request?", criteria: { plan: "planning", build: "build a feature", fix: "fix a defect" } },
      recommended_workers: { type: "score", instructions: "How many parallel workers fit this task?", criteria: ["1", "2", "3", "4", "5", "6"] },
      is_ambiguous: { type: "noul", instructions: "Is this request ambiguous enough to need human review of the plan?" },
    };
    const ask = predict ?? (async (state, q) => {
      const runner = await systemOneRunner();
      const prediction: Promise<unknown> = runner.predict(state, q as Record<string, QuestionDef>);
      return await withTimeout(prediction, routerTimeoutMs()) as { answers?: Record<string, TriageAnswer> };
    });
    const result = (await ask({ request: prompt.slice(0, 8000) }, questions)).answers;
    const mode = result?.suggested_mode?.choice, difficulty = result?.difficulty?.score, workers = result?.recommended_workers?.score, ambiguous = result?.is_ambiguous?.noul;
    if ((mode !== "plan" && mode !== "build" && mode !== "fix") || typeof difficulty !== "number" || !Number.isFinite(difficulty) || difficulty < 0 || difficulty > 3 || typeof workers !== "number" || !Number.isFinite(workers) || workers < 0 || workers > 5 || typeof ambiguous !== "number" || !Number.isFinite(ambiguous) || ambiguous < 0 || ambiguous > 1) return null;
    return { suggestedMode: mode, complexity: Math.round(difficulty), recommendedWorkers: Math.round(workers) + 1, ambiguous: ambiguous >= .5 };
  } catch { return null; }
}
