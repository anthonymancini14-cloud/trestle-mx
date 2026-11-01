import { seedId } from "./ids";
import {
  AREAS,
  ASSETS,
  BRP_CREW,
  INVENTORY,
  ORG,
  PARTS,
  PROFILES,
  SITE,
  WO_DEFS,
  classId,
  type WoDef,
} from "./seed";
import {
  DC_AREAS,
  DC_ASSETS,
  DC_CABLE_ROUTES,
  DC_CREW,
  DC_INVENTORY,
  DC_PARTS,
  DC_PROFILES,
  DC_SITE,
  DC_WO_DEFS,
} from "./seed-datacenter";
import { ASSET_CLASS_LIBRARY } from "@/lib/taxonomy/library";
import { WO_STAGES } from "@/types/domain";
import type {
  AreaCode,
  Asset,
  AssetClass,
  CableRouteSegment,
  FailureMode,
  InventoryRow,
  Organization,
  Part,
  Profile,
  Site,
  WoEvent,
  WoPart,
  WoTask,
  WorkOrder,
} from "@/types/domain";

export interface SiteAccess {
  user_id: string;
  site_id: string;
}

export interface Dataset {
  org: Organization;
  sites: Site[];
  areas: AreaCode[];
  profiles: Profile[];
  siteAccess: SiteAccess[];
  assetClasses: AssetClass[];
  failureModes: FailureMode[];
  assets: Asset[];
  cableRoutes: CableRouteSegment[];
  parts: Part[];
  inventory: InventoryRow[];
  workOrders: WorkOrder[];
  tasks: WoTask[];
  woParts: WoPart[];
  events: WoEvent[];
}

const DAY_MS = 86_400_000;

type Crew = typeof BRP_CREW;

interface SiteSeed {
  site: Site;
  woDefs: WoDef[];
  crew: Crew;
}

/** Every demo site, in switcher order. The data center is the default demo site. */
const SITE_SEEDS: SiteSeed[] = [
  { site: DC_SITE, woDefs: DC_WO_DEFS, crew: DC_CREW },
  { site: SITE, woDefs: WO_DEFS, crew: BRP_CREW },
];

export const DEMO_SITES: Site[] = SITE_SEEDS.map((s) => s.site);
export const DEFAULT_DEMO_SITE_ID = DC_SITE.id;

export const ALL_PROFILES: Profile[] = [...PROFILES, ...DC_PROFILES];
const ALL_ASSETS: Asset[] = [...ASSETS, ...DC_ASSETS];
const ALL_PARTS: Part[] = [...PARTS, ...DC_PARTS];

/** The org admin works across both sites; everyone else works at one. */
const ORG_ADMIN = PROFILES.find((p) => p.role === "admin")!.id;
export const SITE_ACCESS: SiteAccess[] = [
  ...PROFILES.map((p) => ({ user_id: p.id, site_id: SITE.id })),
  ...DC_PROFILES.map((p) => ({ user_id: p.id, site_id: DC_SITE.id })),
  { user_id: ORG_ADMIN, site_id: DC_SITE.id },
];

export function personId(firstName: string): string {
  const p = ALL_PROFILES.find((x) => x.full_name.split(" ")[0] === firstName);
  if (!p) throw new Error(`Unknown person ${firstName}`);
  return p.id;
}
function assetId(floc: string): string {
  const a = ALL_ASSETS.find((x) => x.floc === floc);
  if (!a) throw new Error(`Unknown asset ${floc}`);
  return a.id;
}
function partId(pn: string): string {
  const p = ALL_PARTS.find((x) => x.part_number === pn);
  if (!p) throw new Error(`Unknown part ${pn}`);
  return p.id;
}

function buildCableRoutes(): CableRouteSegment[] {
  let n = 0;
  return DC_CABLE_ROUTES.flatMap(({ cable, route }) =>
    route.map((step, i) => ({
      id: seedId("cableRoute", ++n),
      cable_id: assetId(cable),
      seq: (i + 1) * 10,
      pathway_id: assetId(step.tray),
      note: step.note ?? null,
    })),
  );
}

/** The starter class library as the organization's rows. */
export function buildClassLibrary(orgId: string): { assetClasses: AssetClass[]; failureModes: FailureMode[] } {
  const assetClasses: AssetClass[] = [];
  const failureModes: FailureMode[] = [];
  let modeN = 0;
  for (const def of ASSET_CLASS_LIBRARY) {
    const id = classId(def.code);
    assetClasses.push({
      id,
      org_id: orgId,
      code: def.code,
      name: def.name,
      category: def.category,
      verticals: [...def.verticals],
      description: def.description,
      attributes: def.attributes.map((a) => ({ ...a })),
      is_active: true,
    });
    for (const m of def.failureModes) {
      failureModes.push({ id: seedId("failureMode", ++modeN), class_id: id, ...m });
    }
  }
  return { assetClasses, failureModes };
}

/** Expand the seed definitions into normalized rows with real timestamps. */
export function buildDataset(now: Date = new Date()): Dataset {
  const at = (daysAgo: number, hourOffset = 0) =>
    new Date(now.getTime() - daysAgo * DAY_MS + hourOffset * 3_600_000).toISOString();
  const dateIn = (days: number) =>
    new Date(now.getTime() + days * DAY_MS).toISOString().slice(0, 10);

  const workOrders: WorkOrder[] = [];
  const tasks: WoTask[] = [];
  const woParts: WoPart[] = [];
  const events: WoEvent[] = [];
  const inventory = [...INVENTORY, ...DC_INVENTORY].map((row) => ({ ...row }));

  let taskN = 0;
  let partN = 0;
  let eventN = 0;

  let woN = 0;
  for (const { site, woDefs, crew } of [...SITE_SEEDS].reverse()) {
    for (const def of woDefs) {
      const id = seedId("wo", ++woN);
      const status = def.status ?? "open";
      const stageIndex = WO_STAGES.indexOf(def.stage);
      const createdAt = at(def.createdDaysAgo);
      // Open work spreads its stage changes between creation and now. Closed work
      // runs over a realistic duration for its priority and was closed back then,
      // so history reads as history (and Planning Mode sees real dates).
      const closed = status === "closed";
      const duration = closed ? closedDuration(def) : Math.max(def.createdDaysAgo, 0.5);
      const stageDaysAgo = (s: number) =>
        closed
          ? def.createdDaysAgo - duration * CLOSED_STAGE_AT[s]
          : def.createdDaysAgo - (duration / (stageIndex + 2)) * s;

      events.push({
        id: seedId("event", ++eventN),
        wo_id: id,
        event_type: "created",
        from_stage: null,
        to_stage: "identification",
        note: null,
        actor_id: personId(def.reportedBy),
        created_at: createdAt,
      });
      for (let s = 1; s <= stageIndex; s++) {
        const to = WO_STAGES[s];
        events.push({
          id: seedId("event", ++eventN),
          wo_id: id,
          event_type: to === "scheduling" && def.planSummary ? "plan_committed" : "stage_change",
          from_stage: WO_STAGES[s - 1],
          to_stage: to,
          note: to === "scheduling" && def.planSummary ? def.planSummary : null,
          actor_id: stageActor(to, crew),
          created_at: at(stageDaysAgo(s)),
        });
      }
      const closedAt = closed ? at(def.createdDaysAgo - duration) : null;
      if (status === "closed") {
        events.push({
          id: seedId("event", ++eventN),
          wo_id: id,
          event_type: "closed",
          from_stage: "closure",
          to_stage: null,
          note: def.debrief ?? null,
          actor_id: personId(crew.supervisor),
          created_at: closedAt!,
        });
      }
      if (status === "rejected") {
        events.push({
          id: seedId("event", ++eventN),
          wo_id: id,
          event_type: "rejected",
          from_stage: "vetting",
          to_stage: null,
          note: def.rejectNote ?? null,
          actor_id: personId(crew.gatekeeper),
          // The gatekeeper rejects within a day of the request reaching vetting.
          created_at: at(Math.max(stageDaysAgo(stageIndex) - 1, 0)),
        });
      }

      const estHours =
        def.estHours ?? (def.tasks ? def.tasks.reduce((sum, t) => sum + t.hours * (t.crew ?? 1), 0) : null);

      workOrders.push({
        id,
        site_id: site.id,
        wo_number: `WO-26-${def.num}`,
        title: def.title,
        description: def.description,
        asset_id: def.floc ? assetId(def.floc) : null,
        wo_type: def.type,
        priority: def.priority,
        stage: def.stage,
        status,
        requires_shutdown: def.shutdown ?? false,
        reported_by: personId(def.reportedBy),
        planner_id: stageIndex >= 3 ? personId(crew.planner) : null,
        assigned_to: def.assignedTo ? personId(def.assignedTo) : null,
        scheduled_date:
          def.scheduledInDays !== undefined
            ? dateIn(def.scheduledInDays)
            : stageIndex >= WO_STAGES.indexOf("execution")
              ? at(stageDaysAgo(WO_STAGES.indexOf("execution"))).slice(0, 10)
              : null,
        estimated_hours: estHours,
        actual_hours: def.actualHours ?? null,
        plan_summary: def.planSummary ?? null,
        debrief: status === "closed" ? def.debrief ?? null : null,
        created_at: createdAt,
        updated_at: closedAt ?? at(Math.max(stageDaysAgo(stageIndex) - (status === "rejected" ? 1 : 0), 0)),
        closed_at: closedAt,
      });

      def.tasks?.forEach((t, i) => {
        tasks.push({
          id: seedId("task", ++taskN),
          wo_id: id,
          seq: (i + 1) * 10,
          description: t.desc,
          craft: t.craft,
          crew_size: t.crew ?? 1,
          est_hours: t.hours,
          safety_note: t.safety ?? null,
          acceptance_criteria: t.accept ?? null,
          is_complete: t.done ?? false,
        });
      });

      def.parts?.forEach((p) => {
        const pid = p.pn ? partId(p.pn) : null;
        const status = p.status ?? "planned";
        woParts.push({
          id: seedId("woPart", ++partN),
          wo_id: id,
          part_id: pid,
          description: p.desc ?? ALL_PARTS.find((x) => x.id === pid)?.description ?? "Unlisted part",
          qty_required: p.qty,
          qty_used: p.used ?? 0,
          status,
        });
        // Open reservations hold stock until the part is issued.
        if (pid && (status === "reserved" || status === "kitted")) {
          const row = inventory.find((r) => r.part_id === pid && r.site_id === site.id);
          if (row) row.reserved += p.qty;
        }
      });
    }
  }

  return {
    org: ORG,
    sites: DEMO_SITES,
    areas: [...AREAS, ...DC_AREAS],
    profiles: ALL_PROFILES,
    siteAccess: SITE_ACCESS,
    ...buildClassLibrary(ORG.id),
    assets: ALL_ASSETS.map((a) => ({ ...a, attributes: { ...a.attributes } })),
    cableRoutes: buildCableRoutes(),
    parts: ALL_PARTS,
    inventory,
    workOrders,
    tasks,
    woParts,
    events,
  };
}

/**
 * Where each stage change falls within a closed job's duration (0 = opened,
 * 1 = closed). Vetting is quick, planning and waiting for a slot take most of
 * the time, and the work itself is near the end.
 */
const CLOSED_STAGE_AT = [0, 0.05, 0.2, 0.55, 0.8, 0.92];

/** Days from opened to closed, by priority, unless the seed says otherwise. */
const CLOSE_AFTER_DAYS: Record<1 | 2 | 3 | 4, number> = { 1: 1, 2: 9, 3: 16, 4: 35 };

function closedDuration(def: WoDef): number {
  const days = def.closedAfterDays ?? CLOSE_AFTER_DAYS[def.priority];
  // Never close in the future or today: leave at least half a day.
  return Math.min(days, Math.max(def.createdDaysAgo - 0.5, 0.25));
}

function stageActor(stage: (typeof WO_STAGES)[number], crew: Crew): string {
  switch (stage) {
    case "vetting":
    case "planning":
      return personId(crew.gatekeeper);
    case "scheduling":
      return personId(crew.planner);
    case "execution":
      return personId(crew.supervisor);
    case "closure":
      return personId(crew.technician);
    default:
      return personId(crew.planner);
  }
}
