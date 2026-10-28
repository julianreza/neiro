# Bug Spec — Fix review findings on PR #1

Source: pending `code-review-sage` review on [PR #1](https://github.com/julianreza/neiro/pull/1) (commit `fb0b038`, branch `feat/phase-1-design-system`). Verdict: "Not ready to ship" — 7 must-fix (🔴), 5 should-fix (🟡).

Goal: make the orchestrator engine actually correct under real Hermes runs and concurrent ticks, close the service-role key leak path, make UI controls and docs tell the truth, and add tests for the state machine so these defects cannot return.

Scope: all 12 findings (F1–F12). Decisions D1–D3 at the end set how F5 and F7 are fixed.

---

## Findings overview

| ID | Sev | Area | File(s) |
|----|-----|------|---------|
| F1 | 🔴 | No compare-and-set; concurrent ticks double-process | `lib/orchestrator.ts`, `supabase/schema.sql` |
| F2 | 🔴 | Run started and read in the same tick | `lib/orchestrator.ts` |
| F3 | 🔴 | `depends` keys (`T1`) never map to task rows | `lib/orchestrator.ts`, `supabase/schema.sql` |
| F4 | 🔴 | Admin client accepts `NEXT_PUBLIC_*` keys | `lib/supabase.ts` |
| F5 | 🔴 | Pause/workers/retries/workspace options dropped | `app/api/missions/route.ts`, `lib/orchestrator.ts`, `supabase/schema.sql`, `lib/types.ts` |
| F6 | 🔴 | `cn` comes from the unrelated `cn` npm package | `lib/utils.ts`, `package.json` |
| F7 | 🔴 | "Live" dashboard actually renders demo data | `components/*-manager.tsx`, `components/gateway-monitor.tsx`, `components/mission-workspace.tsx`, `README.md` |
| F8 | 🟡 | Proxy matcher skips every `*.svg` path | `proxy.ts` |
| F9 | 🟡 | Gateway status payload ≠ `GatewayStatusDTO` | `app/api/gateway/status/route.ts`, `lib/types.ts` |
| F10 | 🟡 | Plan doc describes a schema that did not ship | `NEIRO_ORCHESTRATOR_PLAN.md`, `README.md` |
| F11 | 🟡 | `advanceMission` errors swallowed silently | `app/api/missions/route.ts`, `app/api/missions/[id]/control/route.ts`, `app/api/missions/[id]/tasks/[taskId]/control/route.ts` |
| F12 | 🟡 | State machine has no tests | `lib/orchestrator.ts` |

---

## Investigation

### F1 — No optimistic locking

Symptom: duplicate Hermes runs, duplicate `task_plan` / `qa_report` / `review_report` / `mission_summary` artifacts, `retries` bumped twice, tasks reach `Needs you` early.

Reproduction:
1. Create a mission with a QA agent enabled.
2. Fire `POST /api/orchestrator/tick` twice concurrently (or let the 3 s browser auto-tick overlap the 1/min cron in `deploy/neiro-tick.cron`).
3. Observe two `qa_report` artifacts for one task and `retries` jumping by 2.

Root cause: every transition in `advanceMission` is `.update({...}).eq("id", task.id)` with no guard on the observed prior stage. Artifact inserts use `crypto.randomUUID()` with no unique key. The planning branch only checks `detail.tasks.length === 0`, so two ticks both insert a full task set.

### F2 — Start-then-read in one tick

Symptom: missions almost always plan as a single fallback `T1`; QA/review verdicts never land; pipeline stalls.

Reproduction: point an orchestrator agent at a real Hermes server whose runs take more than a few hundred ms. Create a mission. The `task_plan` artifact holds the fallback plan; QA stage never writes a report.

Root cause: each stage calls `startHermesRun` then `getHermesRun` immediately. `output` is `undefined` while the run is still `queued`/`running`. Nothing stores the `runId`, so later ticks cannot resume reading it. The planning branch also proceeds when `status === "completed"` with empty output, and parses `""`. In addition, the `Coding` branch never checks the coding run at all — it starts QA right away.

### F3 — Dependencies never resolve

Symptom: dependent tasks stay `Queued` forever, or run early by accident.

Reproduction: plan returns `T1`, `T2 (dependsOn: ["T1"])`. After `T1` reaches `Done`, `T2` never starts (unless `T1`'s title happens to contain the string `T1`).

Root cause: tasks are inserted with a UUID `id` and no `task_key`; `depends` stores parser keys. `depsDone` compares `t.id === dep || t.title.includes(dep)`. The schema has no `task_key` column.

### F4 — Service-role key may reach the browser

Symptom/risk: a deployer following the code's fallbacks sets `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`; Next.js inlines it into client JS; anyone gets RLS-bypassing read/write including `agents.key_enc`.

Root cause: `getSupabaseAdmin()` falls back to `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The anon/publishable fallback also silently builds a client that RLS (zero policies) blocks from everything.

### F5 — Operator controls are no-ops

Symptom: "Pause after PRD for review" is on, yet the mission executes autonomously. Worker and retry caps change nothing.

Reproduction: in Mission Control compose a mission with pause on and retries = 1. The POST returns `status: "running"`; ticks advance it; failed QA retries twice.

Root cause: `components/mission-workspace.tsx` sends `pause_after_planning`, `workspace_path`, `max_parallel_workers`, `max_retries`. `POST /api/missions` reads only `title`, `prompt` and inserts `status: "running"`. `missions` has none of those columns. `advanceActiveMissions` selects `running` **and** `awaiting_plan_approval`, so even that status would not gate. Retry cap is hard-coded `task.retries < 2`. No parallel cap exists.

### F6 — Wrong `cn` helper

Symptom: conflicting Tailwind classes (`p-2 p-4`) both emitted; an unvetted package sits under every UI component.

Root cause: `lib/utils.ts` does `export { cn } from "cn"`; `package.json` lists `"cn": "^0.5.0"`. `clsx` and `tailwind-merge` are absent.

### F7 — "Live" dashboard is demo data

Symptom: description and README say the dashboard is connected live; the four surfaces start from hard-coded arrays and silently fall back to them on any fetch error; agents-manager shows "Demo workspace. No agents connected."

Root cause: UI shell and live engine were shipped together, with demo scaffolding left as the default state and no visible indicator of which data source is shown.

### F8 — Over-broad `.svg` auth bypass

Root cause: `proxy.ts` matcher `"/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"` exempts any path ending `.svg`, including future `/api/...svg` routes.

### F9 — Gateway status contract drift

Root cause: the route returns `configured`, `cron`, `defaultHermes`, `agentsHealth` beyond `GatewayStatusDTO { supabase, hermes, nineRouter, checkedAt }`; `gateway-monitor.tsx` consumes them untyped.

### F10 — Plan doc out of sync

Root cause: `NEIRO_ORCHESTRATOR_PLAN.md` documents `role_stage`, `system_prompt`, `custom_base_url`, `pause_after_planning`, 9 mission statuses, `mission_artifacts.verdict`, etc. None shipped. README claims "The full backend engine is implemented".

### F11 — Silent failures

Root cause: `try { await advanceMission(id) } catch { /* comment */ }` in missions POST, mission control, task control. No log, no stored error.

### F12 — Untested core

Root cause: tests exist only for parsers, auth, utils, demo data. `advanceMission`, `advanceActiveMissions`, `pickStageAgent` have zero coverage, so F1–F3 and F5 shipped unnoticed.

---

## Requirements

### Requirement 1 — Concurrency-safe transitions (F1)

User story: As an operator, I want overlapping ticks to never duplicate work, so that runs, artifacts and retry counts stay correct.

Acceptance criteria:
1. WHEN `advanceMission` changes a task's stage THE SYSTEM SHALL condition the update on the stage it observed (`.eq("stage", observed)`) and treat a 0-row result as "already advanced" and skip further work on that task this tick.
2. WHEN two `advanceMission` calls for the same mission run concurrently THE SYSTEM SHALL start at most one Hermes run per (task, stage, attempt).
3. WHEN a mission has no tasks THE SYSTEM SHALL claim planning atomically (one claim per mission) so that only one tick inserts the task set.
4. THE SYSTEM SHALL enforce at most one `task_plan`, `prd` and `mission_summary` artifact per mission, and one `qa_report` / `review_report` per (task, attempt), via a unique constraint and conflict-ignoring insert.
5. WHEN a retry is recorded THE SYSTEM SHALL increment `retries` exactly once per failed verdict.
6. WHEN the mission completes THE SYSTEM SHALL set `status = 'completed'` only from a non-terminal status (guarded update).

### Requirement 2 — Asynchronous run lifecycle (F2)

User story: As an operator, I want each stage to wait for its Hermes run to finish, so that plans and verdicts come from real output.

Acceptance criteria:
1. WHEN a stage starts a Hermes run THE SYSTEM SHALL persist the `run_id`, the agent id, and the run's stage on the task (or on the mission for planning/spec).
2. WHILE a persisted run's status is not terminal THE SYSTEM SHALL leave the task/mission in its current stage and not start another run.
3. WHEN a persisted run reports `completed` THE SYSTEM SHALL parse its output and transition, then clear the stored run id.
4. IF a persisted run reports `failed`, `cancelled`, `expired_404`, or `completed` with empty output THEN THE SYSTEM SHALL count it as a failed attempt (retry or `Needs you` per Requirement 5) and not parse an empty string as a plan.
5. WHEN the coding run completes THE SYSTEM SHALL store its output in `mission_tasks.result_output` (or equivalent) before QA starts; QA SHALL NOT start while the coding run is unfinished.
6. WHEN a completed run reports token usage THE SYSTEM SHALL add it to `mission_tasks.tokens`.

### Requirement 3 — DAG dependency resolution (F3)

User story: As an operator, I want tasks to run in the order the plan declares, so that dependent work waits for its inputs.

Acceptance criteria:
1. THE SYSTEM SHALL store the parser's `taskKey` in a new `mission_tasks.task_key` column, unique per mission.
2. WHEN checking dependencies THE SYSTEM SHALL match each `depends` entry only against `task_key` of tasks in the same mission.
3. WHEN every dependency of a `Queued` task is `Done` THE SYSTEM SHALL make it eligible to start; otherwise it SHALL stay `Queued`.
4. IF a `depends` entry names a key that does not exist in the mission THEN THE SYSTEM SHALL drop it at plan-insert time (after `breakDependencyCycles`) so it cannot block forever.
5. THE SYSTEM SHALL NOT match dependencies by title substring.

### Requirement 4 — Server-only admin credentials (F4) — security

User story: As the owner, I want the service-role key to never be readable from the browser, so that RLS cannot be bypassed by visitors.

Acceptance criteria:
1. THE SYSTEM SHALL build the admin client only from `SUPABASE_SERVICE_ROLE_KEY`.
2. IF `SUPABASE_SERVICE_ROLE_KEY` is unset THEN `getSupabaseAdmin()` SHALL throw `AppConfigError("missing_supabase_env", …)` even when any `NEXT_PUBLIC_SUPABASE_*` key is set.
3. IF `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` is set THEN THE SYSTEM SHALL throw `AppConfigError("public_service_role_key", …)` telling the operator to remove it.
4. `lib/supabase.ts` SHALL import `"server-only"` so a client import fails the build.
5. `.env.example` and README SHALL name only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the server client.

### Requirement 5 — Honored mission controls (F5) — per D1

User story: As an operator, I want "Pause after PRD", max retries and max parallel workers to take effect, so that I keep control of an autonomous runner.

Acceptance criteria:
1. THE SYSTEM SHALL add `missions.pause_after_planning BOOLEAN NOT NULL DEFAULT false`, `max_parallel_workers INT NOT NULL DEFAULT 3 CHECK (1..10)`, `max_retries INT NOT NULL DEFAULT 2 CHECK (0..5)`, `workspace_path TEXT`.
2. WHEN `POST /api/missions` receives these fields THE SYSTEM SHALL validate types/ranges, return 400 on invalid input, and persist them.
3. WHEN `pause_after_planning` is true THE SYSTEM SHALL insert the mission as `running`, run planning + spec, then set `awaiting_plan_approval` and stop.
4. WHILE a mission is `awaiting_plan_approval` THE SYSTEM SHALL NOT start any coding/QA/review run (tick and `advanceActiveMissions` skip it).
5. WHEN the operator calls `approve_plan` THE SYSTEM SHALL move the mission to `running` (guarded on `awaiting_plan_approval`) and resume.
6. WHEN a verdict fails THE SYSTEM SHALL retry only while `retries < mission.max_retries`, else set `Needs you`.
7. WHILE `max_parallel_workers` tasks are in `Coding`, `QA check` or `Final review` THE SYSTEM SHALL NOT start another `Queued` task.
8. WHEN a run is started for a mission with `workspace_path` THE SYSTEM SHALL pass it to the coding prompt.

### Requirement 6 — Standard `cn` helper (F6)

User story: As a developer, I want `cn` to be `clsx` + `tailwind-merge`, so that class conflicts resolve and no stray package sits under the UI.

Acceptance criteria:
1. `lib/utils.ts` SHALL export `cn(...inputs: ClassValue[]) => twMerge(clsx(inputs))`.
2. `package.json` SHALL pin `clsx` and `tailwind-merge` to exact versions and SHALL NOT contain `cn`.
3. WHEN `cn("p-2", "p-4")` is called THE SYSTEM SHALL return `"p-4"` (unit test in `lib/utils.test.ts`).

### Requirement 7 — Honest data source on every surface (F7) — per D2

User story: As an operator, I want to see whether a surface shows live or sample data, so that I never decide on fake data.

Acceptance criteria:
1. Mission Control, AI Team, Time AI (schedules) and 9Router & VPS SHALL start in a loading state, not pre-filled with demo arrays.
2. WHEN the API responds OK THE SYSTEM SHALL render only API data (empty state when empty).
3. IF the API fails or returns 503 `missing_supabase_env` THEN THE SYSTEM SHALL render demo data only with a visible "Demo data — <reason>" badge/alert, announced via `role="status"`.
4. README and the PR description SHALL state per surface what is live and what falls back.

### Requirement 8 — Narrow auth exemption (F8) — security

Acceptance criteria:
1. THE SYSTEM SHALL exempt from `proxy.ts` only `_next/static`, `_next/image`, `favicon.ico`, and the exact static SVG files present in `public/`.
2. WHEN an unauthenticated request hits `/api/anything.svg` THE SYSTEM SHALL return 401.

### Requirement 9 — One gateway status contract (F9)

Acceptance criteria:
1. `GatewayStatusDTO` SHALL declare every key the route returns (`configured`, `cron`, `supabase`, `hermes`, `nineRouter`, `defaultHermes`, `agentsHealth`, `checkedAt`) and the `degraded` status.
2. The route SHALL build its response as a `GatewayStatusDTO` (`satisfies`), so extra or missing keys fail `tsc`.

### Requirement 10 — Docs match the code (F10)

Acceptance criteria:
1. `NEIRO_ORCHESTRATOR_PLAN.md` SHALL describe the shipped schema (after this fix) in present tense, with unbuilt parts in a "Planned — not in this PR" section.
2. README SHALL drop "The full backend engine is implemented" and list live vs demo surfaces (shared with R7.4).

### Requirement 11 — Visible orchestration failures (F11)

Acceptance criteria:
1. WHEN `advanceMission` throws in any route THE SYSTEM SHALL `console.error` with mission id (and task id when known) and the error.
2. THE SYSTEM SHALL store `missions.last_error TEXT` and `last_error_at TIMESTAMPTZ`, set on failure and cleared on the next successful advance.
3. WHEN `last_error` is set THE SYSTEM SHALL show it on the mission in Mission Control.

### Requirement 12 — Regression tests for the engine (F12)

Acceptance criteria (run with `bun test`, mocking `@/lib/supabase` and `@/lib/hermes`):
1. Two concurrent `advanceMission` calls on one `Queued` task start exactly one run and leave `retries` unchanged.
2. Planning with a run still `running` inserts no tasks; a later tick after `completed` inserts the parsed tasks with `task_key`.
3. `T2 dependsOn T1` stays `Queued` until `T1` is `Done`, then starts; a title containing `T1` does not satisfy it.
4. A failed QA verdict retries until `max_retries`, then `Needs you`.
5. `pause_after_planning` mission stops at `awaiting_plan_approval` and starts no coding run until approved.
6. `getSupabaseAdmin` throws with only `NEXT_PUBLIC_*` keys set.
7. A `test` script (`"test": "bun test"`) exists in `package.json`.

---

## Non-functional

- Security: R4 and R8 are security fixes; no new secret may be exposed through `NEXT_PUBLIC_*`.
- Schema changes SHALL be idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`) so `supabase/schema.sql` can be re-run on an existing DB.
- Accessibility: demo/error badges use `role="status"` and visible text, not color alone.
- Verification gates (from `AGENTS.md`): `bun run lint`, `bunx next typegen && bunx tsc --noEmit`, `bun test`, `bun run build` all pass.
- Constraint (from `AGENTS.md`): no `dynamic`/`revalidate`/`runtime` segment exports (`cacheComponents: true`).

## Decisions

- D1 — F5: **decided — implement** the controls in API, schema and engine (Requirement 5 as written).
- D2 — F7: **decided — keep fallback**, add loading state and visible Demo badge (Requirement 7 as written).
- D3 — Fix location: **decided — new commits on `feat/phase-1-design-system`**, so PR #1 updates.
