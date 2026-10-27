# Tasks — Fix review findings on PR #1

Work happens on `feat/phase-1-design-system` in `/Users/rezajulian/Documents/neiro` (D3). Run tasks in order. After each task, run the checks it names. Run `bun run build` only in task 14, because host memory is low.

Per-task gate (shortened to "gate" below): `bun run lint && bunx next typegen && bunx tsc --noEmit && bun test`.

- [x] 1. Test tooling and `server-only`
  - [x] 1.1 Run `bun add --exact server-only`. Add `"test": "bun test --conditions=react-server"` to `package.json` `scripts`.
  - [x] 1.2 Check that `bun run test` passes on the current 13 tests. Also check that a scratch file importing `"server-only"` loads under that script; delete the scratch file afterwards. If Bun rejects `--conditions` for `bun test`, use this fallback: add `bunfig.toml` with `[test] preload = ["./test-setup.ts"]`, where `test-setup.ts` calls `mock.module("server-only", () => ({}))` from `bun:test`. Then set the script to plain `bun test`.
  - Verify: `bun run test` is green.
  - _Requirements: 12.7, 4.4_

- [x] 2. Replace the `cn` helper (F6)
  - [x] 2.1 Run `bun remove cn && bun add --exact clsx tailwind-merge`.
  - [x] 2.2 Rewrite `cn` in `lib/utils.ts` as `twMerge(clsx(inputs))` with a `ClassValue[]` rest parameter. Keep the other exports.
  - [x] 2.3 In `lib/utils.test.ts`, add a test that `cn("p-2", "p-4") === "p-4"` and that `cn("a", false && "b", "c") === "a c"`.
  - Verify: gate. `grep -n '"cn"' package.json` finds nothing.
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 3. Server-only Supabase admin client (F4)
  - [x] 3.1 In `lib/auth.test.ts`, write the failing regression tests first:
    - Only `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set → throws `AppConfigError` with code `missing_supabase_env`.
    - `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` set → throws code `public_service_role_key`.
    - Save and restore `process.env` around each test.
  - [x] 3.2 Update `lib/supabase.ts` as in the design: `import "server-only"`, reject `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`, accept only `SUPABASE_SERVICE_ROLE_KEY`.
  - [x] 3.3 Edit `.env.example` so it lists `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the server and has no `NEXT_PUBLIC_*SERVICE_ROLE*`.
  - Verify: the new tests fail before 3.2 and pass after it; gate.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 12.6_

- [x] 4. Narrow the proxy auth exemption (F8)
  - [x] 4.1 In `proxy.ts`, export `PUBLIC_SVGS` (the five files in `public/`) and `isExemptPath(pathname)` (`/login`, `/api/auth*`, `PUBLIC_SVGS`). Call it from `proxy()`. Change the matcher to `"/((?!_next/static|_next/image|favicon.ico).*)"`.
  - [x] 4.2 Add `/Users/rezajulian/Documents/neiro/proxy.test.ts`. It checks that `isExemptPath("/next.svg")` and `isExemptPath("/login")` are true, and that `/api/x.svg`, `/missions/a.svg` and `/next.svg/x` are false.
  - Verify: gate.
  - _Requirements: 8.1, 8.2_

- [x] 5. Gateway status contract (F9)
  - [x] 5.1 Read `app/api/gateway/status/route.ts`. Copy the exact shapes of `configured`, `cron`, `defaultHermes` and `agentsHealth` into `lib/types.ts` (`GatewayCronStatus`, `AgentHealth`, full `GatewayStatusDTO`).
  - [x] 5.2 Build the route response as `const body = {...} satisfies GatewayStatusDTO`.
  - [x] 5.3 Fix any type errors in `components/gateway-monitor.tsx` that the stricter type exposes.
  - Verify: gate. Add a missing key and confirm `tsc` errors, then revert it.
  - _Requirements: 9.1, 9.2_

- [x] 6. Schema migration
  - [x] 6.1 Append the idempotent migration block from the design to `supabase/schema.sql`:
    - `missions`: control, phase, run and error columns, plus CHECKs added through a `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = …)` block.
    - `mission_tasks`: `task_key`, `run_id`, `run_agent_id`, `run_started_at`, `result_output`, and `uq_mission_tasks_key`.
    - `mission_artifacts`: `dedupe_key` and `uq_mission_artifacts_dedupe`.
    - `neiro_claim_task` with `REVOKE … FROM PUBLIC, anon, authenticated`.
  - [x] 6.2 Update `lib/types.ts`:
    - `MissionPhase`.
    - `Mission`: `pauseAfterPlanning`, `maxParallelWorkers`, `maxRetries`, `workspacePath`, `phase`, `runId`, `lastError`, `lastErrorAt`.
    - `MissionTask`: `taskKey`, `runId`, `resultOutput`.
    - `MissionArtifact`: `dedupeKey`.
  - Verify: gate. Read the file and check every new statement uses `IF NOT EXISTS` / `CREATE OR REPLACE`.
  - _Requirements: 1.4, 2.1, 3.1, 5.1, 11.2_

- [x] 7. `OrchestratorStore` and its Supabase implementation
  - [x] 7.1 Create `lib/orchestrator-store.ts` with the `OrchestratorStore`, `TaskGuard`, `MissionGuard`, `MissionPatch`, `TaskPatch`, `NewTaskRow` and `NewArtifactRow` types from the design.
  - [x] 7.2 Implement `createSupabaseStore()`:
    - Move the row mappers here from `lib/orchestrator.ts` and add the new fields.
    - Guarded updates use `.eq`/`.is` plus `.select("id")` and return `data.length === 1`.
    - `claimTask` calls `rpc("neiro_claim_task")`.
    - `insertTasks` and `insertArtifactOnce` use `upsert` with `ignoreDuplicates`.
    - `listActiveMissionIds` returns `status = 'running'` only.
    - Supabase errors throw.
  - Verify: gate.
  - _Requirements: 1.1, 1.3, 1.4, 3.1, 5.4_

- [x] 8. Test fakes and failing regression tests for the engine (F12)
  - [x] 8.1 Create `lib/test-fakes/memory-store.ts`. It is an in-memory `OrchestratorStore`; every method `await`s `Promise.resolve()` before acting, and `claimTask` mirrors the SQL function.
  - [x] 8.2 Create `lib/test-fakes/fake-hermes.ts`. It provides scripted `startRun`/`getRun`/`createSession`, records calls, and dedupes by idempotency key.
  - [x] 8.3 Write `lib/orchestrator.test.ts` with the 8 cases from the design's testing strategy, calling `advanceMission(id, deps)` / `advanceActiveMissions(deps)`.
  - Verify: `bun run test` compiles and the 8 new cases fail on the current engine. Note in the commit message which cases fail. This shows the tests would have caught F1, F2, F3 and F5.
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 9. Rewrite the orchestrator state machine (F1, F2, F3, F5)
  - [x] 9.1 Add `OrchestratorDeps`, `HermesClient` and default deps (`createSupabaseStore()`, real Hermes functions, `() => new Date()`) to `advanceMission`, `advanceActiveMissions` and `pickStageAgent`.
  - [x] 9.2 Mission phases `planning → spec → executing → summarizing → done`:
    - Claim with a `claim:<uuid>` token, start the run, then swap in the real `run_id`.
    - Release the claim on `deferred` or on a start error.
    - Release stale claims after 5 minutes.
    - Poll, and handle the run only when it is terminal.
    - Never parse empty output.
    - Pause → `awaiting_plan_approval` after spec.
  - [x] 9.3 Plan insert:
    - Drop unknown `dependsOn` keys.
    - Store `task_key`.
    - Write the `plan:`, `prd:` and `summary:` artifacts through `insertArtifactOnce`.
  - [x] 9.4 Task steps:
    - Key-based dependency map; no title matching.
    - `claimTask` for `Queued`.
    - Per-stage start/poll (`code`/`qa`/`review`).
    - `result_output` and `tokens` on code completion.
    - Retry rule using `mission.max_retries`.
    - Every transition guarded on `{stage, runId}`; a lost guard stops work on that entity.
    - `workspace_path` added to the code prompt.
    - Legacy null-`task_key` tasks with `depends` stay `Queued` and set `last_error`.
  - [x] 9.5 Add `reportAdvanceError`. Clear `last_error` after a successful pass. `advanceActiveMissions` uses it in its catch.
  - Verify: all 8 cases from task 8 pass; the existing parser tests still pass; gate.
  - _Requirements: 1.1–1.6, 2.1–2.6, 3.2–3.5, 5.3, 5.4, 5.6, 5.7, 5.8, 11.1, 11.2_

- [x] 10. API routes (F5, F11)
  - [x] 10.1 `app/api/missions/route.ts` `POST`:
    - Validate `pause_after_planning`, `max_parallel_workers` (1–10), `max_retries` (0–5) and `workspace_path` (≤ 500 chars). Return 400 with a field message on bad input.
    - Insert with `status: 'running'`, `phase: 'planning'`.
    - Replace the empty catch with `reportAdvanceError`.
    - Map the new columns in `GET`.
  - [x] 10.2 `app/api/missions/[id]/control/route.ts`:
    - `approve_plan` is guarded on `status = 'awaiting_plan_approval'` and returns 409 on 0 rows.
    - Replace every empty catch with `reportAdvanceError`.
  - [x] 10.3 `app/api/missions/[id]/tasks/[taskId]/control/route.ts`:
    - `retry` also clears `run_id`.
    - Replace the empty catches in `mark_done`/`retry`/`stop` with `reportAdvanceError(missionId, err, taskId)`.
  - [x] 10.4 Extract the POST body validation into an exported `parseMissionCreateBody(body)` in `lib/mission-input.ts`. Test it in `lib/mission-input.test.ts`: defaults, each out-of-range value, and a non-boolean pause.
  - Verify: gate. `grep -rn "catch {" app/api/missions` finds none left around `advanceMission`.
  - _Requirements: 5.2, 5.3, 5.5, 11.1_

- [x] 11. Honest data source on the UI (F7, F11 display)
  - [x] 11.1 Create `hooks/use-live-data.ts` (`loading`/`live`/`demo` with reason, plus `reload`) and `components/data-source-badge.tsx` (`role="status"`, visible text plus an icon).
  - [x] 11.2 `components/mission-workspace.tsx`:
    - Use `useLiveData`; show skeletons while loading.
    - `selectedId` starts as `null`.
    - Show the badge in demo mode.
    - Show a `last_error` `Alert` and the approve control for `awaiting_plan_approval`.
    - Disable the composer submit in demo mode.
  - [x] 11.3 `components/agents-manager.tsx`, `components/schedules-manager.tsx`, `components/gateway-monitor.tsx`:
    - Same pattern; no demo pre-fill.
    - The "Demo workspace…" copy only shows in demo mode.
    - Mutations are disabled with a tooltip in demo mode.
  - Verify: gate. Run `bun run dev`, open each of the four surfaces with Supabase env unset, and confirm the "Demo data — Supabase not configured" badge shows. Use the native browser panel, or `playwright-cli open http://localhost:3000` because the URL is local. Stop the dev server afterwards.
  - Note: gate passed. The dev-server check was deferred to task 13 because host memory was critical (1.9 GB free).
  - Note: schedules are read-only in both modes. The Hermes job write schema is unverified, so writes stay disabled with a tooltip.
  - _Requirements: 7.1, 7.2, 7.3, 11.3_

- [x] 12. Docs (F10, F7)
  - [x] 12.1 Rewrite the schema and state-machine sections of `NEIRO_ORCHESTRATOR_PLAN.md` to match the shipped code. Move the unbuilt items under "Planned — not in this PR".
  - [x] 12.2 In `README.md`, remove "The full backend engine is implemented". Add a live-vs-demo table per surface. Document the env vars, `bun run test`, and re-running `supabase/schema.sql`.
  - Verify: `grep -n "role_stage\|system_prompt\|custom_api_key" NEIRO_ORCHESTRATOR_PLAN.md` matches only inside the "Planned" section.
  - _Requirements: 10.1, 10.2, 7.4, 4.5_

- [x] 13. Final gates
  - [x] 13.1 Call `resource_status`. If memory is `ample`, run `bun run build`. Otherwise wait and re-check before building.
  - [x] 13.2 Run the full gate one last time and confirm 0 lint errors, 0 type errors, all tests green and a successful build.
  - Note: the build was run at 1.6 GB free at the user's request and passed (16 routes + proxy). A runtime check against `bun run start` passed: 401 for unauthenticated `/api/missions` and `/api/x.svg`, 200 for `/next.svg`, a 307 redirect to `/login`, a 400 for `max_retries: 9`, and a `GatewayStatusDTO`-shaped status. The badge was not checked visually in a browser.
  - _Requirements: all (non-functional verification gates)_

- [x] 14. Commit, push and update PR #1
  - [x] 14.1 Stage only the files changed by tasks 1–12, by name; no `git add .`. Commit in logical groups: tooling + `cn`, security (F4, F8), schema + store, engine + tests, routes, UI, docs. Messages reference F-ids.
  - [x] 14.2 Run `git push origin feat/phase-1-design-system`.
  - [x] 14.3 With the user's go-ahead, run `gh pr edit 1 --body-file <file under $KIROCREW_SCRATCH>`. The new body has an accurate summary, the live-vs-demo table, verification results, and the manual check "run `supabase/schema.sql` twice on a dev project".
  - Verify: `gh pr view 1 --json headRefOid` matches the local `HEAD`.
  - _Requirements: 7.4_
