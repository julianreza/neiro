import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { listCliRuntime } from "@/lib/cli-runtime";
import { listHermesModelOptions, probeHermesAgent, resolveAgentEndpoint } from "@/lib/hermes";
import { mapAgentRow } from "@/lib/orchestrator-store";
import { getSupabaseAdmin } from "@/lib/supabase";
import { asRuntime } from "@/lib/types";
import type { Agent, AgentStage } from "@/lib/types";
import type { MissionCreateInput } from "@/lib/mission-input";

export type PreflightCheck = { id: string; status: "pass" | "warning" | "blocked" | "unknown"; reason: string; href?: string };
export type PreflightResult = { checkedAt: string; checks: PreflightCheck[] };
type RuntimeInspection = { status: "pass" | "unknown" | "unavailable"; reason: string; model?: PreflightCheck };
type PreflightDeps = { inspectRuntime: (agent: Agent) => Promise<RuntimeInspection> };
const exec = promisify(execFile);

/** Uses the same stage and fullstack preference as the orchestrator. */
export function choosePreflightAgent(agents: Agent[], stage: AgentStage): Agent | undefined {
  const candidates = agents.filter((agent) => agent.enabled && agent.stage === stage);
  return candidates.find((agent) => agent.specialty.toLowerCase().includes("fullstack")) ?? candidates[0];
}

async function inspectRuntime(agent: Agent): Promise<RuntimeInspection> {
  if (asRuntime(agent.runtime) !== "hermes") {
    const info = await listCliRuntime("ohmypi").catch(() => null);
    if (!info) return { status: "unknown", reason: `${agent.name}: Oh My Pi readiness could not be checked.` };
    const status = !info.installed ? "unavailable" : info.reason ? "unknown" : "pass";
    const reason = !info.installed ? `${agent.name}: Oh My Pi is not installed.` : info.reason ? `${agent.name}: model availability could not be checked.` : `${agent.name}: Oh My Pi is installed.`;
    const found = info.models.some((model) => model.id === agent.model);
    const model = info.installed && agent.model ? { id: `model:${agent.id}`, status: info.reason || !info.models.length ? "unknown" as const : found ? "pass" as const : "warning" as const, reason: found ? `${agent.name}: configured model is listed.` : `${agent.name}: configured model could not be confirmed.`, href: "/gateway" } : undefined;
    return { status, reason, model };
  }
  try {
    await resolveAgentEndpoint(agent);
    const probe = await probeHermesAgent(agent);
    const authFailed = !probe.ok && /status (401|403)\b/.test(probe.error ?? "");
    const status = authFailed ? "unavailable" : !probe.ok || !probe.authVerified ? "unknown" : "pass";
    const reason = authFailed ? `${agent.name}: Hermes rejected authentication.` : !probe.ok ? `${agent.name}: Hermes readiness could not be confirmed.` : !probe.authVerified ? `${agent.name}: Hermes is reachable, but authentication could not be verified.` : `${agent.name}: Hermes is reachable and authenticated.`;
    let model: PreflightCheck | undefined;
    if (probe.ok && agent.model) {
      const catalog = await listHermesModelOptions(agent).catch(() => null);
      const found = catalog?.models.some((option) => option.id === agent.model);
      model = { id: `model:${agent.id}`, status: !catalog || !catalog.models.length ? "unknown" : found ? "pass" : "warning", reason: found ? `${agent.name}: configured model is listed.` : `${agent.name}: configured model could not be confirmed.`, href: "/gateway" };
    }
    return { status, reason, model };
  } catch {
    return { status: "unavailable", reason: `${agent.name}: Hermes URL or credentials are missing.` };
  }
}

export async function missionPreflight(input: MissionCreateInput, testAgents?: Agent[], deps: PreflightDeps = { inspectRuntime }): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const add = (id: string, status: PreflightCheck["status"], reason: string, href?: string) => checks.push({ id, status, reason, ...(href ? { href } : {}) });
  let repo = false;
  if (input.workspacePath) {
    const folder = await stat(input.workspacePath).catch(() => null);
    if (!folder?.isDirectory()) add("workspace", "blocked", "Workspace folder does not exist.", "/projects");
    else {
      add("workspace", "pass", "Workspace folder is available.");
      const git = async (args: string[]) => exec("git", ["-C", input.workspacePath!, ...args], { timeout: 5000 });
      repo = await git(["rev-parse", "--show-toplevel"]).then(() => true, () => false);
      if (input.baseBranch) {
        const valid = repo && await git(["rev-parse", "--verify", "--quiet", `${input.baseBranch}^{commit}`]).then(() => true, () => false);
        add("branch", valid ? "pass" : "blocked", valid ? "Base branch is available." : "Base branch does not exist in this repository.", "/projects");
      } else if (repo && input.isolateWorkspace) {
        const head = await git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).then(() => true, () => false);
        add("branch", head ? "pass" : "blocked", head ? "Base commit is available." : "The repository has no base commit.", "/projects");
      }
      if ((input.mode === "build" || input.mode === "fix") && repo) {
        const origin = await git(["remote", "get-url", "origin"]).then(() => true, () => false);
        add("origin", origin ? "pass" : "warning", origin ? "Git origin is configured." : "No Git origin: the draft PR may require attention.", "/projects");
        const PATH = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].filter(Boolean).join(":");
        const auth = await exec("gh", ["auth", "status"], { timeout: 5000, env: { ...process.env, PATH, GH_PROMPT_DISABLED: "1" } }).then(() => true, () => false);
        add("github", auth ? "pass" : "warning", auth ? "GitHub CLI is authenticated." : "GitHub CLI authentication could not be confirmed; draft PR creation may need attention.", "/reviews");
      }
    }
  } else add("workspace", "warning", "No workspace selected; the agent runtime will choose its working folder.", "/projects");

  if (!testAgents && repo && input.isolateWorkspace && input.maxParallelWorkers > 1) {
    const { error } = await getSupabaseAdmin().from("mission_tasks").select("task_worktree_path,task_branch,task_integration_pending").limit(1);
    if (error) add("task_isolation", "blocked", "Apply the Neiro v2 SQL migration before starting parallel isolated tasks.", "/gateway");
    else add("task_isolation", "pass", "Parallel task isolation is available.");
  }

  if (!testAgents) {
    const db = getSupabaseAdmin();
    const [missionSchema, taskSchema] = await Promise.all([
      db.from("missions").select("skip_qa,skip_review", { head: true }).limit(1),
      db.from("mission_tasks").select("verification_wait_stage", { head: true }).limit(1),
    ]);
    add("verification_schema", missionSchema.error || taskSchema.error ? "blocked" : "pass", missionSchema.error || taskSchema.error ? "Apply the verification consent SQL migration before starting missions." : "Verification consent can be saved.", "/gateway");
  }

  let agents = testAgents;
  if (!agents) {
    const { data, error } = await getSupabaseAdmin().from("agents").select("*").eq("enabled", true);
    if (error) throw new Error(error.message);
    agents = (data ?? []).map((row) => mapAgentRow(row));
  }
  const planner = choosePreflightAgent(agents, "orchestrator");
  const worker = choosePreflightAgent(agents, "workers") ?? planner;
  const parallelIsolation = repo && input.isolateWorkspace && input.maxParallelWorkers > 1;
  if (parallelIsolation && worker && asRuntime(worker.runtime) === "hermes") {
    add("task_runtime_isolation", "blocked", "The coding fallback uses Hermes, which cannot enforce a separate directory per task. Use one worker or an Oh My Pi coding agent.", "/agents");
  } else if (parallelIsolation && agents.some((agent) => agent.enabled && agent.stage === "workers" && asRuntime(agent.runtime) === "hermes")) {
    add("task_runtime_isolation", "warning", "A routed Hermes worker cannot enforce a separate task directory and will require attention. Use Oh My Pi workers for isolated tasks.", "/agents");
  }
  if (!planner) add("planner", "blocked", "No enabled orchestrator agent is available.", "/agents");
  else add("planner", "pass", `Planner: ${planner.name}.`);
  if (!worker) add("worker", "blocked", "No enabled coding agent or orchestrator fallback is available.", "/agents");
  else add("worker", "pass", `Coding fallback: ${worker.name}.`);
  const qa = choosePreflightAgent(agents, "qa");
  const reviewer = choosePreflightAgent(agents, "reviewer");
  const selected = [planner, worker, choosePreflightAgent(agents, "spec")].filter((agent): agent is Agent => Boolean(agent));
  const toInspect = [...new Map([...selected, qa, reviewer].filter((agent): agent is Agent => Boolean(agent)).map((agent) => [agent.id, agent])).values()];
  const inspections = new Map(await Promise.all(toInspect.map(async (agent) => [agent.id, await deps.inspectRuntime(agent)] as const)));
  for (const [stage, label, agent] of [["qa", "QA", qa], ["reviewer", "Review", reviewer]] as const) {
    if (!agent) add(stage, "warning", `No ${label} agent; this verification will be skipped.`, "/agents");
    else if (parallelIsolation && asRuntime(agent.runtime) === "hermes") add(stage, "warning", `${label} uses Hermes, which cannot enforce the task directory. ${label} will be skipped if you continue without verification.`, "/agents");
    else {
      const state = inspections.get(agent.id)!;
      add(stage, state.status === "unavailable" ? "warning" : state.status, state.status === "unavailable" ? `${state.reason} ${label} will be skipped if you continue without verification.` : state.reason, "/agents");
      if (state.model) checks.push(state.model);
    }
  }
  for (const agent of [...new Map(selected.map((agent) => [agent.id, agent])).values()]) {
    const state = inspections.get(agent.id)!;
    add(`runtime:${agent.id}`, state.status === "unavailable" ? "blocked" : state.status, state.reason, "/gateway");
    if (state.model) checks.push(state.model);
  }
  return { checkedAt: new Date().toISOString(), checks };
}
