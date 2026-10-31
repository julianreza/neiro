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
const exec = promisify(execFile);

/** Uses the same stage and fullstack preference as the orchestrator. */
export function choosePreflightAgent(agents: Agent[], stage: AgentStage): Agent | undefined {
  const candidates = agents.filter((agent) => agent.enabled && agent.stage === stage);
  return candidates.find((agent) => agent.specialty.toLowerCase().includes("fullstack")) ?? candidates[0];
}

export async function missionPreflight(input: MissionCreateInput, testAgents?: Agent[]): Promise<PreflightResult> {
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
        const auth = await exec("gh", ["auth", "status"], { timeout: 5000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } }).then(() => true, () => false);
        add("github", auth ? "pass" : "warning", auth ? "GitHub CLI is authenticated." : "GitHub CLI authentication could not be confirmed; draft PR creation may need attention.", "/reviews");
      }
    }
  } else add("workspace", "warning", "No workspace selected; the agent runtime will choose its working folder.", "/projects");

  let agents = testAgents;
  if (!agents) {
    const { data, error } = await getSupabaseAdmin().from("agents").select("*").eq("enabled", true);
    if (error) throw new Error(error.message);
    agents = (data ?? []).map((row) => mapAgentRow(row));
  }
  const planner = choosePreflightAgent(agents, "orchestrator");
  const worker = choosePreflightAgent(agents, "workers") ?? planner;
  if (!planner) add("planner", "blocked", "No enabled orchestrator agent is available.", "/agents");
  else add("planner", "pass", `Planner: ${planner.name}.`);
  if (!worker) add("worker", "blocked", "No enabled coding agent or orchestrator fallback is available.", "/agents");
  else add("worker", "pass", `Coding fallback: ${worker.name}.`);
  for (const [stage, label] of [["qa", "QA"], ["reviewer", "Review"]] as const) {
    const agent = choosePreflightAgent(agents, stage);
    add(stage, agent ? "pass" : "warning", agent ? `${label} agent: ${agent.name}.` : `No ${label} agent; this verification will be skipped.`, "/agents");
  }
  const selected = [planner, worker, choosePreflightAgent(agents, "spec")].filter((agent): agent is Agent => Boolean(agent));
  for (const agent of [...new Map(selected.map((agent) => [agent.id, agent])).values()]) {
    if (asRuntime(agent.runtime) !== "hermes") {
      const info = await listCliRuntime("ohmypi");
      add(`runtime:${agent.id}`, !info.installed ? "blocked" : info.reason ? "unknown" : "pass", !info.installed ? `${agent.name}: Oh My Pi is not installed.` : info.reason ? `${agent.name}: model availability could not be checked.` : `${agent.name}: Oh My Pi is installed.`, "/gateway");
      if (info.installed && agent.model) {
        const found = info.models.some((model) => model.id === agent.model);
        add(`model:${agent.id}`, info.reason || info.models.length === 0 ? "unknown" : found ? "pass" : "warning", found ? `${agent.name}: configured model is listed.` : `${agent.name}: configured model could not be confirmed.`, "/gateway");
      }
      continue;
    }
    try {
      resolveAgentEndpoint(agent);
      const probe = await probeHermesAgent(agent);
      const authFailed = !probe.ok && /status (401|403)\b/.test(probe.error ?? "");
      add(`runtime:${agent.id}`, authFailed ? "blocked" : probe.ok ? "pass" : "unknown", probe.ok ? `${agent.name}: Hermes is reachable.` : authFailed ? `${agent.name}: Hermes rejected authentication.` : `${agent.name}: Hermes readiness could not be confirmed.`, "/gateway");
      if (probe.ok && agent.model) {
        const catalog = await listHermesModelOptions(agent).catch(() => null);
        const found = catalog?.models.some((model) => model.id === agent.model);
        add(`model:${agent.id}`, !catalog || !catalog.models.length ? "unknown" : found ? "pass" : "warning", found ? `${agent.name}: configured model is listed.` : `${agent.name}: configured model could not be confirmed.`, "/gateway");
      }
    } catch {
      add(`runtime:${agent.id}`, "blocked", `${agent.name}: Hermes URL or credentials are missing.`, "/gateway");
    }
  }
  return { checkedAt: new Date().toISOString(), checks };
}
