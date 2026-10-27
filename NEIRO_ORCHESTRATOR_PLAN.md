# Neiro — AI Team Orchestrator (Full-Stack + Latest shadcn/ui & Tailwind v4 Design System)

## Context

Build **Neiro**, a Vercel-deployed Next.js 16 management dashboard and orchestration engine coordinating **Hermes Agents** on Tencent Cloud VPS via a single **9Router** LLM gateway and **Supabase Postgres** persistence. The UI uses a hardened operator control-room design system built on the latest **shadcn/ui (`radix-nova`)**, **Tailwind CSS v4** OKLCH semantic tokens, and a lean third-party stack (`sonner`, `cmdk`, `next-themes`, `@tailwindcss/typography`, `react-markdown` + `remark-gfm`, `date-fns`) with dark-first theming and a light-mode toggle for long-form spec reading. From a single prompt, Neiro drives autonomous PM task breakdown, PRD generation, parallel Worker execution, automated QA/Review retry gates, live SSE tool-stream inspection, Agent CRUD, Cron scheduling, and 24/7 VPS heartbeat monitoring.

## Approach

### Step 1: Dependencies, Latest `shadcn/ui` (`radix-nova`) + Tailwind v4 OKLCH Design System, and Theme Shell

Install the backend SDK, latest 2026 `shadcn/ui` Tailwind v4 foundation (`radix-ui` unified package, `cn` merge engine, `tw-animate-css`), and the lean third-party UI stack via Bun (preserving `@tailwindcss/turbopack` in `next.config.ts`—do **not** create `postcss.config.*` or `tailwind.config.*`, and do **not** commit `package-lock.json`):

```bash
bun add @supabase/supabase-js shadcn radix-ui class-variance-authority cn lucide-react tw-animate-css sonner next-themes cmdk react-markdown remark-gfm date-fns
bun add -d @tailwindcss/typography
```

Configure `shadcn/ui` manually first so the CLI never overwrites `next.config.ts` (`@tailwindcss/turbopack`), then generate the `radix-nova` UI primitives:

1. Create `components.json` at repo root:
   ```json
   {
     "$schema": "https://ui.shadcn.com/schema.json",
     "style": "radix-nova",
     "rsc": true,
     "tsx": true,
     "tailwind": {
       "config": "",
       "css": "app/globals.css",
       "baseColor": "zinc",
       "cssVariables": true,
       "prefix": ""
     },
     "aliases": {
       "components": "@/components",
       "utils": "@/lib/utils",
       "ui": "@/components/ui",
       "lib": "@/lib",
       "hooks": "@/hooks"
     },
     "iconLibrary": "lucide"
   }
   ```
2. Create `lib/utils.ts` re-exporting `cn` (`export { cn } from "cn";`) plus shared formatting helpers:
   - `formatCompactTokens(tokens: number): string` (`Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })`)
   - `formatRelativeTime(iso: string | null | undefined): string` (wrapping `formatDistanceToNowStrict` from `date-fns` with `"never"` fallback on null/invalid dates)
3. Run the shadcn CLI with Bun to scaffold the `radix-nova` component set into `components/ui/` and `hooks/use-mobile.ts`:
   ```bash
   bunx --bun shadcn@latest add -y button card badge dialog sheet sidebar command dropdown-menu popover select tabs table input textarea label switch scroll-area separator skeleton alert avatar collapsible tooltip sonner
   ```
4. Replace `app/globals.css` with the Tailwind v4 + OKLCH control-room token system (Whisper commitment: cool slate-tinted neutrals, Phosphor Emerald primary action—zero generic blue-violet/indigo gradients—and explicit semantic status tokens paired with icons/labels):
   - Imports & plugins at top of `app/globals.css`:
     ```css
     @import "tailwindcss";
     @import "tw-animate-css";
     @import "shadcn/tailwind.css";
     @plugin "@tailwindcss/typography";

     @custom-variant dark (&:is(.dark *));
     ```
   - Expose all standard shadcn tokens (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*`, `chart-1..5`, `--radius-sm..4xl`) plus semantic operator status tokens (`--status-running`, `--status-warning`, `--status-success`, `--status-danger`) inside `@theme inline`, keeping `--font-sans: var(--font-geist-sans)` and `--font-mono: var(--font-geist-mono)`.
   - `:root` (Paper Light mode for long-form `PRD.md` reading, `--radius: 0.5rem`):
     - `--background: oklch(0.985 0.003 250)`, `--foreground: oklch(0.155 0.006 250)`, `--card: oklch(1 0 0)`, `--popover: oklch(1 0 0)`
     - `--primary: oklch(0.495 0.145 162)` (deep emerald), `--primary-foreground: oklch(0.99 0.005 162)`
     - `--secondary: oklch(0.955 0.004 250)`, `--muted: oklch(0.955 0.004 250)`, `--muted-foreground: oklch(0.48 0.01 250)`
     - `--border: oklch(0.90 0.005 250)`, `--input: oklch(0.90 0.005 250)`, `--ring: oklch(0.495 0.145 162)`
     - `--status-running: oklch(0.55 0.15 235)`, `--status-warning: oklch(0.62 0.16 75)`, `--status-success: oklch(0.52 0.15 162)`, `--status-danger: oklch(0.577 0.22 27)`
     - `--sidebar: oklch(0.972 0.004 250)`, `--sidebar-border: oklch(0.90 0.005 250)`
   - `.dark` (Default Operator Control Room):
     - `--background: oklch(0.135 0.006 250)`, `--foreground: oklch(0.965 0.004 250)`, `--card: oklch(0.175 0.006 250)`, `--popover: oklch(0.19 0.007 250)`
     - `--primary: oklch(0.70 0.165 162)` (phosphor emerald), `--primary-foreground: oklch(0.14 0.02 162)`
     - `--secondary: oklch(0.225 0.007 250)`, `--muted: oklch(0.215 0.006 250)`, `--muted-foreground: oklch(0.68 0.01 250)`
     - `--border: oklch(1 0 0 / 9%)`, `--input: oklch(1 0 0 / 13%)`, `--ring: oklch(0.70 0.165 162)`
     - `--status-running: oklch(0.72 0.14 235)`, `--status-warning: oklch(0.78 0.15 78)`, `--status-success: oklch(0.72 0.16 162)`, `--status-danger: oklch(0.68 0.20 25)`
     - `--sidebar: oklch(0.155 0.006 250)`, `--sidebar-border: oklch(1 0 0 / 8%)`
   - Base layer rules in `app/globals.css`:
     - `* { @apply border-border outline-ring/50; }`
     - `body { @apply bg-background text-foreground font-sans; }`
     - `button:not(:disabled), [role="button"]:not(:disabled) { cursor: pointer; }`
     - `.tabular-nums { font-variant-numeric: tabular-nums; }`
     - `@media (prefers-reduced-motion: reduce)` rule collapsing animation/transition durations to `0.01ms` so reduced-motion users never get forced motion.
5. Create `components/theme-provider.tsx` (`"use client"`, wrapping `NextThemesProvider` from `next-themes`) and `components/theme-toggle.tsx` (`DropdownMenu` switching `"dark"`, `"light"`, `"system"` with `Sun`/`Moon` icons and `aria-label="Switch color theme"`).
6. Update `app/layout.tsx`:
   - `metadata = { title: "Neiro — AI Team Orchestrator", description: "Hermes VPS & 9Router Multi-Agent Control Room" }`.
   - Set `<html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>`.
   - Wrap `{children}` in `<ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>` + `<TooltipProvider delayDuration={150}>` + `<Toaster richColors closeButton position="bottom-right" />` (from `@/components/ui/sonner`).

### Step 2: Environment Contract, Supabase Schema, and Domain Types (`supabase/schema.sql`, `lib/types.ts`, `lib/supabase.ts`)

1. Create `.env.example` documenting server-only variables (zero `NEXT_PUBLIC_*` secrets):
   - `DASHBOARD_SECRET=change-me-admin-passcode` (min 8 chars)
   - `SUPABASE_URL=https://your-project.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY=eyJ...`
   - `HERMES_DEFAULT_URL=https://hermes-vps.example.com`
   - `HERMES_DEFAULT_KEY=hermes-api-server-key-min-16-chars`
   - `HERMES_PROVIDER_SLUG=` (optional explicit provider override)
   - `NINEROUTER_URL=https://9router.example.com`
   - `NINEROUTER_KEY=sk-optional-9router-key`
2. Create `supabase/schema.sql` with idempotent DDL (`CREATE TABLE IF NOT EXISTS`, indexes, `updated_at` trigger), RLS enabled with **zero public policies** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` on all 5 tables so PostgREST anon keys cannot read `agents.custom_api_key`), and `ON CONFLICT (slug) DO NOTHING` seed rows for the 6 default agents:
   - `agents`: `id uuid PK`, `slug text UNIQUE`, `name text`, `role_stage text CHECK ('orchestrator'|'spec'|'worker'|'qa'|'reviewer'|'cron')`, `specialty text DEFAULT 'fullstack'`, `avatar_color text DEFAULT '#10b981'`, `model text`, `system_prompt text`, `hermes_profile text DEFAULT 'default'`, `custom_base_url text`, `custom_api_key text`, `enabled boolean DEFAULT true`, `created_at timestamptz`, `updated_at timestamptz`. Seed `pm-orchestrator`, `spec-writer`, `backend-worker`, `frontend-worker`, `qa-inspector`, `lead-reviewer`.
   - `missions`: `id uuid PK`, `title text`, `prompt text`, `workspace_path text`, `pause_after_planning boolean DEFAULT false`, `max_parallel_workers int DEFAULT 3 CHECK (1..10)`, `max_retries int DEFAULT 2 CHECK (0..5)`, `status text DEFAULT 'planning' CHECK ('planning'|'writing_spec'|'awaiting_plan_approval'|'running'|'summarizing'|'needs_you'|'completed'|'failed'|'cancelled')`, `summary_run_id text`, `summary_agent_id uuid`, `orchestrator_run_id text`, `orchestrator_agent_id uuid`, `spec_run_id text`, `spec_agent_id uuid`, `error_message text`, `total_tokens int DEFAULT 0`, `created_at timestamptz`, `updated_at timestamptz`.
   - `mission_tasks`: `id uuid PK`, `mission_id uuid FK CASCADE`, `task_key text` (`UNIQUE(mission_id, task_key)`), `title text`, `description text`, `specialty text DEFAULT 'fullstack'`, `depends_on text[] DEFAULT '{}'`, `stage text DEFAULT 'queued' CHECK ('queued'|'coding'|'qa'|'review'|'done'|'needs_you'|'failed'|'cancelled')`, `assigned_agent_id uuid`, `hermes_session_id text`, `active_run_id text`, `active_run_agent_id uuid`, `retry_count int DEFAULT 0`, `worker_output text`, `qa_feedback text`, `review_feedback text`, `pending_approval jsonb`, `total_tokens int DEFAULT 0`, `sort_order int DEFAULT 0`, `created_at timestamptz`, `updated_at timestamptz`.
   - `mission_artifacts`: `id uuid PK`, `mission_id uuid FK CASCADE`, `task_id uuid FK CASCADE`, `agent_id uuid FK SET NULL`, `kind text CHECK ('task_plan'|'prd'|'deliverable'|'qa_report'|'review_report'|'mission_summary')`, `title text`, `content_md text`, `verdict text`, `created_at timestamptz`.
   - `app_state`: `key text PK`, `value jsonb NOT NULL`, `updated_at timestamptz DEFAULT now()` (tracks `last_cron_tick_at`).
3. Create `lib/types.ts` (strict domain interfaces, `AppConfigError` class with `code: "missing_supabase_env" | "missing_hermes_env" | "missing_ninerouter_env"`, `AgentPublic` omitting `custom_api_key` and adding `has_custom_key: boolean`, `MissionSummaryDTO`, `MissionDetailDTO`, `GatewayStatusDTO`) and `lib/supabase.ts` exporting `getSupabaseAdmin()` (`persistSession: false`, `autoRefreshToken: false`, throwing `AppConfigError("missing_supabase_env", ...)` when env vars are absent so Route Handlers return clean `503` JSON).

### Step 3: Passcode Auth Gate & Accessible Login Surface (`lib/auth.ts`, `proxy.ts`, `app/api/auth/route.ts`, `app/login/page.tsx`)

1. Create `lib/auth.ts` using Web Crypto (`crypto.subtle`) HMAC-SHA256:
   - `SESSION_COOKIE = "neiro_session"`, 7-day TTL (`604_800_000` ms).
   - `signSessionToken(secret: string, expiresAtMs?: number): Promise<string>` signing `"neiro-v1:${exp}"` → `${exp}.${hmacHex}`.
   - `verifySessionToken(token: string | undefined, secret: string | undefined): Promise<boolean>` checking `secret.length >= 8`, `exp > Date.now()`, and constant-time HMAC byte comparison.
   - `isAuthorizedRequest(request: NextRequest): Promise<boolean>` accepting valid `neiro_session` cookie OR constant-time `Authorization: Bearer <DASHBOARD_SECRET>` header.
2. Create `proxy.ts` at repo root (Next.js 16 replacement for deprecated `middleware.ts`; **never** export `runtime`):
   - `matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"]`.
   - Allow `/login` and `/api/auth`. Unauthenticated `/api/*` → `401 { error: "Unauthorized" }`; unauthenticated pages → `307` redirect to `/login?next=${encodeURIComponent(pathname + search)}`.
3. Create `app/api/auth/route.ts`:
   - `POST`: returns `503` if `DASHBOARD_SECRET` is unset or `< 8` chars, `401` `{ error: "Invalid passcode" }` on mismatch, or `200` `{ ok: true }` setting `neiro_session` (`httpOnly: true`, `sameSite: "lax"`, `secure: process.env.NODE_ENV === "production"`, `path: "/"`, `maxAge: 604800`).
   - `DELETE`: clears `neiro_session` cookie and returns `200` `{ ok: true }`.
4. Create `app/login/page.tsx` wrapping a `"use client"` `<LoginForm />` inside `<Suspense fallback={<LoginSkeleton />}>` (required by `cacheComponents: true` for `useSearchParams()`):
   - Uses shadcn `Card`, `Label`, `Input` (`type="password"`, `autoComplete="current-password"`, `text-base sm:text-sm` to prevent iOS Safari focus zoom), `Button`, and `Alert` (`role="alert"` for `401`/`503` recovery copy—submit button stays enabled when idle and shows `"Signing in..."` only in-flight, never disabled before validation). Includes `<ThemeToggle />` in top-right corner.

### Step 4: Server-Side Hermes VPS Client, 9Router Client, and Autonomous DAG Engine (`lib/hermes.ts`, `lib/ninerouter.ts`, `lib/orchestrator-parsers.ts`, `lib/orchestrator.ts`)

1. Create `lib/hermes.ts`:
   - `resolveAgentEndpoint(agent)` resolving `custom_base_url || HERMES_DEFAULT_URL`, `custom_api_key || HERMES_DEFAULT_KEY`, and `profilePrefix = hermes_profile !== "default" ? "/p/" + encodeURIComponent(hermes_profile) : ""`; throws `AppConfigError("missing_hermes_env", ...)` if missing.
   - `AbortSignal.timeout(15_000)` on JSON requests; caller `AbortSignal` on SSE streams.
   - Export `probeHermesAgent`, `listHermesCapabilitiesInventory` (graceful `[]` on `404`), `createHermesSession`, `getHermesSessionMessages`, `startHermesRun` (sending `Idempotency-Key`, returning `{ kind: "deferred", reason }` on `429`/`503` and `{ kind: "started", runId }` on `200`/`201`/`202`), `getHermesRun` (mapping `404` to `{ status: "expired_404" }`), `openHermesRunEventStream`, `stopHermesRun`, `submitHermesRunApproval`, `submitHermesRunClarify`, `resolveHermesUnknownRun`, and `hermesJobsRequest`.
2. Create `lib/ninerouter.ts`:
   - `getNineRouterStatus()` calling `GET ${url}/api/health` + `GET ${url}/v1/models` with optional `Bearer ${NINEROUTER_KEY}`, returning `{ ok, latencyMs, models, error }`.
   - `listNineRouterModelsByKind(kind?)` calling `GET ${url}/v1/models${kind ? "/" + kind : ""}`.
3. Create `lib/orchestrator-parsers.ts`:
   - `extractPlanFromOrchestratorOutput(raw: string, fallbackPrompt: string)` extracting fenced JSON or outermost `{ ... }`, normalizing `T1..TN`, stripping invalid/self `dependsOn`, breaking DAG cycles via Kahn's topological sort, and falling back to a single `T1` (`specialty: "fullstack"`) if zero valid tasks parse.
   - `extractGateVerdict(raw: string, passToken: "PASS" | "APPROVED", failToken: "FAIL" | "CHANGES_REQUESTED")` scanning last 15 lines then full output case-insensitively for `VERDICT:\s*(PASS|FAIL|APPROVED|CHANGES_REQUESTED)`, defaulting to `failToken` if missing.
   - `truncateMiddle(text: string, maxChars: number): string` preserving head + tail with `\n…[truncated N chars]…\n`.
4. Create `lib/orchestrator.ts` implementing `pickStageAgent` (least-loaded enabled agent matching `role_stage` and preferred `specialty` → `'fullstack'` → any stage agent) and `advanceMission(missionId: string): Promise<MissionDetailDTO>`:
   - Reconciles `planning` → `writing_spec` → `awaiting_plan_approval` (when `pause_after_planning`) or `running` → `summarizing` → `completed` / `needs_you` / `failed`.
   - Enforces optimistic compare-and-set (`WHERE id = $id AND active_run_id = $observedRunId`) on every transition so concurrent browser + VPS cron ticks never duplicate artifacts or double-increment `retry_count`.
   - Recovers coding-stage `expired_404` runs via `getHermesSessionMessages` (using last assistant message if present, else re-queuing with retry cap); injects dedicated git worktree isolation instructions (`${workspace_path}/.neiro/${task_key}` on branch `neiro/${missionShortId}/${task_key}`) whenever `workspace_path` is provided.

### Step 5: Next.js 16 Route Handlers (`app/api/**`) and VPS Cron Artifact (`deploy/neiro-tick.cron`)

Under `cacheComponents: true`, **never** export `dynamic`, `runtime`, `revalidate`, or `fetchCache`. Call `await connection()` from `"next/server"` at the top of every `GET` handler, use `RouteContext<"/api/...">` for `await ctx.params`, and map `AppConfigError` to HTTP `503 { error, code }`:

1. `app/api/gateway/status/route.ts` (`GET`): returns `{ configured: { supabase, hermes, ninerouter }, cron: { lastTickAt, healthy }, ninerouter, defaultHermes, agentsHealth }`.
2. `app/api/gateway/models/route.ts` (`GET`): proxies `?kind=` to `listNineRouterModelsByKind`.
3. `app/api/agents/route.ts` (`GET`, `POST`), `app/api/agents/[id]/route.ts` (`PATCH`, `DELETE` returning `409` if agent owns active runs), `app/api/agents/[id]/probe/route.ts` (`POST`), and `app/api/agents/seed/route.ts` (`POST` restoring missing starter agents).
4. `app/api/missions/route.ts` (`GET` list with task stage counts, `POST` create + immediate `advanceMission`), `app/api/missions/[id]/route.ts` (`GET` detail, `DELETE` best-effort stop + cascade delete), `app/api/missions/[id]/control/route.ts` (`POST` `"approve_plan" | "cancel" | "resume"`), and `app/api/missions/[id]/tasks/[taskId]/control/route.ts` (`POST` `"retry" | "stop" | "approve_tool" | "deny_tool" | "clarify" | "mark_done"`).
5. `app/api/orchestrator/tick/route.ts` (`POST`): when authorized via `Authorization: Bearer`, upserts `app_state.last_cron_tick_at = to_jsonb(now())`; advances `missionId` or all active missions (`planning | writing_spec | running | summarizing`) concurrently.
6. `app/api/hermes/runs/[runId]/events/route.ts` (`GET` SSE passthrough with `Content-Type: text/event-stream`) and `app/api/hermes/sessions/[sessionId]/messages/route.ts` (`GET` session transcript).
7. `app/api/schedules/route.ts` (`GET`, `POST`) and `app/api/schedules/[jobId]/route.ts` (`PATCH`, `DELETE`, `POST` `"pause" | "resume" | "run"`).
8. Create `deploy/neiro-tick.cron` with header instructions for `NEIRO_URL` and `DASHBOARD_SECRET` plus:
   `* * * * * curl -fsS -m 55 -X POST "$NEIRO_URL/api/orchestrator/tick" -H "Authorization: Bearer $DASHBOARD_SECRET" -H "Content-Type: application/json" -d '{}' >/dev/null 2>&1`

### Step 6: App Shell, `⌘K` Command Palette, and Four Hardened Operator Surfaces (`app/(dashboard)/**`, `components/**`)

Build the product control-room shell using shadcn `SidebarProvider` + `SidebarInset` (without uncached server `cookies()` reads so `cacheComponents: true` builds cleanly) and reset any open `Dialog` / `Sheet` / `CommandDialog` inside a `useEffect` watching `usePathname()` so Next.js 16 `<Activity>` route caching never preserves stale open overlays across navigation:

1. **Persistent Dashboard Shell (`app/(dashboard)/layout.tsx`, `components/app-sidebar.tsx`, `components/setup-banner.tsx`, `components/command-menu.tsx`)**:
   - `AppSidebar` (`collapsible="icon"`): Brand mark (`Neiro` + live status dot), primary nav (`Missions` `/`, `AI Team` `/agents`, `Time AI` `/schedules`, `9Router & VPS` `/gateway`), `⌘K` Command trigger button showing `<kbd>` shortcut, `<ThemeToggle />`, and `Sign out` button (`DELETE /api/auth` + toast + `/login`).
   - Top header bar inside `SidebarInset`: `<SidebarTrigger />`, breadcrumb/route title, live gateway health pill (`9Router` + `VPS` + `Cron`), and global `⌘K` search button.
   - `SetupBanner`: non-blocking `Alert` banner rendered when `/api/gateway/status` reports missing `supabase` / `hermes` / `ninerouter` env vars or `cron.healthy === false`, linking directly to `/gateway` with exact missing env keys.
   - `CommandMenu` (`CommandDialog` via `cmdk` bound to `⌘K` / `Ctrl+K`): quick navigation across all 4 routes, recent missions jump list, `"New mission"` focus action, `"Restore default AI team"` action, and `"Switch theme: Dark / Light"`.
2. **Mission Control, 6-Column Kanban & Live Run Inspector (`app/(dashboard)/page.tsx`, `components/mission-workspace.tsx`, `components/run-inspector-sheet.tsx`, `components/markdown-artifact-viewer.tsx`)**:
   - **1-Prompt Mission Composer (`Card` + `Collapsible` advanced options)**: visible `<Label htmlFor="mission-prompt">Mission objective</Label>`, prompt `Textarea` (`Cmd/Ctrl+Enter` to submit), collapsible operator bar for `VPS workspace path` (`/root/projects/...`), `Switch` for `Pause after PRD for review`, `Select` for `Parallel workers (1–10)` and `Max auto-fix retries (0–5)`, and primary emerald `Button` **Launch mission**.
   - **Mission Switcher + 3s Auto-Tick Loop**: mission selector `Select` + status `Badge` (icon + text, never color alone) + `tabular-nums` token total + `aria-live="polite"` visually-hidden status announcer. Polls `POST /api/orchestrator/tick` every `3000ms` with an in-flight `useRef` guard whenever any mission is active, surfacing transient network/503 issues via `sonner` toast without crashing state.
   - **Pipeline Stepper & Gate Banner**: 4-step progress strip (`1. Plan DAG` → `2. Write PRD` → `3. Execute & Verify` → `4. Summary`); when `status === "awaiting_plan_approval"`, displays high-contrast warning `Alert` with **Approve PRD & start N tasks** primary `Button` and **Cancel mission** secondary `Button`.
   - **Workspace View `Tabs` (`Board` | `Artifacts (N)`)**:
     - **Board tab**: responsive 6-column Kanban (`Queued`, `Coding`, `QA check`, `Final review`, `Needs you`, `Done`) inside horizontal `ScrollArea` on narrow screens and fluid grid on `≥1280px`. Each task card shows `task_key` (`font-mono tabular-nums`), title (`line-clamp-2` + `Tooltip`), assigned agent `Avatar` + model `Badge`, `depends_on` chips, retry badge (`Retry 1/2`), token count, inline tool-approval `Approve` / `Deny` buttons when `pending_approval` exists, and **Inspect run** trigger. Empty state (no missions yet) teaches the 4-stage pipeline with 3 clickable starter prompt chips that populate the composer.
     - **Artifacts tab (`MarkdownArtifactViewer`)**: left list of generated artifacts (`mission_summary` pinned first when present, then `prd`, `task_plan`, `deliverable`, `qa_report`, `review_report` with PASS/FAIL `Badge`) + right `ScrollArea` rendering `react-markdown` + `remark-gfm` inside `prose prose-sm dark:prose-invert max-w-[72ch]` (`@tailwindcss/typography`), paired with **Copy markdown** and **Download .md** buttons (`sonner` confirmation toast).
   - **Live Run Inspector (`RunInspectorSheet`)**: shadcn `Sheet` (`side={isMobile ? "bottom" : "right"}`, `sm:max-w-xl`) opening `EventSource("/api/hermes/runs/" + runId + "/events?agentId=" + agentId)` for active runs and loading `/api/hermes/sessions/.../messages` transcript history. Renders live `tool.started` / `tool.completed` timeline rows, streaming delta output in `Geist Mono`, clarify-prompt reply form when requested, and footer action bar (**Stop run**, **Retry task**, **Mark done**).
3. **AI Team Manager (`app/(dashboard)/agents/page.tsx`, `components/agents-manager.tsx`, `components/model-combobox.tsx`)**:
   - Stage-grouped org lanes (`Orchestrator`, `Spec Writer`, `Parallel Workers`, `QA Gate`, `Final Reviewer`, `Cron`) with agent cards displaying specialty `Badge`, `Geist Mono` 9Router model chip, `/p/<profile>` endpoint badge, `Switch` for `enabled`, **Probe VPS** button (renders latency `ms` + discovered skills/toolsets in a `Popover`), **Edit**, **Clone**, and **Delete** (confirmation `Dialog` handling `409` active-run conflict cleanly via `Alert` + `sonner`). Header includes **Restore starter team** (`POST /api/agents/seed`) and **New agent**.
   - **Agent Create/Edit `Dialog`**: 1-click **Role preset** pills (PM Orchestrator, PRD Architect, Backend Worker, Frontend Worker, DevOps, Researcher, Content/SEO, QA Inspector, Security Reviewer), searchable `ModelCombobox` (`Popover` + `Command` populated from `/api/gateway/models`, highlighting `combo` fallback routes and allowing custom model ID entry), visible labels on all inputs, `system_prompt` `Textarea`, `hermes_profile` input, and optional `custom_base_url` / write-only `custom_api_key` (showing `"Custom key stored — leave blank to keep"` badge when `has_custom_key` is true).
4. **Time AI / Scheduled Jobs (`app/(dashboard)/schedules/page.tsx`, `components/schedules-manager.tsx`)**:
   - Agent profile `Select` + dense shadcn `Table` of Hermes `/api/jobs` with `Geist Mono` cron expression, prompt preview, status `Badge`, `formatRelativeTime(lastRunAt)` (`date-fns`), and row actions (**Run now**, **Pause/Resume**, **Edit**, **Delete**), plus `Skeleton` loading rows, explicit empty state with **Create scheduled job** CTA, and `Dialog` form with 1-click cron presets (`Every hour`, `Daily 08:00`, `Weekdays 09:00`, custom cron).
5. **9Router & VPS Infrastructure (`app/(dashboard)/gateway/page.tsx`, `components/gateway-monitor.tsx`)**:
   - 3 status vitals `Card`s (`9Router LLM Gateway` latency + model count, `Tencent VPS Hermes` readiness + active runs, `24/7 Cron Heartbeat` showing `formatRelativeTime(cron.lastTickAt)` with emerald `<3m` / amber-red `missing` badge and 1-click **Copy crontab** button).
   - Filterable `Tabs` (`all`, `combo`, `chat`, `web`, `image`, `embedding`) + search `Input` over a `Table` of live 9Router models (`id`, `owned_by`, `kind`, 1-click copy model ID) and per-agent VPS health/capabilities matrix.

## Critical files & anchors

- `next.config.ts` — Keeps `cacheComponents: true`, `partialPrefetching: true`, and `@tailwindcss/turbopack` CSS loader intact; forbids `dynamic`/`runtime`/`revalidate` exports in all pages, layouts, and API routes.
- `app/globals.css` — Tailwind v4 CSS-first entry (`@import "tailwindcss"`, `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`, `@plugin "@tailwindcss/typography"`) defining `:root` paper-light and `.dark` control-room OKLCH tokens plus `prefers-reduced-motion` and `tabular-nums` rules.
- `proxy.ts` — Root Next.js 16 auth gate verifying `neiro_session` HMAC-SHA256 cookies for UI/API requests and `Authorization: Bearer` tokens for headless VPS cron ticks.
- `lib/orchestrator.ts` — Serverless-safe DAG state machine advancing `planning → writing_spec → running → summarizing → completed | needs_you` with optimistic SQL compare-and-set locking and Hermes `Idempotency-Key` protection.
- `components/mission-workspace.tsx` — Primary operator surface uniting the 1-prompt mission composer, 3s auto-tick loop, 6-column Kanban board, `@tailwindcss/typography` Markdown artifact reader, and `RunInspectorSheet` SSE drawer.

## Verification

1. **Typegen, Strict TypeScript, Lint, and Next.js 16 Cache Components Production Build**:
   - From `/Users/rezajulian/Documents/neiro`, run:
     `bun install && bunx next typegen && bunx tsc --noEmit && bun run lint && bun run build`
   - Expected: zero TypeScript or ESLint errors, no `package-lock.json` generated, and `next build` succeeds cleanly with `cacheComponents: true` and `@tailwindcss/turbopack`.
2. **Orchestrator Parser Unit Self-Check**:
   - Create `lib/orchestrator-parsers.test.ts` and run `bun test lib/orchestrator-parsers.test.ts`:
     - Asserts fenced JSON `tasks[]` extraction, cyclic `dependsOn` (`T1 → T2 → T1`) cycle-breaking without throwing, malformed output fallback to single `T1`, and missing `VERDICT:` defaulting to `FAIL` / `CHANGES_REQUESTED`.
3. **End-to-End Pipeline + Hardened UI & Visual Smoke Proof**:
   - Start a temporary `scripts/mock-hermes.ts` server (`Bun.serve` on `:8642` + `:20128` mocking Hermes `/health/detailed`, `/v1/capabilities`, `/v1/skills`, `/v1/toolsets`, `/api/sessions`, `/v1/runs`, SSE `/v1/runs/:id/events`, `/api/jobs`, and 9Router `/api/health` + `/v1/models`, failing `T1` QA once before passing on retry; remove temporary mock script after verification) and start `DASHBOARD_SECRET=test-secret-12345 HERMES_DEFAULT_URL=http://127.0.0.1:8642 HERMES_DEFAULT_KEY=test-hermes-key-1234 NINEROUTER_URL=http://127.0.0.1:20128 bun run dev`.
   - Verify auth gate via HTTP: `curl -i http://localhost:3000/` → `307` redirect to `/login?next=%2F`; `curl -i http://localhost:3000/api/agents` → `401 {"error":"Unauthorized"}`.
   - Open `http://localhost:3000` in real Chromium (`browser.open`):
     - Log in at `/login` with `test-secret-12345`; verify `SetupBanner` behavior when Supabase env is unconfigured (`503` graceful empty/alert state rather than crash) and with live/configured env.
     - Press `⌘K` (`Meta+k`) to open `CommandMenu`, jump to `/agents`, open **New agent** `Dialog`, search models inside `ModelCombobox`, probe VPS latency, and toggle Dark ↔ Light theme via `ThemeToggle` verifying OKLCH contrast in both modes.
     - On `/`, launch prompt `"Build discount coupon module with validation API and checkout UI"` in Auto-Pilot mode → observe live 3s progression across `Plan DAG` → `Write PRD` → parallel `Coding` → `QA check` (retry `0 → 1` on `T1` fail) → `Final review` → `Done`, inspect live SSE events in `RunInspectorSheet`, and read rendered GFM tables/code inside the `Artifacts` tab (`prose dark:prose-invert`).
     - Test responsive layout at `375px` (mobile `Sheet` sidebar + `16px` inputs + bottom `RunInspectorSheet`) and `1440px` (6-column Kanban + collapsible icon rail).

## Assumptions & contingencies

- **Tailwind v4 `@tailwindcss/turbopack` CSS imports**: Assumes `@import "shadcn/tailwind.css";` and `@plugin "@tailwindcss/typography";` resolve cleanly through `@tailwindcss/turbopack` in `next.config.ts`. *Contingency*: if `@import "shadcn/tailwind.css"` fails CSS module resolution in `@tailwindcss/turbopack`, remove that single `@import` line from `app/globals.css`—all semantic theme variables, `@theme inline` mappings, and `tw-animate-css` keyframes are already declared directly in `app/globals.css`. If `@plugin "@tailwindcss/typography"` triggers a Turbopack loader error, style `.markdown-body` headings, tables, lists, and code blocks directly inside `app/globals.css` `@layer components`.
- **Supabase availability during local UI smoke testing**: Assumes `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` point to a provisioned Supabase project in `.env.local`. *Contingency*: if live Supabase credentials are absent during local smoke testing, include a lightweight PostgREST `/rest/v1/{agents,missions,mission_tasks,mission_artifacts,app_state}` mock listener on `:54321` inside the temporary `scripts/mock-hermes.ts` harness (`SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=test-service-role-key`, deleted after verification) so production code remains 100% real `@supabase/supabase-js` with zero fake in-app adapters.
- **Hermes 9Router provider routing & 24/7 VPS cron**: Assumes Hermes profiles on Tencent Cloud VPS point their default provider at 9Router `/v1` and run `deploy/neiro-tick.cron` every minute. *Contingency*: setting `HERMES_PROVIDER_SLUG` overrides the provider per `/v1/runs` call without code edits; if VPS egress to Vercel is restricted, schedule the same `curl` tick via Hermes `/api/jobs`.
