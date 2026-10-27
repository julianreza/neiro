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
  return Boolean(env.NEIRO_LAYA_MODEL_PATH?.trim());
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

export function routeOutcome(decision: RouteDecision): RouteOutcome {
  const reasons: string[] = [];
  if (decision.confidence < ROUTE_CONFIDENCE_THRESHOLD) {
    reasons.push(
      `Keyakinan ${decision.confidence.toFixed(2)} di bawah ${ROUTE_CONFIDENCE_THRESHOLD}`,
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

export function createLayaRouter(): TaskRouter {
  return {
    async decide(task, agents) {
      const schema = buildDecisionSchema(agents);
      const run = async () => {
        const model = await loadModel();
        // No minConfidence: it would project a low-confidence agent_id to null.
        const result = await model.decide(buildRouteText(task), schema, { returnDetails: true });
        return parseDecision(result, agents);
      };
      return withTimeout(run(), routerTimeoutMs());
    },
  };
}
