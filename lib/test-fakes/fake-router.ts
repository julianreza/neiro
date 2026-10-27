/**
 * Scripted task router for engine tests. Not imported by app code.
 *
 * `next` decides what each call returns: a decision, or an Error to reject
 * with (Laya failure / timeout). Each call yields first, so two concurrent
 * ticks interleave around it the way they would around the real model.
 */
import type { RouteDecision, TaskRouter } from "../task-router";
import type { Agent, MissionTask } from "../types";

export class FakeRouter implements TaskRouter {
  calls: { taskId: string; agentIds: string[] }[] = [];

  constructor(public next: RouteDecision | Error) {}

  decide = async (task: MissionTask, agents: Agent[]): Promise<RouteDecision> => {
    this.calls.push({ taskId: task.id, agentIds: agents.map((a) => a.id) });
    await Promise.resolve();
    await Promise.resolve();
    if (this.next instanceof Error) throw this.next;
    return { ...this.next };
  };
}
