This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Design system

Phase 1 provides shadcn/ui `radix-nova` primitives in `components/ui/`, semantic Tailwind v4 tokens in `app/globals.css`, and Geist fonts. The existing `@tailwindcss/turbopack` integration remains unchanged.

The root layout installs the theme, tooltip, and toast providers. Dark mode is the default; `ThemeToggle` supports light, dark, and system preferences persisted by `next-themes`.

Neiro uses a pitch-obsidian operations palette with radiant solar amber for primary actions and accents, balanced by neutral slate and glowing status indicators (sky for execution, amber for warning/review, emerald for success, and rose for blockers). Light mode uses clean slate-paper surfaces with high-contrast amber accents.

Card surfaces feature modern 3D floating depth: specular top rim lights, ambient diffused shadows, subtle hover elevation, and standalone metric containers. Buttons feature a tactile gradient sheen with press feedback. Tables and trays provide subtle frosted backgrounds for scanning. Visual dials: ENERGY 2 / RHYTHM 2 / MOTION 1.

## Backend

- **Database & schema**: `supabase/schema.sql` creates `agents`, `missions`, `mission_tasks`, `mission_artifacts` and `app_state`, with RLS enabled and no public policies, so only the server-side service-role client can read or write them. The file is idempotent: re-run it to apply the latest migration block on an existing database.
- **Authentication**: `proxy.ts` gates every route except `/login`, `/api/auth` and the static SVGs listed in `PUBLIC_SVGS`. Sessions are HMAC-SHA256 tokens (`lib/auth.ts`).
- **Orchestrator**: `lib/orchestrator.ts` is a poll-driven state machine (mission phases `planning → spec → executing → summarizing → done`; task stages `Queued → Coding → QA check → Final review → Done`). Each tick does at most one guarded step per mission and task, starts Hermes runs and reads them on a later tick, resolves dependencies by `task_key`, and honours `pause_after_planning`, `max_retries` and `max_parallel_workers`. Overlapping ticks are safe. Errors are logged and stored in `missions.last_error`.
- **Integrations**: `lib/hermes.ts` (Hermes VPS client), `lib/ninerouter.ts` (9Router gateway client).
- **Ticks**: `POST /api/orchestrator/tick`, driven by the VPS cron in `deploy/neiro-tick.cron`. The dashboard does not tick missions itself.

### Live vs demo data

Every surface loads from its API first. If the API is unavailable, it shows labelled sample data with a visible "Demo data — reason" badge.

| Surface | Live source | Writes when live | Demo fallback |
| --- | --- | --- | --- |
| Mission control | `/api/missions`, `/api/missions/:id` | Launch, approve plan, cancel, task controls | Sample missions; launch disabled |
| AI team | `/api/agents` | Create, edit, enable/disable, delete, restore starters | Sample agents; all edits disabled |
| Schedules (Time AI) | `/api/schedules` (Hermes jobs) | None (read-only; manage jobs on Hermes) | Sample schedules |
| 9Router & VPS | `/api/gateway/status`, `/api/gateway/models` | None | Sample model catalog; health shown as unknown |

The "Sample agent capabilities" table and the cron snippet on the gateway page are always documentation samples.

### Environment

Copy `.env.example` to `.env.local`. The server-side Supabase client reads only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never set a `NEXT_PUBLIC_*` service-role key: Next.js inlines `NEXT_PUBLIC_*` values into browser JavaScript, and the app refuses to start the admin client if `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` is present.

Validate the application with:
`bun run test && bunx next typegen && bunx tsc --noEmit && bun run lint && bun run build`

`bun run test` runs `bun test --conditions=react-server`, which lets server-only modules load in tests.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
