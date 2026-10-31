import "server-only";
import { execFile } from "node:child_process";
import { HermesSkillError } from "@/lib/hermes-skills";

/**
 * Restart the ONE local Hermes gateway (it serves every profile). Runs
 * `hermes gateway restart --detach`; without `--yes` Hermes refuses while
 * turns, cron jobs or delegations are live, because it has no terminal to ask.
 * The child gets a clean env so neiro's own secrets (Supabase keys etc.) never
 * end up in the gateway's environment.
 */

const PASS_ENV = ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR"];

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NO_COLOR: "1", TERM: "dumb" };
  for (const key of PASS_ENV) if (process.env[key]) env[key] = process.env[key];
  return env;
}

function restartCli(interrupt: boolean): Promise<string> {
  const args = ["gateway", "restart", "--detach", ...(interrupt ? ["--yes"] : [])];
  return new Promise((resolve, reject) => {
    const child = execFile("hermes", args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024, env: cleanEnv() }, (err, stdout, stderr) => {
      const text = String(stdout || "") + String(stderr || "");
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        reject(
          new HermesSkillError(
            code === "ENOENT"
              ? "The hermes CLI is not installed on this computer."
              : text.trim().split("\n").slice(-4).join(" ") || err.message,
            /live|interrupt|sessions? (are|is) running|refus/i.test(text) ? 409 : 500,
          ),
        );
        return;
      }
      resolve(text);
    });
    child.stdin?.end(""); // no terminal: a y/N prompt reads EOF and refuses
  });
}

async function waitHealthy(baseUrl: string, apiKey: string, timeoutMs = 45_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      });
      if (res.ok) return true;
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return false;
}

export async function restartHermesGateway(opts: { baseUrl: string; apiKey: string; interrupt: boolean }) {
  const started = Date.now();
  const out = await restartCli(opts.interrupt);
  // The CLI can return before the new process listens; give it a moment, then poll.
  await new Promise((r) => setTimeout(r, 1_500));
  const healthy = await waitHealthy(opts.baseUrl.replace(/\/+$/, ""), opts.apiKey);
  return {
    healthy,
    seconds: Math.round((Date.now() - started) / 1000),
    note: out.trim().split("\n").filter((l) => l.trim()).slice(-3).join("\n"),
  };
}
