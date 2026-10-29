# Neiro — Paperclip-Style AI Team Orchestrator UI (Next.js 16 + Hermes VPS + 9Router + Supabase)

## Context

Build **Neiro**, a Vercel-deployed Next.js 16 management and orchestration dashboard in this repository that coordinates a Paperclip-style team of **Hermes Agents** running on Tencent Cloud VPS, all routing LLM inference through a single **9Router** gateway, with state persisted in **Supabase Postgres**. From a single user prompt, Neiro drives an autonomous pipeline—**PM Orchestrator** decomposes work into a task DAG, **Spec Writer** produces `PRD.md` and requirements, **Worker Agents** execute independent tasks in parallel on Hermes, **QA Inspector** verifies each completed task, and **Lead Reviewer** performs final approval (automatically looping failures back to Workers up to a retry cap before escalating to human review)—alongside full Agent CRUD, Hermes Cron/Scheduled Jobs ("Time AI") management, live SSE run/tool streaming, and 9Router model/health monitoring behind a single-admin passcode gate.

## Approach

### Step 1: Dependencies, Environment Contract, and Supabase Schema

Install the four runtime packages required for Supabase persistence, icons, and GitHub-flavored Markdown artifact rendering (no ORM codegen, no auth framework):

```bash
bun add @supabase/supabase-js lucide-react react-markdown remark-gfm
```

Create `.env.example` documenting all server-only environment variables (zero `NEXT_PUBLIC_*` secrets):

```dotenv
# Admin passcode gate (minimum 8 characters)
DASHBOARD_SECRET=change-me-admin-passcode

# Supabase (server-side service role only)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Default Tencent Cloud VPS Hermes API Server (API_SERVER_ENABLED=true)
HERMES_DEFAULT_URL=https://hermes-vps.example.com
HERMES_DEFAULT_KEY=hermes-api-server-key-min-16-chars
# Optional provider slug if Hermes config.yaml requires explicit provider override; leave blank to use profile default pointing at 9Router
HERMES_PROVIDER_SLUG=
```

Create `supabase/schema.sql` containing idempotent DDL (`CREATE TABLE IF NOT EXISTS`, indexes, `updated_at` trigger) and `ON CONFLICT (slug) DO NOTHING` seed rows for the 6 default Paperclip-style agents:

- **`agents`**:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `slug text NOT NULL UNIQUE`
  - `name text NOT NULL`
  - `role_stage text NOT NULL CHECK (role_stage IN ('orchestrator', 'spec', 'worker', 'qa', 'reviewer', 'cron'))`
  - `specialty text NOT NULL DEFAULT 'fullstack'` (`'product' | 'architecture' | 'backend' | 'frontend' | 'fullstack' | 'devops' | 'research' | 'content' | 'qa' | 'security-review'`)
  - `avatar_color text NOT NULL DEFAULT '#3b82f6'`
  - `model text NOT NULL` (9Router model ID such as `'claude-sonnet-4-5'` or `'openai/gpt-5'`)
  - `system_prompt text NOT NULL`
  - `hermes_profile text NOT NULL DEFAULT 'default'` (`'default'` routes to `/v1/...`; any other value routes to `/p/<hermes_profile>/v1/...`)
  - `custom_base_url text` (nullable; overrides `HERMES_DEFAULT_URL` for multi-VPS setups)
  - `custom_api_key text` (nullable; write-only in API, never returned to client—masked as `has_custom_key: boolean`)
  - `enabled boolean NOT NULL DEFAULT true`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `updated_at timestamptz NOT NULL DEFAULT now()`
  - Seed 6 starter rows: `pm-orchestrator` (`orchestrator`, `product`), `spec-writer` (`spec`, `architecture`), `backend-worker` (`worker`, `backend`), `frontend-worker` (`worker`, `frontend`), `qa-inspector` (`qa`, `qa`), and `lead-reviewer` (`reviewer`, `security-review`).
- **`missions`**:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `title text NOT NULL`
  - `prompt text NOT NULL`
  - `workspace_path text` (nullable; optional folder/repo path on Tencent VPS, e.g. `/root/projects/app`)
  - `pause_after_planning boolean NOT NULL DEFAULT false`
  - `max_parallel_workers int NOT NULL DEFAULT 3 CHECK (max_parallel_workers BETWEEN 1 AND 10)`
  - `max_retries int NOT NULL DEFAULT 2 CHECK (max_retries BETWEEN 0 AND 5)`
  - `status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'writing_spec', 'awaiting_plan_approval', 'running', 'summarizing', 'needs_you', 'completed', 'failed', 'cancelled'))`
  - `summary_run_id text`, `summary_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL`
  - `orchestrator_run_id text`, `orchestrator_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL`
  - `spec_run_id text`, `spec_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL`
  - `error_message text`
  - `total_tokens int NOT NULL DEFAULT 0`
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
- **`mission_tasks`**:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE`
  - `task_key text NOT NULL` (`'T1'`, `'T2'`, …; `UNIQUE (mission_id, task_key)`)
  - `title text NOT NULL`, `description text NOT NULL`
  - `specialty text NOT NULL DEFAULT 'fullstack'`
  - `depends_on text[] NOT NULL DEFAULT '{}'` (list of upstream `task_key`s in the same mission)
  - `stage text NOT NULL DEFAULT 'queued' CHECK (stage IN ('queued', 'coding', 'qa', 'review', 'done', 'needs_you', 'failed', 'cancelled'))`
  - `assigned_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL`
  - `hermes_session_id text` (persisted across Worker retries so the Worker retains full transcript context on fixes)
  - `active_run_id text`
  - `active_run_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL` (required because Hermes `/v1/runs/{id}` is scoped to the exact profile & `API_SERVER_KEY` that started the run)
  - `retry_count int NOT NULL DEFAULT 0`
  - `worker_output text`, `qa_feedback text`, `review_feedback text`
  - `pending_approval jsonb` (stores Hermes `pending_controls` object when `status === 'waiting_for_approval'`)
  - `total_tokens int NOT NULL DEFAULT 0`, `sort_order int NOT NULL DEFAULT 0`
  - `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
- **`mission_artifacts`**:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `mission_id uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE`
  - `task_id uuid REFERENCES mission_tasks(id) ON DELETE CASCADE`
  - `agent_id uuid REFERENCES agents(id) ON DELETE SET NULL`
  - `kind text NOT NULL CHECK (kind IN ('task_plan', 'prd', 'deliverable', 'qa_report', 'review_report', 'mission_summary'))`
  - `title text NOT NULL`, `content_md text NOT NULL`, `verdict text`
  - `created_at timestamptz NOT NULL DEFAULT now()`

End `supabase/schema.sql` with `ALTER TABLE agents ENABLE ROW LEVEL SECURITY;` (and the same for `missions`, `mission_tasks`, `mission_artifacts`) and **no policies**. Reason: Supabase exposes the `public` schema to the anon key through PostgREST; without RLS anyone holding the project URL + anon key could read `agents.custom_api_key`. The service-role key used by `lib/supabase.ts` bypasses RLS, so app code is unaffected.

Create `lib/types.ts` (shared TypeScript domain types + DTOs with `AgentPublic` omitting `custom_api_key` and exposing `has_custom_key: boolean`) and `lib/supabase.ts` exporting `getSupabaseAdmin()` using `createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })`. When `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing, throw `new AppConfigError("missing_supabase_env", "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment variables")` so Route Handlers return structured HTTP `503` JSON instead of crashing.

### Step 2: Passcode Auth Gate (`lib/auth.ts`, `proxy.ts`, `app/api/auth/route.ts`, `app/login/page.tsx`)

No existing auth helpers exist in repo; implement stateless HMAC-SHA256 cookie auth via Web Crypto (`crypto.subtle`) so zero external auth dependencies are needed:

- Create `lib/auth.ts`:
  - `SESSION_COOKIE = "neiro_session"`, TTL `7 * 24 * 60 * 60 * 1000` ms.
  - `signSessionToken(secret: string, expiresAtMs?: number): Promise<string>` → returns `${exp}.${hmacHex}` signing `"neiro-v1:${exp}"` with HMAC-SHA256.
  - `verifySessionToken(token: string | undefined, secret: string | undefined): Promise<boolean>` → returns `false` if `!secret || secret.length < 8 || !token`, checks `exp > Date.now()`, recomputes HMAC, and compares bytes in constant time.
  - `isAuthorizedRequest(request: NextRequest): Promise<boolean>` → accepts valid `neiro_session` cookie OR (specifically for `/api/orchestrator/tick` headless VPS cron calls) `Authorization: Bearer <DASHBOARD_SECRET>` matching in constant time.
- Create `proxy.ts` at repo root (Next.js 16 convention replacing deprecated `middleware.ts`; **do not** export `runtime`):
  - `export async function proxy(request: NextRequest)` with `export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"] }`.
  - Allow `/login` and `/api/auth` unconditionally.
  - If `!(await isAuthorizedRequest(request))`: for `/api/*` return `NextResponse.json({ error: "Unauthorized" }, { status: 401 })`; for page routes redirect `307` to `/login?next=${encodeURIComponent(pathname)}`.
- Create `app/api/auth/route.ts`:
  - `POST(request: NextRequest)`: reads `{ passcode: string }`; if `!process.env.DASHBOARD_SECRET || process.env.DASHBOARD_SECRET.length < 8`, returns `503` `{ error: "DASHBOARD_SECRET (min 8 chars) is not configured on server" }`. On mismatch returns `401` `{ error: "Invalid passcode" }`. On match sets HTTP-only cookie `neiro_session` (`httpOnly: true`, `sameSite: "lax"`, `secure: process.env.NODE_ENV === "production"`, `path: "/"`, `maxAge: 604800`) and returns `200` `{ ok: true }`.
  - `DELETE()`: clears `neiro_session` cookie and returns `{ ok: true }`.
- Create `app/login/page.tsx`: dark minimal passcode form submitting to `POST /api/auth` and navigating to `next` query param (wrapped in `<Suspense>` per Next.js 16 `cacheComponents: true`).

### Step 3: Server-Side Hermes VPS Client & 9Router Gateway Client (`lib/hermes.ts`, `lib/ninerouter.ts`)

All VPS and 9Router calls run exclusively on the Next.js server so API keys never leave Vercel:

- Create `lib/hermes.ts`:
  - `resolveAgentEndpoint(agent?: Pick<AgentRow, "hermes_profile" | "custom_base_url" | "custom_api_key"> | null)`:
    - `baseUrl = (agent?.custom_base_url?.trim() || process.env.HERMES_DEFAULT_URL?.trim() || "").replace(/\/+$/, "")`
    - `apiKey = agent?.custom_api_key?.trim() || process.env.HERMES_DEFAULT_KEY?.trim() || ""`
    - `profilePrefix = agent?.hermes_profile && agent.hermes_profile !== "default" ? `/p/${encodeURIComponent(agent.hermes_profile)}` : ""`
    - Throws `AppConfigError("missing_hermes_env", ...)` if `!baseUrl || !apiKey`.
  - Implement typed wrappers (15s timeout via `AbortSignal.timeout(15_000)` on JSON calls; streaming calls pass caller `AbortSignal`):
    - `probeHermesAgent(agent)` → calls `GET ${profilePrefix}/health/detailed` and `GET ${profilePrefix}/v1/capabilities`, returning `{ ok, status, capabilities, details, latencyMs }`.
    - `listHermesCapabilitiesInventory(agent)` → parallel `GET ${profilePrefix}/v1/skills` and `GET ${profilePrefix}/v1/toolsets` (returns empty arrays on `404` if disabled on an older Hermes version).
    - `createHermesSession(agent, title: string)` → `POST ${profilePrefix}/api/sessions` then `PATCH ${profilePrefix}/api/sessions/${id}` with `{ title }`, returning `sessionId`.
    - `getHermesSessionMessages(agent, sessionId: string)` → `GET ${profilePrefix}/api/sessions/${encodeURIComponent(sessionId)}/messages?inline_images=false`.
    - `startHermesRun(agent, params: { input: string; instructions: string; model: string; sessionId?: string; idempotencyKey: string })` → `POST ${profilePrefix}/v1/runs` with header `Idempotency-Key: ${params.idempotencyKey}` and body `{ input, instructions, model, ...(params.sessionId ? { session_id: params.sessionId } : {}), ...(process.env.HERMES_PROVIDER_SLUG ? { provider: process.env.HERMES_PROVIDER_SLUG } : {}) }`.
      - Handle HTTP `429` (concurrent run cap reached) and HTTP `503` (`runtime_draining` / `storage_unavailable`): return `{ kind: "deferred", reason: text }` without failing the task so the next tick retries cleanly.
      - Handle HTTP `200`/`201`/`202`: return `{ kind: "started", runId: data.run_id }`.
    - `getHermesRun(agent, runId: string)` → `GET ${profilePrefix}/v1/runs/${encodeURIComponent(runId)}` returning normalized `{ run_id, status, output, usage, runtime, pending_controls, admission_id, execution_generation, error }`.
    - `openHermesRunEventStream(agent, runId: string, signal: AbortSignal)` → `GET ${profilePrefix}/v1/runs/${encodeURIComponent(runId)}/events` with `Accept: text/event-stream`, returning upstream `Response` body stream.
    - `stopHermesRun(agent, runId: string)` → `POST ${profilePrefix}/v1/runs/${encodeURIComponent(runId)}/stop`.
    - `submitHermesRunApproval(agent, runId: string, payload: { request_id: string; execution_generation: number; choice: "once" | "always" | "deny" })` → `POST ${profilePrefix}/v1/runs/${encodeURIComponent(runId)}/approval`.
    - `submitHermesRunClarify(agent, runId: string, payload: { request_id: string; execution_generation: number; answer: string })` → `POST ${profilePrefix}/v1/runs/${encodeURIComponent(runId)}/clarify`.
    - `resolveHermesUnknownRun(agent, runId: string, payload: { admission_id: string; execution_generation: number })` → `POST ${profilePrefix}/v1/runs/${encodeURIComponent(runId)}/resolve-unknown`.
    - `hermesJobsRequest(agent, method, subpath, body?)` → wraps `/api/jobs`, `/api/jobs/${id}`, `/api/jobs/${id}/pause`, `/resume`, and `/run`.
- Create `lib/ninerouter.ts`:
  - `getNineRouterStatus()` → calls `GET ${url}/api/health` + `GET ${url}/v1/models`, returning `{ ok, latencyMs, models: Array<{ id: string; owned_by: string; kind?: string }>, error?: string }`.
  - `listNineRouterModelsByKind(kind?: "image" | "tts" | "embedding" | "web" | "stt" | "image-to-text")` → `GET ${url}/v1/models${kind ? `/${kind}` : ""}`.

### Step 4: Deterministic Autonomous Pipeline Engine (`lib/orchestrator.ts`)

Implement the state machine that turns 1 prompt into an end-to-end multi-agent workflow without risking Vercel serverless timeouts (every step dispatches non-blocking Hermes `/v1/runs` and reconciles on tick):

- **Structured Output Parsers (`lib/orchestrator-parsers.ts`)**:
  - `extractPlanFromOrchestratorOutput(raw: string, fallbackPrompt: string)`: extracts fenced ` ```json ... ``` ` or outermost `{ ... }` object matching `{ missionTitle?: string, summary?: string, tasks: Array<{ taskKey: string, title: string, description: string, specialty?: string, dependsOn?: string[] }> }`. Sanitizes `taskKey` (`T1..TN`), strips self-dependencies/unknown `dependsOn` keys, and detects cycles via Kahn's topological sort (breaking any cycle by clearing invalid `dependsOn` edge). Fallback if output contains zero valid tasks: synthesizes a single `T1` (`specialty: "fullstack"`, `dependsOn: []`) from `fallbackPrompt` so a mission never stalls on LLM formatting quirks.
  - `extractGateVerdict(raw: string, passToken: "PASS" | "APPROVED", failToken: "FAIL" | "CHANGES_REQUESTED")`: scans the last 15 lines first (then full text) for `VERDICT:\s*(PASS|FAIL|APPROVED|CHANGES_REQUESTED)` case-insensitively; if absent, defaults conservatively to `failToken` so unverified work never slips past QA/Review silently.
- **Agent Selection Helpers**:
  - `pickStageAgent(agents, roleStage, preferredSpecialty?, activeTasks?)`: filters `enabled === true && role_stage === roleStage`; candidates = exact `specialty` match, else `specialty === 'fullstack'`, else all stage agents; among candidates pick the one with the fewest tasks where `active_run_agent_id === agent.id` (least-loaded; tie → oldest `created_at`). Returns `null` when no candidate exists; caller then leaves the task `queued` and sets `mission.error_message = "No enabled <roleStage> agent"` so the UI shows why nothing runs. (The `agents` table has no `sort_order` column — do not add one.)
- **`advanceMission(missionId: string): Promise<MissionDetailDTO>`**:
  1. Load `mission`, `tasks`, `artifacts`, and all `agents` (including server-side `custom_api_key`). Return immediately if `mission.status` is terminal (`completed | failed | cancelled`) or `awaiting_plan_approval`.
  2. **Stage `planning`**:
     - If `!mission.orchestrator_run_id`: pick `orchestrator` agent (fallback: first enabled agent; none → `status = 'failed'`, `error_message = "No enabled agents"`), start Hermes run with `idempotencyKey = "neiro-${mission.id}-plan"` (concurrent ticks are safe: Hermes replays the same `run_id` for an identical keyed request with HTTP 202 `Idempotency-Replayed: true`, so no DB claim is needed here) instructing the agent to output executive scope + JSON `tasks[]` (`1..12` tasks, marking independent work with `"dependsOn": []` for parallel execution, naming `specialty` from available worker specialties, and honoring `workspace_path` if set). Persist `orchestrator_run_id` and `orchestrator_agent_id`.
     - Else poll `getHermesRun(orchestratorAgent, mission.orchestrator_run_id)`:
       - On `completed`: parse plan JSON, insert `mission_artifacts` (`kind: 'task_plan'`), bulk-insert `mission_tasks` (`stage: 'queued'`), increment `total_tokens`. Pick `spec` agent:
         - If enabled `spec` agent exists: start Hermes run (`idempotencyKey = "neiro-${mission.id}-spec"`) passing prompt + JSON task list + `workspace_path` to produce comprehensive `PRD.md` (goals, functional requirements, architecture/file paths, acceptance criteria per `taskKey`), and transition `mission.status = 'writing_spec'`.
         - If no `spec` agent exists: transition directly to `awaiting_plan_approval` (when `pause_after_planning` is `true`) or `running` (when `false`).
       - On `failed | cancelled | interrupted`: mark `mission.status = 'failed'`, save `error_message`.
  3. **Stage `writing_spec`**:
     - Poll `getHermesRun(specAgent, mission.spec_run_id)`.
     - On `completed`: insert `mission_artifacts` (`kind: 'prd'`, `title: 'PRD & Requirements Specification'`, `content_md: run.output`), increment `total_tokens`, clear `spec_run_id = null`, and set `mission.status = mission.pause_after_planning ? 'awaiting_plan_approval' : 'running'`. If `'running'`, continue immediately into Step 4 in the same invocation.
     - On `failed | cancelled | interrupted`: mark `mission.status = 'failed'`, save `error_message`.
  4. **Stage `running` (Parallel Execution + Auto QA + Auto Reviewer)**:
     - **4a. Reconcile all tasks with `active_run_id !== null`** in parallel:
       - Poll `getHermesRun(runAgent, task.active_run_id)`.
       - If `status === 'waiting_for_approval'` or `pending_controls` non-empty: update `mission_tasks.pending_approval` so UI displays approval controls.
       - If `status === 'unknown'` and `admission_id` + `execution_generation` exist: call `resolveHermesUnknownRun`, clear `active_run_id = null`, and if `retry_count < mission.max_retries` re-queue (`stage: 'queued'`, `retry_count + 1`), else set `stage: 'needs_you'`.
       - If `status === 'completed'`:
         - Clear `active_run_id = null`, `pending_approval = null`, add run tokens to task & mission `total_tokens`.
         - **`task.stage === 'coding'`**: store `worker_output = run.output`, insert `deliverable` artifact. Look up enabled `qa` agent:
           - If present: start QA Hermes run (`idempotencyKey = "neiro-${task.id}-qa-${task.retry_count}"`) with `PRD`, task spec, `workspace_path`, and `worker_output`, requiring `VERDICT: PASS` or `VERDICT: FAIL` on final line; set `stage = 'qa'`, `active_run_id`, `active_run_agent_id`.
           - Else if enabled `reviewer` agent exists: dispatch Reviewer directly (`stage = 'review'`).
           - Else: set `stage = 'done'`.
         - **`task.stage === 'qa'`**: extract `PASS | FAIL` verdict, store `qa_feedback`, insert `qa_report` artifact (`verdict`).
           - If `PASS`: if enabled `reviewer` agent exists, start Reviewer Hermes run (`idempotencyKey = "neiro-${task.id}-review-${task.retry_count}"`) requiring `VERDICT: APPROVED` or `VERDICT: CHANGES_REQUESTED` on final line and set `stage = 'review'`; else set `stage = 'done'`.
           - If `FAIL`: if `task.retry_count < mission.max_retries`, update `stage = 'queued'`, `retry_count = task.retry_count + 1`; else update `stage = 'needs_you'`.
         - **`task.stage === 'review'`**: extract `APPROVED | CHANGES_REQUESTED` verdict, store `review_feedback`, insert `review_report` artifact (`verdict`).
           - If `APPROVED`: set `stage = 'done'`.
           - If `CHANGES_REQUESTED`: if `task.retry_count < mission.max_retries`, update `stage = 'queued'`, `retry_count = task.retry_count + 1`; else update `stage = 'needs_you'`.
       - If `status in ('failed', 'cancelled', 'interrupted')`: clear `active_run_id = null`; set `stage = status === 'cancelled' ? 'cancelled' : 'needs_you'` and append error notice to feedback so user can inspect or click **Retry**.
       - **Compare-and-set every transition**: every `UPDATE mission_tasks` in 4a includes `WHERE id = $id AND active_run_id = $observedRunId` and uses `.select()`; if 0 rows return, another tick already handled this run → skip artifact inserts and follow-up dispatch. Same rule for `missions` in stages 2–3 (`WHERE orchestrator_run_id = $observed` / `spec_run_id = $observed`). Without this, a browser tab and the VPS cron ticking together insert duplicate artifacts and double-increment `retry_count`.
       - **Run record expired (HTTP 404 from `getHermesRun`)**: Hermes keeps terminal run statuses only briefly, so a mission left with no open tab and no cron can lose them. Handling: if the task has `hermes_session_id` (coding stage), call `getHermesSessionMessages` and, if the last message is `role: "assistant"`, treat its text as `run.output` with `status = 'completed'` and zero tokens; otherwise (QA/review runs have no session, or no assistant message) clear `active_run_id` and re-queue the current stage with the same retry semantics as `FAIL` (`retry_count + 1`, or `needs_you` at the cap). For missions in `planning`/`writing_spec`, 404 → clear the run id so the next tick restarts that stage with key suffix `-r${Date.now()}`.
       - **Prompt size cap**: when building any QA/Reviewer/Worker prompt, truncate `PRD` to 24 000 chars, each upstream dependency output to 4 000 chars, and `worker_output`/feedback to 12 000 chars using `truncateMiddle(text, max)` (keep head and tail, insert `\n…[truncated N chars]…\n`). Store full text in Supabase untouched.
     - **4b. Dispatch Ready Queued Tasks in Parallel**:
       - Re-read current `tasks` state; compute `doneKeys = new Set(tasks.filter(t => t.stage === 'done').map(t => t.task_key))`.
       - `activeCoding = tasks.filter(t => t.stage === 'coding' && t.active_run_id !== null).length`.
       - `freeSlots = Math.max(0, mission.max_parallel_workers - activeCoding)`.
       - Filter `readyTasks = tasks.filter(t => t.stage === 'queued' && t.active_run_id === null && t.depends_on.every(dep => doneKeys.has(dep))).slice(0, freeSlots)`.
       - For each `task` in `readyTasks` concurrently:
         - Atomically claim (`UPDATE mission_tasks SET stage = 'coding', updated_at = now() WHERE id = $1 AND stage = 'queued' AND active_run_id IS NULL RETURNING *`); skip if 0 rows returned.
         - Select Worker agent via `pickStageAgent(agents, 'worker', task.specialty)`.
         - Ensure `hermes_session_id` (reuse existing `task.hermes_session_id` on retries; otherwise call `createHermesSession(worker, "[NEIRO:" + mission.id.slice(0, 8) + ":" + task.task_key + "] " + task.title)`).
         - Build Worker prompt containing: `workspace_path` directive (if set), `PRD` document, task `title` + `description`, concise outputs of direct `depends_on` tasks, and—when `retry_count > 0`—the exact `qa_feedback` and `review_feedback` that must be resolved. When `workspace_path` is set, append this fixed instruction so parallel workers do not overwrite each other: `"If ${workspace_path} is a git repository, work only in a dedicated worktree: git -C ${workspace_path} worktree add ${workspace_path}/.neiro/${task_key} -b neiro/${missionShortId}/${task_key} (reuse it if it exists), commit your changes on that branch, and report the branch name and changed files in your final answer. Never commit to the main branch."` QA and Reviewer prompts reference that same worktree path.
         - Call `startHermesRun` with `idempotencyKey = "neiro-${task.id}-code-${task.retry_count}"`. If `{ kind: "deferred" }`, revert `stage = 'queued'` cleanly for next tick; if `{ kind: "started" }`, save `active_run_id`, `active_run_agent_id`, `assigned_agent_id`, `hermes_session_id`.
     - **4c. Roll up Mission Terminal / Escalation Status**:
       - If `tasks.length > 0 && tasks.every(t => t.stage === 'done')`: pick enabled `reviewer` agent (fallback: `orchestrator` agent; neither → set `completed` directly). Start a Hermes run (`idempotencyKey = "neiro-${mission.id}-summary"`) whose input lists every task (`task_key`, title, final `worker_output` truncated to 4 000 chars, QA/review verdicts) and asks for Markdown with exactly these sections: `## Outcome`, `## Branches ready to merge` (table: task_key, branch, changed files — parsed from worker outputs; write `none` when the mission had no `workspace_path`), `## Suggested merge order` (topological order of `depends_on`), `## Follow-ups`. Set `mission.status = 'summarizing'`, `summary_run_id`, `summary_agent_id`. Merging stays manual — the agent must not run `git merge`.
       - **Stage `summarizing`** (handled at the top of `advanceMission` like `writing_spec`): poll `summary_run_id`; on `completed` insert `mission_artifacts` (`kind: 'mission_summary'`, `title: 'Mission Summary & Branches'`) and set `status = 'completed'`; on `failed | cancelled | interrupted` or 404 still set `status = 'completed'` with `error_message = "Summary step failed: <reason>"` (all task work is already done, so do not block the mission). The tick endpoint and the UI auto-tick treat `summarizing` as active. The Artifacts viewer shows `mission_summary` first when present.
       - Else if zero tasks have `active_run_id !== null` and zero `queued` tasks have all `depends_on` satisfied, and at least one task is `needs_you` or `failed`: set `mission.status = 'needs_you'`.

### Step 5: Next.js 16 Route Handlers (`app/api/**`)

Under `next.config.ts` (`cacheComponents: true`), **never** export `dynamic`, `runtime`, `revalidate`, or `fetchCache` in any `route.ts`. Every `GET` handler reads `await connection()` (from `next/server`) or `request.headers` at entry so Next.js 16 executes it dynamically at request time. Use global `RouteContext<"/api/...">` for typed async `ctx.params`.

1. **System & Gateway Status (`app/api/gateway/status/route.ts`)**:
   - `GET`: returns `{ configured: { supabase: boolean, hermes: boolean, ninerouter: boolean }, ninerouter: NineRouterStatus, defaultHermes: HermesProbeResult, agentsHealth: Array<{ agentId, name, slug, ok, latencyMs, activeRuns, error? }> }`.
2. **9Router Models (`app/api/gateway/models/route.ts`)**:
   - `GET(request: NextRequest)`: reads optional `?kind=` query param, fetches live models from `listNineRouterModelsByKind`, and returns `{ models }`.
3. **Agents CRUD + Seed + Connection Probe (`app/api/agents/route.ts`, `app/api/agents/[id]/route.ts`, `app/api/agents/[id]/probe/route.ts`, `app/api/agents/seed/route.ts`)**:
   - `GET /api/agents`: lists all agents ordered by `role_stage`, `created_at` (stripping `custom_api_key`, adding `has_custom_key: Boolean(row.custom_api_key)`).
   - `POST /api/agents`: validates required fields (`name`, `slug`, `role_stage`, `model`, `system_prompt`), normalizes `slug` (`^[a-z0-9][a-z0-9_-]{1,48}$`), inserts into `agents`, returns `201` on success or `409` on duplicate `slug`.
   - `PATCH /api/agents/[id]`: updates editable fields; if `custom_api_key === ""` clears override to `null`, if omitted preserves existing key, if non-empty updates key.
   - `DELETE /api/agents/[id]`: if any `mission_tasks` row has `active_run_agent_id = id` (or a non-terminal mission has `orchestrator_agent_id`/`spec_agent_id = id` with a run id set), return `409 { error: "Agent has active runs; stop them first" }` — deleting would null the FK and make the run unpollable. Otherwise delete and return `200 { ok: true }`.
   - `POST /api/agents/[id]/probe`: runs `probeHermesAgent` + `listHermesCapabilitiesInventory` for that specific agent and returns health, capabilities, skills, and toolsets.
   - `POST /api/agents/seed`: upserts missing default starter agents (`ON CONFLICT (slug) DO NOTHING`) so deleted starter roles can be restored in 1 click.
4. **Missions, Autonomous Tick, Task Controls, & Live SSE Stream**:
   - `GET /api/missions` & `POST /api/missions` (`app/api/missions/route.ts`): `GET` lists recent missions with task stage counts (`doneCount`, `totalCount`, `runningCount`, `needsYouCount`); `POST` validates `{ prompt, workspacePath?, pauseAfterPlanning?, maxParallelWorkers?, maxRetries? }` (`prompt` trimmed, 1–20 000 chars → else `400`), inserts `missions` row with `title = first line of prompt truncated to 80 chars` (overwritten by the plan's `missionTitle` when planning completes), calls `advanceMission(mission.id)` once to kick off PM Orchestrator immediately (errors from this first call are caught and saved to `error_message`; the mission row is still returned), and returns `201` `{ mission }`.
   - `GET /api/missions/[id]` & `DELETE /api/missions/[id]` (`app/api/missions/[id]/route.ts`): `GET` returns full `{ mission, tasks, artifacts }`; `DELETE` stops any in-flight Hermes runs best-effort and deletes the mission cascade.
   - `POST /api/missions/[id]/control` (`app/api/missions/[id]/control/route.ts`): handles mission-level actions `{ action: "approve_plan" | "cancel" | "resume" }`:
     - `"approve_plan"`: transitions `awaiting_plan_approval` → `running` and invokes `advanceMission(id)`.
     - `"cancel"`: calls `stopHermesRun` on all active runs in the mission and sets active tasks/mission to `'cancelled'`.
     - `"resume"`: re-queues `'needs_you'` / `'failed'` tasks (`retry_count = 0`, `stage = 'queued'`) and sets `mission.status = 'running'`, then invokes `advanceMission(id)`.
   - `POST /api/missions/[id]/tasks/[taskId]/control` (`app/api/missions/[id]/tasks/[taskId]/control/route.ts`): handles `{ action: "retry" | "stop" | "approve_tool" | "deny_tool" | "clarify" | "mark_done", answer?: string }`:
     - `"retry"`: stops active run if any, resets `stage = 'queued'`, `retry_count = 0`, `active_run_id = null`, ensures `mission.status = 'running'`, and calls `advanceMission(id)`.
     - `"stop"`: calls `stopHermesRun` and sets `task.stage = 'needs_you'`, `active_run_id = null`.
     - `"approve_tool" | "deny_tool"`: reads `task.pending_approval` (`prompt_id` / `request_id`, `execution_generation`), calls `submitHermesRunApproval` with `choice: action === "approve_tool" ? "once" : "deny"`, clears `pending_approval`.
     - `"clarify"`: calls `submitHermesRunClarify` with `answer`.
     - `"mark_done"`: manual human override marking `task.stage = 'done'` and advancing downstream tasks.
   - `POST /api/orchestrator/tick` (`app/api/orchestrator/tick/route.ts`): accepts `{ missionId?: string }`; if `missionId` given, runs `advanceMission(missionId)`; otherwise queries all missions with `status IN ('planning', 'writing_spec', 'running')` and advances them concurrently. Supports both browser session cookie and `Authorization: Bearer <DASHBOARD_SECRET>` for optional 24/7 VPS cron.
   - `GET /api/hermes/runs/[runId]/events` (`app/api/hermes/runs/[runId]/events/route.ts`): reads `?agentId=<uuid>`, looks up the owning agent, opens `openHermesRunEventStream(agent, runId, request.signal)`, and returns `new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } })`.
   - `GET /api/hermes/sessions/[sessionId]/messages` (`app/api/hermes/sessions/[sessionId]/messages/route.ts`): reads `?agentId=<uuid>` and returns session transcript from Hermes SQLite (`getHermesSessionMessages`).
5. **Scheduled Jobs / "Time AI" (`app/api/schedules/route.ts`, `app/api/schedules/[jobId]/route.ts`)**:
   - Proxies `?agentId=<uuid>` to that Hermes agent's `/api/jobs` (`GET` list, `POST` create `{ prompt, schedule, name? }`) and `/api/jobs/[jobId]` (`PATCH` update, `DELETE` remove, `POST` `{ action: "pause" | "resume" | "run" }`).

### Step 6: Dashboard Shell & Four Interactive Views (`app/`, `components/`)

Update `app/globals.css` and `app/layout.tsx` (`title: "Neiro — AI Team Orchestrator"`, dark command-center palette using CSS variables and Geist Sans/Mono). Wrap authenticated routes under route group `app/(dashboard)/layout.tsx` with a persistent left navigation sidebar (`Missions`, `AI Team`, `Schedules (Time AI)`, `9Router & VPS`, plus Sign Out button) and a top Setup Warning Banner whenever `/api/gateway/status` reports unconfigured Supabase/Hermes/9Router env vars. Remember Next.js 16 `<Activity>` persistence: reset transient modal/drawer state cleanly on route param changes.

1. **Mission Control & Kanban Board (`app/(dashboard)/page.tsx`, `components/mission-workspace.tsx`, `components/run-inspector-drawer.tsx`)**:
   - **1-Prompt Mission Launcher**: textarea for mission prompt, optional `VPS Workspace Path` input (`/root/projects/...`), `Full Auto-Pilot` vs `Gate after PRD` toggle, `Parallel Workers (1–10, default 3)` & `Max Auto-Fix Retries (0–5, default 2)` selectors, and **Launch AI Team** button.
   - **Mission Selector & Live Auto-Tick Hook**: sidebar/dropdown of missions; while viewing or having any active mission (`planning | writing_spec | running`), polls `POST /api/orchestrator/tick` every `3000ms` (pausing overlap with an in-flight ref guard).
   - **Pipeline Stage Stepper + Approval Banner**: highlights `1. PM Task Breakdown → 2. PRD & Spec → 3. Parallel Team Execution → 4. Completed`; when `status === 'awaiting_plan_approval'`, renders a prominent **Approve PRD & Launch N Parallel Tasks** CTA.
   - **6-Column Kanban Board**: `Queued`, `Coding (Parallel)`, `QA Testing`, `Final Review`, `Needs You`, `Done`. Cards display `task_key`, title, assigned Agent pill + 9Router model, `depends_on` badges, retry counter (`Retry 1/2`), token usage, amber **Approval Required** quick buttons (`Approve` / `Deny`), and **Live Stream** button.
   - **Markdown Artifacts Viewer Tab**: switchable side-by-side or tab view rendering `PRD & Requirements`, `Task Plan`, per-task `Deliverables`, `QA Reports`, and `Review Verdicts` using `react-markdown` + `remark-gfm`, with 1-click Copy Markdown & Download `.md`.
   - **Live Run Inspector Drawer (`components/run-inspector-drawer.tsx`)**: connects via browser `EventSource` to `/api/hermes/runs/${runId}/events?agentId=${agentId}` while a run is active, rendering live `tool.started` / `tool.completed` rows, commentary/deltas, full Hermes session history (`/api/hermes/sessions/.../messages`), and **Stop / Retry / Mark Done** buttons.
2. **Paperclip-Style AI Team CRUD (`app/(dashboard)/agents/page.tsx`, `components/agents-manager.tsx`)**:
   - Displays the team grouped by pipeline stage (`Orchestrator` → `Spec Writer` → `Parallel Workers` → `QA Gate` → `Final Reviewer` → `Cron/Scheduled`) as visual org-chart cards showing specialty, 9Router model badge, Hermes `/p/<profile>` target, active/disabled toggle, **Test VPS Connection** button (live latency + skills/toolsets count), **Edit**, **Clone**, and **Delete**.
   - **Create / Edit Agent Modal**: includes 1-click **Role Presets** (PM Orchestrator, PRD Architect, Backend Dev, Frontend Dev, DevOps, Researcher, Content/SEO, QA Inspector, Security Reviewer), searchable **9Router Model Picker** populated live from `/api/gateway/models` (highlighting `combo` auto-fallback routes) with custom string input fallback, system prompt textarea, Hermes `profile` slug, and optional custom VPS URL / write-only API key. Includes **Restore Default Team** button (`POST /api/agents/seed`).
3. **Time AI / Scheduled Jobs (`app/(dashboard)/schedules/page.tsx`, `components/schedules-manager.tsx`)**:
   - Agent selector dropdown (`cron` or any enabled Hermes profile) + table/cards of Hermes `/api/jobs` showing schedule expression, prompt summary, status, last run, and 1-click **Run Now**, **Pause/Resume**, **Edit**, and **Delete**, plus **New Scheduled Job** modal with quick cron presets (`Every 1h`, `Daily 08:00`, `Weekdays 09:00`, custom cron).
4. **9Router & VPS Infrastructure (`app/(dashboard)/gateway/page.tsx`, `components/gateway-monitor.tsx`)**:
   - Live status & latency cards for **9Router Gateway** (searchable table of available models across `chat`, `combo`, `web`, `image`, `embedding`) and **Tencent Cloud VPS Hermes Nodes** (per-agent readiness from `/health/detailed`, capabilities flags, discovered skills & toolsets), plus a **Heartbeat** card: shows the last tick time received with a Bearer token (stored as `last_cron_tick_at` — see Step 7) with green < 3 min / red otherwise, and the copyable crontab line from Step 7.

### Step 7: Mandatory VPS Cron Heartbeat (24/7 progression)

The pipeline must advance with every device closed and before Hermes expires terminal run records, so a VPS cron is part of the deployment, not optional:

- Add table `app_state (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())` to `supabase/schema.sql` (RLS enabled, no policies). `POST /api/orchestrator/tick`, when authorized via `Authorization: Bearer` (not cookie), upserts `key = 'last_cron_tick_at'`, `value = to_jsonb(now())` before advancing missions.
- `GET /api/gateway/status` adds `cron: { lastTickAt: string | null, healthy: boolean }` (`healthy = lastTickAt within 180 s`). The `(dashboard)/layout.tsx` setup banner also warns `"VPS cron heartbeat missing — pipeline only runs while this tab is open"` when `healthy === false`.
- Commit `deploy/neiro-tick.cron` containing exactly:
  `* * * * * curl -fsS -m 55 -X POST "$NEIRO_URL/api/orchestrator/tick" -H "Authorization: Bearer $DASHBOARD_SECRET" -H "Content-Type: application/json" -d '{}' >/dev/null 2>&1`
  with a two-line header comment telling the operator to define `NEIRO_URL` and `DASHBOARD_SECRET` at the top of the crontab (`crontab -e`). The `/gateway` Heartbeat card renders this same line for copying.
- UI language: all labels in English.

## Critical files & anchors

- `next.config.ts` — `cacheComponents: true` and `partialPrefetching: true`; forbids `dynamic`/`runtime`/`revalidate` exports across every new `page.tsx`, `layout.tsx`, and `route.ts`.
- `proxy.ts` — Next.js 16 root request gate (replaces deprecated `middleware.ts`) enforcing `neiro_session` HMAC cookie and `Bearer` cron auth before UI or `/api/*` execution.
- `lib/hermes.ts` — Server-only adapter for Hermes API Server (`:8642` and `/p/<profile>/...`), preserving profile-scoped `active_run_agent_id` credentials across `/v1/runs/{id}`, SSE `/events`, `/api/sessions`, and `/api/jobs`.
- `lib/orchestrator.ts` — Idempotent, serverless-safe DAG state machine advancing `planning → writing_spec → parallel coding → qa → review → done | needs_you` with optimistic SQL locking and Hermes `Idempotency-Key` headers.
- `supabase/schema.sql` — Canonical Postgres schema and 6-agent Paperclip starter seed (`pm-orchestrator`, `spec-writer`, `backend-worker`, `frontend-worker`, `qa-inspector`, `lead-reviewer`).

## Verification

1. **Static & Next.js 16 Cache Components Build Check**:
   - Run `bun install && bunx next typegen && bunx tsc --noEmit && bun run lint && bun run build` from `/Users/rezajulian/Documents/neiro`.
   - Expected: zero TypeScript errors, zero ESLint errors, and `next build` succeeds without `blocking-route` Suspense errors or unsupported segment-config errors under `cacheComponents: true`.
2. **Auth Gate & Unconfigured-Env Resilience Smoke Proof**:
   - Start `bun run dev` with `DASHBOARD_SECRET=test-secret-12345`.
   - Request `GET http://localhost:3000/` without cookies → expected `307` redirect to `/login?next=%2F`; request `GET http://localhost:3000/api/agents` without cookies → expected `401 {"error":"Unauthorized"}`.
   - `POST http://localhost:3000/api/auth` with `{"passcode":"test-secret-12345"}` → expected `200 {"ok":true}` with `Set-Cookie: neiro_session=...; HttpOnly`.
3. **End-to-End Autonomous Multi-Agent Pipeline Smoke Proof (Mocked or Live Hermes + 9Router)**:
   - Create `scripts/mock-hermes.ts` (Bun.serve on `:8642`, deleted after verification) implementing Hermes `/health/detailed`, `/v1/capabilities`, `/v1/skills`, `/v1/toolsets`, `POST /api/sessions`, `PATCH /api/sessions/:id`, `GET /api/sessions/:id/messages`, `POST /v1/runs` (stores run, completes after 2 s), `GET /v1/runs/:id`, `GET /v1/runs/:id/events` (emits `tool.started`, `message.delta`, `tool.completed`, `run.completed`), `/api/jobs` CRUD, plus 9Router `/api/health` and `/v1/models`. Canned outputs: orchestrator input → JSON plan with `T1`,`T2` (no deps) and `T3` (dependsOn `T1`,`T2`); QA input → `VERDICT: FAIL` on the first QA call for `T1`, `VERDICT: PASS` otherwise; reviewer input → `VERDICT: APPROVED`. Run with `HERMES_DEFAULT_URL=http://localhost:8642` against a real Supabase project with `supabase/schema.sql` applied (or the live VPS instead of the mock).
   - Parser self-check: `lib/orchestrator-parsers.test.ts` run via `bun test` asserting (a) fenced JSON plan parses, (b) cycle `T1→T2→T1` is broken, (c) garbage output yields single fallback `T1`, (d) missing verdict line → fail token.
   - Open `http://localhost:3000` in browser:
     1. Verify `/agents` renders the 6 seeded agents, creates a 7th custom agent (`devops-worker`) selecting a model from `/api/gateway/models`, edits its prompt, probes connection, and deletes a test clone.
     2. On `/`, submit 1 prompt (`"Buat modul kupon diskon beserta API validasi dan komponen checkout"`) in Full Auto-Pilot mode → observe mission advance automatically across ticks from `planning` (PM creates `T1..Tn` DAG) → `writing_spec` (`PRD.md` artifact appears in Markdown viewer) → `running` (independent tasks enter `Coding` concurrently up to `max_parallel_workers = 3`) → `QA Testing` (`qa_report` generated) → `Final Review` (`review_report` generated; verify a simulated `FAIL` increments `retry_count` and re-runs Worker before succeeding) → `completed` (`Done` column).
     3. Open Live Run Inspector Drawer on an active task and verify SSE events (`tool.started`, `tool.completed`, deltas) render live.
     4. On `/schedules`, create a cron job, pause/resume it, and trigger **Run Now**.
     5. Close every browser tab, run `curl -X POST http://localhost:3000/api/orchestrator/tick -H "Authorization: Bearer test-secret-12345" -H "Content-Type: application/json" -d '{}'` every 3 s for 30 s from a terminal against a fresh mission, reopen `/` → mission advanced with no tab open; `/gateway` Heartbeat shows green; mission ends `completed` with a `Mission Summary & Branches` artifact.

## Assumptions & contingencies

- **Hermes LLM routing via 9Router**: Assumes each Hermes profile on the Tencent Cloud VPS has its LLM provider base URL pointed at the 9Router `/v1` endpoint in `~/.hermes/config.yaml` (so sending `model: "<9router-model-id>"` on `POST /v1/runs` routes through 9Router automatically). *Contingency*: if Hermes has multiple providers configured and requires an explicit provider slug per request, setting `HERMES_PROVIDER_SLUG` in `.env` passes `provider` on every `/v1/runs` call without code changes.
- **VPS HTTPS/Tunnel reachability from Vercel**: Assumes Tencent Cloud VPS exposes Hermes (`:8642`) and 9Router (`:20128`) to Vercel server functions over HTTPS (Nginx/Caddy reverse proxy or Cloudflare Tunnel). *Contingency*: if an endpoint is temporarily unreachable or hits Hermes `max_concurrent_runs` (`429`/`503`), `lib/hermes.ts` returns deferred/error descriptors with 15s timeouts so dashboard requests never hang past Vercel function limits.
- **24/7 progression**: The VPS crontab from Step 7 is required on the Tencent VPS. The browser 3 s auto-tick is still kept for faster UI feedback while a tab is open. *Contingency*: if the VPS cannot reach the Vercel URL (egress blocked), run the same tick via a Hermes scheduled job (`POST /api/jobs` with a no-agent script job calling the curl line), which also runs every minute on the gateway's scheduler.
