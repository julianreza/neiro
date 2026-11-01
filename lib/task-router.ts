import "server-only";

/**
 * Task router: asks Laya which agent should take a queued task.
 *
 * Laya only *chooses*. The orchestrator (lib/orchestrator.ts) stays the only
 * thing that runs a task; it stores the decision on mission_tasks and never
 * calls the router for that task again.
 *
 * Server-only: laya-ts loads a native ONNX runtime and a model from disk, so
 * it must never reach a client bundle. It is imported lazily, so nothing is
 * loaded while the router is switched off.
 */
import type { Agent as LayaAgent, DecisionResult } from "laya-ts";
import type { Agent, MissionTask, RoutingStatus, TaskStage } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Contract                                                            */
/* ------------------------------------------------------------------ */

export type RouteDecision = {
  agentId: string;
  urgency: 0 | 1 | 2;
  needsHuman: boolean;
  /** Laya's confidence in its agent_id answer, 0-1. */
  confidence: number;
};

export interface TaskRouter {
  /** Rejects on load failure, timeout or an invalid answer; the caller falls back. */
  decide(task: MissionTask, agents: Agent[]): Promise<RouteDecision>;
  decideMany?(tasks: MissionTask[], agents: Agent[]): Promise<Map<string, RouteDecision>>;
}

/** Below this, or when Laya flags needs_human, the task waits at the human gate. */
export const ROUTE_CONFIDENCE_THRESHOLD = 0.7;
export const DEFAULT_ROUTER_TIMEOUT_MS = 5000;

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/** Just the variables the router reads; process.env satisfies it. */
type RouterEnv = Record<string, string | undefined>;

/** Off when NEIRO_ROUTER=off or no model path is configured. */
export function isRouterEnabled(env: RouterEnv = process.env): boolean {
  if ((env.NEIRO_ROUTER ?? "").trim().toLowerCase() === "off") return false;
  return (env.NEIRO_ROUTER_PROVIDER ?? "laya").trim().toLowerCase() === "jev"
    ? Boolean(env.TYPESAFE_API_KEY?.trim())
    : Boolean(env.NEIRO_LAYA_MODEL_PATH?.trim());
}

export function routerTimeoutMs(env: RouterEnv = process.env): number {
  const n = Number.parseInt(env.NEIRO_ROUTER_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ROUTER_TIMEOUT_MS;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (tested without Laya)                                  */
/* ------------------------------------------------------------------ */

/**
 * JSON Schema Laya answers. Laya accepts only enum choices, booleans and
 * bounded integers, so confidence is not a field: it comes from
 * `returnDetails`. More than 32 agents exceeds Laya's MAX_OPTIONS and makes
 * decide() throw, which the caller treats as a fallback.
 */
export function buildDecisionSchema(agents: Agent[]) {
  if (agents.length === 0) throw new Error("No enabled agents to route to");
  const roster = agents
    .map((a) => `${a.id} = ${a.name} (${a.role}, ${a.stage}): ${a.specialty}`)
    .join("; ");
  return {
    type: "object",
    properties: {
      agent_id: {
        type: "string",
        enum: agents.map((a) => a.id),
        description: `Which agent should do this task? Agents: ${roster}`,
      },
      urgency: {
        type: "integer",
        minimum: 0,
        maximum: 2,
        description: "How urgent is this task? 0 = low, 1 = medium, 2 = high.",
      },
      needs_human: {
        type: "boolean",
        description:
          "Does this task need a human decision before any agent starts (policy, money, data deletion, unclear scope)?",
      },
    },
    required: ["agent_id", "urgency", "needs_human"],
  } as const;
}

export function buildRouteText(task: Pick<MissionTask, "title" | "result" | "agentName">): string {
  return [
    `Task: ${task.title}`,
    task.result ? `Description: ${task.result}` : "",
    task.agentName ? `Planner specialty: ${task.agentName}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Validate Laya's answer. Throws on an unknown agent or an out-of-range urgency. */
export function parseDecision(
  result: Pick<DecisionResult, "values" | "confidence">,
  agents: Agent[],
): RouteDecision {
  const values = result.values ?? {};
  const agentId = values.agent_id;
  if (typeof agentId !== "string" || !agents.some((a) => a.id === agentId)) {
    throw new Error(`Laya picked an unknown agent: ${String(agentId)}`);
  }

  const urgency = values.urgency;
  if (urgency !== 0 && urgency !== 1 && urgency !== 2) {
    throw new Error(`Laya urgency out of range: ${String(urgency)}`);
  }

  const needsHuman = values.needs_human;
  if (typeof needsHuman !== "boolean") {
    throw new Error(`Laya needs_human is not a boolean: ${String(needsHuman)}`);
  }

  // Missing or non-numeric confidence counts as 0, which sends the task to a human.
  const raw = result.confidence?.agent_id;
  const confidence =
    typeof raw === "number" && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;

  return { agentId, urgency, needsHuman, confidence };
}

export type RouteOutcome = {
  stage: Extract<TaskStage, "Routed" | "Awaiting routing">;
  routingStatus: Extract<RoutingStatus, "routed" | "awaiting">;
  /** Shown at the human gate; null when the task routes straight through. */
  reason: string | null;
};

export function routeOutcome(decision: RouteDecision, threshold = ROUTE_CONFIDENCE_THRESHOLD): RouteOutcome {
  const reasons: string[] = [];
  if (decision.confidence < threshold) {
    reasons.push(
      `Keyakinan ${decision.confidence.toFixed(2)} di bawah ${threshold}`,
    );
  }
  if (decision.needsHuman) reasons.push("Laya menandai perlu manusia");

  return reasons.length === 0
    ? { stage: "Routed", routingStatus: "routed", reason: null }
    : { stage: "Awaiting routing", routingStatus: "awaiting", reason: reasons.join("; ") };
}

/* ------------------------------------------------------------------ */
/* Laya-backed router                                                  */
/* ------------------------------------------------------------------ */

/** One model per process. A failed load is not cached, so the next tick retries. */
let modelPromise: Promise<LayaAgent> | null = null;

function loadModel(): Promise<LayaAgent> {
  if (!modelPromise) {
    const path = process.env.NEIRO_LAYA_MODEL_PATH?.trim();
    if (!path) return Promise.reject(new Error("NEIRO_LAYA_MODEL_PATH is not set"));
    modelPromise = import("laya-ts")
      .then(({ Agent }) => Agent.load(path))
      .catch((err: unknown) => {
        modelPromise = null;
        throw err;
      });
  }
  return modelPromise;
}

/** Reject with a timeout error unless `work` settles within `ms`. Exported for tests. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Laya timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Tournament scores only describe the final round, so require human approval. */
export async function decideTournament(runner: unknown, task: MissionTask, agents: Agent[]): Promise<RouteDecision> {
  if (agents.length === 0) throw new Error("No enabled agents to route to");
  const { questionsFromJsonSchema, answersToJson, predictTournament } = await import("laya-ts");
  const questions = questionsFromJsonSchema(buildDecisionSchema(agents.slice(0, 1)));
  questions.agent_id = { ...questions.agent_id, criteria: Object.fromEntries(agents.map((agent) => [agent.id, `${agent.name} (${agent.role}): ${agent.specialty}`])) };
  const result = await predictTournament(runner, buildRouteText(task), questions, 16);
  const answers = result.answers as unknown as Record<string, Record<string, unknown>>;
  const chosen = answers.agent_id?.choice;
  if (typeof chosen !== "string" || !agents.some((agent) => agent.id === chosen)) throw new Error("Router chose an unknown agent");
  const values = answersToJson(answers, buildDecisionSchema(agents.filter((agent) => agent.id === chosen)));
  return parseDecision({ values, confidence: { agent_id: 0 } }, agents);
}

export function createLayaRouter(): TaskRouter {
  return {
    async decide(task, agents) {
      const schema = buildDecisionSchema(agents);
      const run = async () => {
        const model = await loadModel();
        if (agents.length > 32) return decideTournament(model, task, agents);
        // No minConfidence: it would project a low-confidence agent_id to null.
        const result = await model.decide(buildRouteText(task), schema, { returnDetails: true });
        return parseDecision(result, agents);
      };
      return withTimeout(run(), routerTimeoutMs());
    },
    async decideMany(tasks, agents) {
      const run = async () => {
        const model = await loadModel();
        if (agents.length > 32) {
          const decisions = await Promise.all(tasks.map((task) => decideTournament(model, task, agents)));
          return new Map(tasks.map((task, index) => [task.id, decisions[index]]));
        }
        const results = await model.decideBatch(tasks.map(buildRouteText), buildDecisionSchema(agents), { returnDetails: true });
        if (results.length !== tasks.length) throw new Error("Laya returned an incomplete batch");
        return new Map(tasks.map((task, index) => [task.id, parseDecision(results[index], agents)]));
      };
      return withTimeout(run(), routerTimeoutMs());
    },
  };
}

/** The cloud runner never forwards credentials or response bodies in errors. */
export function createJevPredictor() {
      const key = process.env.TYPESAFE_API_KEY?.trim();
      if (!key) throw new Error("TYPESAFE_API_KEY is not configured");
      const base = new URL(process.env.TYPESAFE_BASE_URL?.trim() || "https://api.typesafe.ai");
      if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new Error("Jev requires an HTTPS endpoint");
      const modelName = process.env.TYPESAFE_MODEL?.trim() || "jev-latest";
      return async (state: unknown, questions: Record<string, unknown>) => {
        const res = await fetch(`${base.toString().replace(/\/$/, "")}/v1/systemone`, {
          method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelName, state, questions }), signal: AbortSignal.timeout(routerTimeoutMs()),
        });
        if (!res.ok) throw new Error(`Jev request failed (HTTP ${res.status})`);
        const result: unknown = await res.json();
        if (!result || typeof result !== "object" || !("answers" in result) || !result.answers || typeof result.answers !== "object") throw new Error("Jev returned invalid answers");
        return result as { answers: Record<string, Record<string, unknown>> };
      };
}

export async function systemOneRunner() {
  if (!isRouterEnabled()) throw new Error("System One router is not configured");
  if (process.env.NEIRO_ROUTER_PROVIDER?.trim().toLowerCase() === "jev") return { predict: createJevPredictor() };
  return await loadModel();
}

/** Jev's API returns the same typed answer shapes used by laya-ts. */
export function createJevRouter(): TaskRouter {
  return {
    async decide(task, agents) {
      const { questionsFromJsonSchema, answersToJson } = await import("laya-ts");
      const predict = createJevPredictor();
      if (agents.length > 32) return decideTournament({ predict }, task, agents);
      const schema = buildDecisionSchema(agents);
      const answers = (await predict(buildRouteText(task), questionsFromJsonSchema(schema))).answers;
      const values = answersToJson(answers, schema);
      return parseDecision({ values, confidence: { agent_id: Number(answers.agent_id?.confidence ?? 0) } }, agents);
    },
  };
}

export function createConfiguredRouter(): TaskRouter {
  return process.env.NEIRO_ROUTER_PROVIDER?.trim().toLowerCase() === "jev" ? createJevRouter() : createLayaRouter();
}

export type RouterCalibrationRow = { laya_agent_id: string | null; human_agent_id: string | null; route_confidence: number | null };

/** Agreement is a proxy for correctness, not proof that an unreviewed choice was correct. */
export async function calibrateRouteOutcomes(rows: RouterCalibrationRow[]): Promise<{ accept: number; escalate: number; samples: number } | null> {
  const valid = rows.filter((row) => row.laya_agent_id && typeof row.route_confidence === "number" && Number.isFinite(row.route_confidence) && row.route_confidence >= 0 && row.route_confidence <= 1);
  if (!valid.length) return null;
  const { calibrateReliability } = await import("laya-ts");
  const [accept, escalate] = calibrateReliability(valid.map((row) => row.route_confidence as number), valid.map((row) => !row.human_agent_id || row.human_agent_id === row.laya_agent_id), { targetAccuracy: .9 });
  return { accept, escalate, samples: valid.length };
}

/** Load every completed routing outcome, not only the first database page. */
export async function calibrateRouterThreshold(supabase: import("@supabase/supabase-js").SupabaseClient) {
  const rows: RouterCalibrationRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("mission_tasks").select("laya_agent_id,human_agent_id,route_confidence").eq("stage", "Done").not("laya_agent_id", "is", null).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []) as RouterCalibrationRow[]);
    if ((data?.length ?? 0) < 1000) break;
  }
  return calibrateRouteOutcomes(rows);
}
