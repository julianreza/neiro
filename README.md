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
The full backend engine is implemented:
- **Database & Schema**: `supabase/schema.sql` (5 tables with RLS and seed agents), `lib/supabase.ts` and `lib/types.ts`.
- **Authentication & Proxy**: `proxy.ts` (Next.js 16 route protection gate), `lib/auth.ts` (HMAC-SHA256 session token), `app/api/auth/route.ts`, and `app/login/page.tsx`.
- **Engine & Integrations**: `lib/hermes.ts` (Hermes VPS client), `lib/ninerouter.ts` (9Router gateway client), `lib/orchestrator-parsers.ts` (cycle-breaking DAG parser), and `lib/orchestrator.ts` (mission lifecycle state machine).
- **API Route Handlers**: `/api/missions/*`, `/api/agents/*`, `/api/schedules/*`, `/api/gateway/*`, `/api/hermes/*`, `/api/orchestrator/tick`, and `deploy/neiro-tick.cron`.

Validate the application with:
`bun test && bunx next typegen && bunx tsc --noEmit && bun run lint && bun run build`

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
