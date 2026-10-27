/**
 * Scripted Hermes client for engine tests. Not imported by app code.
 *
 * Runs start as "running" and stay that way until a test calls setRun(),
 * so tests control exactly when a run finishes. startRun dedupes by
 * idempotency key, like the real Hermes server.
 */
import type {
  HermesRunStatus,
  HermesStartRunInput,
  HermesStartRunResult,
} from "../hermes";
import type { HermesClient } from "../orchestrator";
import type { Agent } from "../types";

const yieldTick = () => Promise.resolve();

export type RecordedStart = {
  agentId: string;
  runId: string;
  idempotencyKey?: string;
  prompt: string;
};

export class FakeHermes implements HermesClient {
  starts: RecordedStart[] = [];
  runs = new Map<string, HermesRunStatus>();
  /** When set, the next startRun calls return `deferred` (429/503 behaviour). */
  deferStarts = false;
  private byKey = new Map<string, string>();
  private seq = 0;

  startRun = async (agent: Agent, input: HermesStartRunInput): Promise<HermesStartRunResult> => {
    await yieldTick();
    if (this.deferStarts) return { kind: "deferred", reason: "busy" };
    const key = input.idempotencyKey;
    if (key && this.byKey.has(key)) {
      return { kind: "started", runId: this.byKey.get(key)! };
    }
    const runId = `run-${++this.seq}`;
    if (key) this.byKey.set(key, runId);
    this.runs.set(runId, { run_id: runId, status: "running" });
    this.starts.push({ agentId: agent.id, runId, idempotencyKey: key, prompt: input.prompt });
    return { kind: "started", runId };
  };

  getRun = async (_agent: Agent, runId: string): Promise<HermesRunStatus> => {
    await yieldTick();
    return (
      this.runs.get(runId) ?? { run_id: runId, status: "expired_404", error: "not found" }
    );
  };

  createSession = async (): Promise<string> => {
    await yieldTick();
    return "session-test";
  };

  /** Create or update a run's status/output, e.g. to complete it. */
  setRun(runId: string, patch: Partial<HermesRunStatus>): void {
    const current = this.runs.get(runId) ?? { run_id: runId, status: "running" };
    this.runs.set(runId, { ...current, ...patch });
  }

  startsWithKeyPrefix(prefix: string): RecordedStart[] {
    return this.starts.filter((s) => s.idempotencyKey?.startsWith(prefix));
  }
}
