# Trestle.MX — notes for Claude

AI-native CMMS for industrial and utility plants. Public portfolio project for Anthony Mancini. The centerpiece is **Planning Mode** (`app/(app)/planning/[id]`, `components/planning/`, `lib/anthropic/`, `lib/planning/`). Read `README.md` for the architecture.

## Hard rules

- **Fictional data only.** The demo plant (Basalt Ridge Plant, Northfork Utility District) is invented. Never add a real employer, site, person, or the pulp/paper vertical. `tests/demo-data.test.ts` fails the build if banned terms appear.
- **Industrial/utility focus.** Water, steam, power, compressed air, rotating equipment.
- **Trestle branding.** Navy / brass / steel palette in `app/globals.css`. Logo at `public/trestle-mark.png`.
- **Locked stack:** Next.js (App Router), TypeScript strict, Tailwind + shadcn-style primitives, Supabase, Claude API (`claude-sonnet-5-5` via `ANTHROPIC_MODEL`), Vercel, pnpm. Don't swap libraries without asking.
- **Pushing to `main` deploys to Vercel.** Before every push to main: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must pass. Use a branch + PR for anything large.

## Conventions

- All reads and writes go through the `Repository` interface (`lib/data/repository.ts`); implement both `DemoRepository` and `SupabaseRepository`.
- Lifecycle and role rules live only in `lib/workflow.ts`. Mutations are server actions in `lib/actions.ts` and must call `assertCan`.
- Planning Mode context is markdown in `lib/anthropic/context/` — edit the .md, never hardcode context strings.
- Demo plans in `lib/planning/demo-plans.ts` must validate against `jobPlanSchema` and only cite catalog part numbers (tests enforce this).
- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_name.sql`, idempotent, RLS enabled and policies in the same file, `site_access` pattern for site scoping, rollback notes at the bottom.
- UI: dense, industrial, status always labeled, monospace for tags/WO numbers/part numbers, 44px targets on technician views.

## Commands

```bash
pnpm dev          # demo mode at localhost:3000
pnpm test         # vitest
pnpm typecheck && pnpm lint && pnpm build
```

## Working remotely

Anthony often drives sessions from his phone via Remote Control. Keep replies short, finish with what changed and whether it's pushed, and ask before anything irreversible.
