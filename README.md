# Trestle.MX

**An AI-native maintenance management system (CMMS) for industrial, utility and data center maintenance, built around one idea: the planner's job plan is where reliability is won or lost.**

Most CMMS products treat the work order as a form. Trestle.MX treats it as a process with six stages, and puts the most leverage at stage three. **Planning Mode** pairs the maintenance planner with Claude to turn a vetted work order into a job plan a crew can execute safely in one trip, grounded in safety standards, the plant's own work history, and what is actually on the storeroom shelf.

![Planning Mode: the assistant revises the job plan after the planner asks about a weeping seal](docs/screenshots/planning-mode.png)

> The demo runs on two fictional sites of one fictional operator, Northfork Infrastructure: **Cedar Flats Data Center** (the default) and **Basalt Ridge Plant**, a water and utility plant. Every person, asset and record is invented.

---

## Planning Mode

A planner opens an authorized work order. The assistant drafts a plan, explains its reasoning, and revises it as the planner asks questions or edits the plan by hand. Nothing is committed until the planner commits it.

What makes it useful rather than generic:

| It uses | So that |
|---|---|
| **Site history**, including the sister unit's closed work orders and debriefs | A plan for pump B learns that pump A's identical job overran by 3.5 hours because of soft foot and an undersized chain fall, and plans for both |
| **Live stock** (on hand minus reserved) | Part numbers come from the catalog, never invented; zero-stock items are flagged before the job is scheduled |
| **Standards context** loaded from markdown | Isolation points by tag and energy type, permits, hazards and controls, measurable acceptance criteria |
| **A structured plan schema** (one zod schema drives the tool definition, validation and UI) | The plan is data: steps, crafts, crew-hours, parts, open questions. Committing it writes tasks, reserves stock and moves the work order to Scheduling in one transaction |

The planner stays the decision-maker. The assistant states the failure cause as a hypothesis with evidence, puts unknowns in an "open questions" list instead of guessing, and every proposed isolation point is marked for field verification against the site's written procedure.

### Three layers of context

```
Layer 1  lib/anthropic/context/layer1/                     universal: energy control, electrical safety,
                                                           permits, planning practice, rotating equipment
Layer 2  lib/anthropic/context/layer2-<vertical>/          chosen by the site's vertical:
           layer2-industrial-utility/                      redundancy, compliance analyzers, chemical feed,
                                                           steam, cooling towers, standby power
           layer2-data-center/                             2N and N+1 redundancy, MOPs and change windows,
                                                           liquid cooling, cable plant practice
Layer 3  built per request from the database               the asset and its train, closed work and debriefs,
                                                           storeroom stock, available crafts
```

Layers 1 and 2 are markdown files, not strings in code, so standards guidance can be reviewed and edited like documentation. They are sent as a cached system block (prompt caching), so repeat turns are cheap. Layer 3 is assembled fresh each turn.

### How a turn works

```mermaid
sequenceDiagram
  participant P as Planner (browser)
  participant R as /api/ai/planning
  participant DB as Repository (Supabase or demo)
  participant C as Claude

  P->>R: history + current plan (incl. manual edits)
  R->>DB: work order, asset train, history, stock
  R->>C: system (rules + cached L1/L2) + L3 context + messages, tool: update_job_plan
  C-->>R: streamed text, then update_job_plan(plan)
  R-->>P: NDJSON stream: text deltas, status, validated plan
  P->>P: plan panel updates, changed steps highlighted
  P->>R: Commit plan (server action)
  R->>DB: commit_work_order_plan(): tasks, parts, reservations, event, stage
```

Each turn is stateless on the server. The client sends the conversation and the current plan, so the planner's direct edits are what Claude revises.

Without an `ANTHROPIC_API_KEY`, Planning Mode runs a scripted planner with hand-written plans for the jobs in the demo queue. It uses the same stream protocol, so the public demo always works.

<p align="center"><img src="docs/screenshots/planning-mobile.png" width="300" alt="Planning Mode on a phone"></p>

---

## Asset class library

A fleet can only compare maintenance site to site if every site describes its equipment the same way. Trestle.MX holds one **asset class library per organization**; sites use it and cannot invent their own classes.

| Each class defines | So that |
|---|---|
| **Required and optional nameplate fields** (typed: number with unit, pick-list, yes/no, text) | Every centrifugal pump carries flow, head, speed, configuration and seal type, at every site |
| **Known failure modes** with ISO 14224 style codes and how each is detected | PM tasks and troubleshooting records point back to the failure they prevent or found |
| **Verticals** it applies to (industrial/utility, data center) | One library serves a mixed portfolio; each site has a vertical |

The starter library (`lib/taxonomy/library.ts`) has 29 classes and 108 failure modes, from centrifugal pumps and transformers to static UPS modules, battery strings, CRAHs and liquid-cooling CDUs. Classes are deliberately broad (configuration is an attribute, not a separate class) so each class has enough members to compare.

The register shows **data quality against the standard**: share of assets classified, share with every required field, and which fields are missing. Incomplete assets can still be saved, because real registers are built up over time, but the gap is always visible. Planning Mode reads the asset's class, nameplate and failure modes, and names the suspected failure mode by code in the plan.

---

## Cable plant

At the data center, the cable plant is part of the asset register, so a cable job tells the crew exactly where to work.

| Record | What it holds |
|---|---|
| **Cable tray section** (class `CABLE-TRAY`) | One labeled section of a pathway: wire mesh basket tray, cable ladder rack or solid-bottom tray; service (fiber, copper, power), width, depth, location and elevation, design fill |
| **Installed cable** (class `CABLE`) | Its label, both end points (frame, panel, port), installed length and the storeroom part it is made from |
| **Cable route** (`cable_routes`) | The tray sections the cable runs through, end A to end B, in order |
| **Storeroom cable spec** | Cable type, fiber or conductor count and gauge, length, outer diameter, jacket, both terminations and polarity |

A work order on a cable shows the route, so the technician knows which tray sections to open and work within; a tray section lists the cables it carries. Planning Mode gets the route, end points and replacement spec, names the trays in the plan, and works bend radius limits out from the cable's outer diameter. The database refuses a route through anything but a tray section at the cable's own site.

---

## Sites and verticals

Each site has a vertical (industrial/utility or data center). The core is the same everywhere: lifecycle, roles, Planning Mode, the class library and per-site security. The vertical picks Planning Mode's Layer 2 guidance pack and which classes apply. The top bar switches between the sites a user can access (in the demo, both sites).

---

## The work order lifecycle

| Stage | Who | What happens |
|---|---|---|
| 1. Identification | Anyone | A discrepancy is reported against an asset |
| 2. Vetting | Gatekeeper | Authorized for planning, or rejected with a reason |
| 3. **Planning** | Planner | **Planning Mode** builds the job plan; commit reserves parts |
| 4. Scheduling | Supervisor | Date and lead technician assigned; reserved parts are kitted |
| 5. Execution | Technician | Steps ticked off (tablet-sized targets), parts issued |
| 6. Closure | Supervisor | Actual hours and an after-action debrief, which feeds the next plan |

![Dashboard](docs/screenshots/dashboard.png)

Role and stage rules live in one pure module (`lib/workflow.ts`) used by both the UI (which buttons show) and the server actions (which mutations are allowed). Six roles: admin, supervisor, planner, gatekeeper, technician, storeroom.

---

## Architecture

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions, `proxy.ts`) |
| Language | TypeScript, strict |
| UI | Tailwind CSS 4, shadcn/ui-style primitives, lucide icons |
| Database and auth | Supabase (PostgreSQL 17, Row Level Security, Supabase Auth) |
| AI | Anthropic Claude API, `claude-sonnet-5-5`, tool use + streaming + prompt caching |
| Hosting | Vercel |
| Tests | Vitest |

### Two data modes, one interface

Everything goes through a `Repository` interface (`lib/data/repository.ts`) with two implementations:

- **Demo** (`DemoRepository`): two in-memory fictional sites. No setup; the top bar switches site and lets a visitor act as anyone who works there. The demo store applies the same per-site scoping the database enforces.
- **Live** (`SupabaseRepository`): multi-tenant Postgres. Every query runs under the signed-in user's JWT, so RLS scopes all data. Atomic multi-row writes go through Postgres functions.

The app runs in live mode when Supabase environment variables are present, and in demo mode otherwise.

### Data model

Fifteen tables, created in dependency order by the migrations in `supabase/migrations/`:

`organizations` → `sites` (with a vertical) → `area_codes` · `profiles` → `site_access` · `asset_classes` (org-wide) → `asset_class_failure_modes` · `assets` (FLOC hierarchy, class and attributes) → `cable_routes` (cable → tray sections) · `work_orders` → `wo_tasks`, `wo_events`, `wo_parts` · `parts_catalog` (org-wide, with specs) → `inventory` (per site)

### Multi-tenancy and security

- Every operational table is scoped to a `site_id`. Policies check membership through a `site_access` table, not a column on `profiles`, so a user who works across several sites needs new rows, not a migration.
- Role checks use a `SECURITY DEFINER` helper (`current_user_role()`) to avoid recursive RLS.
- `wo_events` is append-only: insert as yourself, no update or delete policy.
- The class library is readable from any site in the org and writable only by admins. Planners classify assets; they cannot change the standard. A trigger refuses an asset whose class belongs to another organization.
- Work orders are never deleted, only rejected or closed.
- `commit_work_order_plan()` and `issue_work_order_part()` are `SECURITY DEFINER` functions that re-check site access, role and stage before touching inventory, so a planner can reserve stock without having write access to the inventory table.

The migrations and policies are tested against Postgres (idempotent re-run, cross-site and cross-org isolation, role-gated plan commit, admin-only library changes).

---

## Running it

```bash
pnpm install
pnpm dev          # http://localhost:3000, demo mode, scripted planner
```

Add Claude to Planning Mode:

```bash
cp .env.example .env.local
# set ANTHROPIC_API_KEY
```

Live mode with Supabase:

```bash
supabase link --project-ref <ref>
supabase db push                         # applies the migrations
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SEED_PASSWORD=... pnpm seed:live
# set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local
# sign in as owen@demo.trestle.mx (data center planner) or marcus@demo.trestle.mx (plant planner)
```

Checks:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Project structure

```
app/
  page.tsx                  demo entry: pick a role
  (app)/dashboard           KPIs, lifecycle pipeline, "waiting on you"
  (app)/planning            Planning queue and Planning Mode
  (app)/work-orders         list, detail with stage actions, new (searchable asset picker)
  (app)/assets              FLOC registry, data quality, asset history
  (app)/asset-classes       class library: data standard and failure modes per class
  (app)/inventory           storeroom
  api/ai/planning           Planning Mode stream
components/planning/        workspace (chat + live plan) and plan editor
lib/
  workflow.ts               lifecycle rules
  actions.ts                server actions (every mutation)
  data/                     Repository interface, demo and Supabase implementations
  anthropic/                Claude planner, prompt, context loader, site context (layer 3)
  planning/                 plan schema, stream protocol, scripted demo planner
  taxonomy/                 asset class library and data-quality checks
  assets/                   asset search for pickers
  demo/                     fictional sites: data center and utility plant
supabase/migrations/        schema, RLS, functions
tests/                      workflow, data integrity, Planning Mode, plan commit, class library, cable plant, sites
```

## Design decisions

- **The plan is structured data, not a chat transcript.** Chat is how the plan gets made; the plan is what gets committed, scheduled, kitted and measured.
- **One standard, defended.** Asset classes belong to the organization, not the site. Data gaps are shown, not hidden, so the register earns trust instead of becoming a database nobody believes.
- **History beats general knowledge.** The most valuable context is the closed work order on the sister unit. Debriefs are required at close-out because Planning Mode reads them.
- **The assistant never commits.** It drafts and explains. The planner edits, confirms open questions and commits.
- **Safety output is specific and marked for verification.** Named isolation points and energy types, never a bare "perform LOTO" step, and always subject to the site's written procedure.
- **Industrial UI.** Dense tables, status always visible and always labeled, monospace for tags and part numbers, dark theme for control rooms, large touch targets for technicians on tablets.

## Roadmap

- Planning session history saved per work order (`planning_sessions` table)
- PM strategy: PM tasks linked to the failure modes they address, frequency by criticality, deferral rules, critical spares per class
- Troubleshooting record: operator actions, findings and proven cause, coded against the class failure modes
- Fleet view: PM compliance, deferrals, backlog aging and repeat failures compared across sites
- Data center: a colo site, redundancy model (N, N+1, 2N, A/B paths) that warns when a job drops redundancy, MOP fields in the plan, vendor and colo provider scope
- Tray fill tracking from cable outer diameters against each section's design fill
- Weekly schedule builder with crew capacity
- Retrieval over OEM manuals as a fourth context layer
- Reliability metrics: repeat failures, MTBF by asset class, estimate accuracy by planner

---

Built by Anthony Mancini, a maintenance planner with a background in aircraft and industrial maintenance, as a portfolio project. Built with Claude.

## License

MIT
