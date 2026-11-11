# Trestle.MX — notes for Claude

AI-native CMMS for industrial, utility and data center maintenance. Public portfolio project for Anthony Mancini. The centerpiece is **Planning Mode** (`app/(app)/planning/[id]`, `components/planning/`, `lib/anthropic/`, `lib/planning/`). Read `README.md` for the architecture. The local-model task layer and the AI audit queue are in `lib/ai`, `app/(app)/audit` and `components/audit/`.

## Hard rules

- **Fictional data only.** The demo sites are invented: Cedar Flats Data Center (default) and Basalt Ridge Plant. Never add a real employer, site, person, or the pulp/paper vertical. `tests/demo-data.test.ts` fails the build if banned terms appear.
- **Verticals: industrial/utility and data center, set per site.** Utility: water, steam, power, compressed air, rotating equipment. Data center: UPS and batteries, switchgear, generators, chillers, CRAH/CRAC, liquid cooling, BMS/EPMS. The core (lifecycle, roles, Planning Mode, RLS) is vertical-neutral; vertical content lives in Layer 2 context packs and demo data. Decision TMX-002.
- **Trestle branding.** Navy / brass / steel palette in `app/globals.css`. Logo at `public/trestle-mark.png`.
- **Locked stack:** Next.js (App Router), TypeScript strict, Tailwind + shadcn-style primitives, Supabase, Vercel, pnpm. Don't swap libraries without asking.
- **Runtime AI is local by default** (decided 2026-11-11). AI tasks run on a local open-weight model behind the task layer in `lib/ai`, reached through any OpenAI-style server or LM Studio. Claude is an optional tier and stays the default for Planning Mode (`claude-sonnet-5-5` via `ANTHROPIC_MODEL`) until a local model passes a plan eval. Model choices are set by eval scores, not hardcoded. Claude is still the build tool.
- **Models never compute numbers and never commit.** A model reads, extracts, classifies and drafts. Counts, costs, dates and scores come from code and SQL. Every AI output is a proposal a person reviews (the audit queue).
- **Direction: three sides on one database** (CMMS, EAM, Projects). Only the CMMS and the AI audit queue are built. Anything else is "designed" in the README until it is in the repo.
- **Pushing to `main` deploys to Vercel.** Before every push to main: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must pass. Use a branch + PR for anything large.

## Conventions

- All reads and writes go through the `Repository` interface (`lib/data/repository.ts`); implement both `DemoRepository` and `SupabaseRepository`. Both are scoped to one site; the demo store must filter by `siteId` the way RLS does.
- Lifecycle and role rules live only in `lib/workflow.ts`. Mutations are server actions in `lib/actions.ts` and must call `assertCan`.
- Planning Mode context is markdown in `lib/anthropic/context/` — edit the .md, never hardcode context strings.
- AI tasks live in `lib/ai`: one task = an output schema (zod), a prompt in `lib/ai/prompts/*.md`, deterministic checks, and an entry in `lib/ai/registry.ts`. Keep `lib/ai` free of `server-only` so the worker and eval scripts can import it. Schema and checks that client components need go in a file with no Node imports (see `tasks/worklog-schema.ts`).
- AI runs are written by the worker only (`claim_ai_job`, `complete_ai_job`, service role). The demo runs the model in the server action instead. Reviews are insert-only.
- A demo output that no model produced is labeled "scripted" on screen. Never present scripted output as a model run or quote an eval score that isn't recorded.
- Demo plans in `lib/planning/demo-plans.ts` must validate against `jobPlanSchema` and only cite catalog part numbers (tests enforce this).
- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_name.sql`, idempotent, RLS enabled and policies in the same file, `site_access` pattern for site scoping, rollback notes at the bottom.
- UI: dense, industrial, status always labeled, monospace for tags/WO numbers/part numbers, 44px targets on technician views.

## Commands

```bash
pnpm dev          # demo mode at localhost:3000
pnpm test         # vitest
pnpm typecheck && pnpm lint && pnpm build
pnpm test:db      # every migration twice on a throwaway local Postgres, then supabase/tests/*.test.sql
pnpm eval:worklog # score work-log extraction on the local model in LOCAL_AI_BASE_URL / LOCAL_AI_MODEL
pnpm ai:worker    # live mode: run queued AI jobs on the local model
```

## Working remotely

Anthony often drives sessions from his phone via Remote Control. Keep replies short, finish with what changed and whether it's pushed, and ask before anything irreversible.
