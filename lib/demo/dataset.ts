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
import { deferralNote, nextJcn, nextWceSeq, wceNumber } from "@/lib/jcn";
import { todayAt } from "@/lib/utils";
import { addDays, applicableTasks, daysBetween, effectiveInterval, nextDueAfter, PM_LEAD_DAYS } from "@/lib/pm/program";
import { FAILURE_CODES } from "@/lib/taxonomy/failure-codes";
import { ASSET_CLASS_LIBRARY } from "@/lib/taxonomy/library";
import { CLASS_PM, pmTaskCode } from "@/lib/taxonomy/pm-library";
import { WO_STAGES } from "@/types/domain";
import type {
  Addendum,
  FailureCode,
  Finding,
  OperatorAction,
  Resolution,
  AreaCode,
  Asset,
  AssetClass,
  AssetClassWithModes,
  CableRouteSegment,
  ClassSpare,
  CrewShift,
  FailureMode,
  InventoryRow,
  Organization,
  Part,
  PmDeferral,
  PmSchedule,
  PmTask,
  Profile,
  Site,
  TimeOff,
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
  pmTasks: PmTask[];
  classSpares: ClassSpare[];
  pmSchedules: PmSchedule[];
  pmDeferrals: PmDeferral[];
  crewShifts: CrewShift[];
  timeOff: TimeOff[];
  failureCodes: FailureCode[];
  operatorActions: OperatorAction[];
  findings: Finding[];
  resolutions: Resolution[];
  addenda: Addendum[];
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

/** The starter class library as the organization's rows: classes, failure modes, PM tasks and critical spares. */
export function buildClassLibrary(orgId: string): {
  assetClasses: AssetClass[];
  failureModes: FailureMode[];
  pmTasks: PmTask[];
  classSpares: ClassSpare[];
} {
  const assetClasses: AssetClass[] = [];
  const failureModes: FailureMode[] = [];
  const pmTasks: PmTask[] = [];
  const classSpares: ClassSpare[] = [];
  let modeN = 0;
  let taskN = 0;
  let spareN = 0;
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
      run_to_failure: [...(CLASS_PM[def.code]?.runToFailure ?? [])],
      repeat_window_days: CLASS_PM[def.code]?.repeatWindowDays === undefined ? 90 : CLASS_PM[def.code].repeatWindowDays!,
    });
    for (const m of def.failureModes) {
      failureModes.push({ id: seedId("failureMode", ++modeN), class_id: id, ...m });
    }
    for (const task of CLASS_PM[def.code]?.tasks ?? []) {
      pmTasks.push({
        id: seedId("pmTask", ++taskN),
        class_id: id,
        code: pmTaskCode(def.code, task.n),
        title: task.title,
        strategy: task.strategy,
        craft: task.craft,
        crew_size: task.crew ?? 1,
        est_hours: task.hours,
        interval_days: task.intervalDays,
        interval_days_crit_a: task.intervalDaysCritA ?? null,
        criticalities: [...task.criticalities],
        failure_mode_codes: [...task.modes],
        requires_shutdown: task.shutdown ?? false,
        acceptance_criteria: task.accept ?? null,
        is_starter_default: true,
      });
    }
    for (const s of CLASS_PM[def.code]?.spares ?? []) {
      classSpares.push({ id: seedId("classSpare", ++spareN), class_id: id, part_id: partId(s.pn), qty: s.qty, model: s.model ?? null });
    }
  }
  return { assetClasses, failureModes, pmTasks, classSpares };
}

/** Stable pseudo-random number from a string, so seeded PM history is the same on every build. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Seeded deferrals: [asset, task, days deferred, reason, approver first name]. */
const SEED_DEFERRALS: [string, string, number, string, string][] = [
  ["CFD-CUP-CT-01", "FAN-CT-PM02", 21, "Hold until chiller CH-02 is back in service; the tower is needed at full capacity.", "Hana"],
  ["BRP-INT-SCR-101", "SCREEN-TWS-PM03", 30, "River level too high to dewater the intake bay safely; reschedule after the spring runoff.", "Lena"],
];

/**
 * Technician shifts: [first name, hours per shift, weekdays worked (0 = Sunday)].
 * Basalt Ridge runs a weekday plant crew on 10s and 8s; Cedar Flats staggers
 * its 10-hour shifts so a mechanic covers the weekend.
 */
const SEED_SHIFTS: [string, number, number[]][] = [
  ["Jordan", 10, [1, 2, 3, 4]],
  ["Devon", 10, [2, 3, 4, 5]],
  ["Alex", 8, [1, 2, 3, 4, 5]],
  ["Riley", 8, [1, 2, 3, 4, 5]],
  ["Tasha", 10, [1, 2, 3, 4]],
  ["Mateo", 10, [0, 4, 5, 6]],
  ["Kai", 10, [2, 3, 4, 5]],
  ["Rafael", 8, [1, 2, 3, 4, 5]],
  ["Nate", 8, [1, 2, 3, 4, 5]],
  ["Priya", 10, [1, 2, 3, 4]],
  ["Luis", 10, [1, 2, 3, 4]],
];

/** Time off: [first name, starts in days, ends in days, hours per day (null = whole shift), reason]. */
const SEED_TIME_OFF: [string, number, number, number | null, string][] = [
  ["Jordan", 2, 3, null, "Vacation"],
  ["Kai", 1, 1, 4, "NFPA 70E refresher"],
  ["Alex", 15, 19, null, "Vacation"],
  ["Tasha", 9, 9, 5, "Vendor UPS training"],
];

/** The first day on or after `date` that the person works, so seeded jobs never land on a day off. */
function onShiftDay(firstName: string | undefined, date: string): string {
  const days = SEED_SHIFTS.find(([name]) => name === firstName)?.[2];
  if (!days) return date;
  let d = date;
  while (!days.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}

/**
 * Give every seeded work order its JCN and WCE number. A JCN takes the date its
 * -001 was written up (in the site's time zone) and the next job ID from the
 * site's block that day. Other shops' WCEs share the JCN, numbered in the order
 * they were written up. Deferred WCEs point at the JCN that carries the work.
 */
function assignJcns(workOrders: WorkOrder[], seedRows: { id: string; def: WoDef; site: Site }[], events: WoEvent[]): void {
  const byId = new Map(workOrders.map((w) => [w.id, w]));
  const rowOf = (num: number) => {
    const r = seedRows.find((x) => x.def.num === num);
    if (!r) throw new Error(`Unknown seed work order ${num}`);
    return r;
  };
  const used = new Map<string, string[]>();
  const primaries = seedRows.filter((r) => !r.def.wceOf).sort((a, b) => byId.get(a.id)!.created_at.localeCompare(byId.get(b.id)!.created_at));
  for (const r of primaries) {
    const wo = byId.get(r.id)!;
    const taken = used.get(r.site.id) ?? [];
    wo.jcn = nextJcn(taken, todayAt(r.site.timezone, new Date(wo.created_at)), r.site.jcn_block);
    wo.wce_seq = 1;
    used.set(r.site.id, [...taken, wo.jcn]);
  }
  const others = seedRows.filter((r) => r.def.wceOf).sort((a, b) => byId.get(a.id)!.created_at.localeCompare(byId.get(b.id)!.created_at));
  for (const r of others) {
    const wo = byId.get(r.id)!;
    const primary = byId.get(rowOf(r.def.wceOf!).id)!;
    wo.jcn = primary.jcn;
    wo.wce_seq = nextWceSeq(workOrders.filter((w) => w.jcn === primary.jcn).map((w) => w.wce_seq));
  }
  for (const w of workOrders) w.wo_number = wceNumber(w.jcn, w.wce_seq);
  for (const r of seedRows.filter((x) => x.def.deferredTo)) {
    const wo = byId.get(r.id)!;
    const target = byId.get(rowOf(r.def.deferredTo!).id)!;
    wo.deferred_to_jcn = target.jcn;
    wo.debrief = deferralNote(target.jcn, r.def.deferReason ?? "");
    const closedEvent = events.find((e) => e.wo_id === wo.id && e.event_type === "closed");
    if (closedEvent) closedEvent.note = wo.debrief;
    target.deferred_from_wo_id = wo.id;
  }
}

/** Seeded troubleshooting records: operator actions, findings, resolutions and addenda. */
function buildTroubleshooting(workOrders: WorkOrder[], seedRows: { id: string; def: WoDef }[], now: Date) {
  const operatorActions: OperatorAction[] = [];
  const findings: Finding[] = [];
  const resolutions: Resolution[] = [];
  const addenda: Addendum[] = [];
  const nowIso = now.toISOString();
  // Never in the future.
  const hoursAfter = (iso: string, h: number) => {
    const t = new Date(Date.parse(iso) + h * 3_600_000).toISOString();
    return t > nowIso ? nowIso : t;
  };
  for (const { id, def } of seedRows) {
    const t = def.trouble;
    if (!t) continue;
    const wo = workOrders.find((w) => w.id === id)!;
    // The work starts on the scheduled day (07:00 UTC), or at the write-up for work never scheduled.
    const workStart = wo.scheduled_date && `${wo.scheduled_date}T07:00:00.000Z` > wo.created_at ? `${wo.scheduled_date}T07:00:00.000Z` : wo.created_at;
    for (const a of t.actions ?? []) {
      operatorActions.push({
        id: seedId("operatorAction", operatorActions.length + 1),
        wo_id: id,
        conditions: a.conditions,
        action: a.action,
        result: a.result,
        ran_minutes: a.ranMinutes ?? null,
        corrects_id: null,
        created_by: personId(a.by),
        // Operator actions before the write-up are entered with it.
        created_at: hoursAfter(wo.created_at, Math.max(a.at, 0)),
      });
    }
    const ids = (t.findings ?? []).map((f) => {
      const fid = seedId("finding", findings.length + 1);
      findings.push({
        id: fid,
        wo_id: id,
        test: f.test,
        value: f.value ?? null,
        unit: f.unit ?? null,
        spec: f.spec ?? null,
        result: f.result,
        note: f.note ?? null,
        corrects_id: null,
        created_by: personId(f.by),
        created_at: hoursAfter(f.onReport ? wo.created_at : workStart, f.at),
      });
      return fid;
    });
    const r = t.resolution;
    if (r) {
      resolutions.push({
        id: seedId("resolution", resolutions.length + 1),
        wo_id: id,
        failure_mode: r.mode ?? null,
        mechanism: r.mechanism ?? null,
        cause: r.cause ?? null,
        no_fault_found: r.nff ?? false,
        cause_narrative: r.why,
        remedy: r.remedy,
        verification: r.verification ?? null,
        verification_passed: r.verified ?? null,
        operator_review: r.review,
        operator_review_note: r.reviewNote ?? null,
        finding_ids: r.supportedBy.map((i) => ids[i]),
        supersedes_id: null,
        created_by: personId(r.by),
        // Never after the close.
        created_at: wo.closed_at && hoursAfter(workStart, r.at) > wo.closed_at ? wo.closed_at : hoursAfter(workStart, r.at),
      });
    }
    for (const a of t.addenda ?? []) {
      addenda.push({ id: seedId("addendum", addenda.length + 1), wo_id: id, body: a.body, created_by: personId(a.by), created_at: hoursAfter(wo.closed_at!, a.daysAfterClose * 24) });
    }
  }
  return { operatorActions, findings, resolutions, addenda };
}

/** The current WCE number of each seeded work order, by seed key (for demo plans that cite history). */
export function seedNumbers(db: Pick<Dataset, "workOrders">): Map<number, string> {
  const out = new Map<number, string>();
  let woN = 0;
  for (const { woDefs } of [...SITE_SEEDS].reverse()) {
    for (const def of woDefs) {
      const id = seedId("wo", ++woN);
      const wo = db.workOrders.find((w) => w.id === id);
      if (wo) out.set(def.num, wo.wo_number);
    }
  }
  return out;
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

  const library = buildClassLibrary(ORG.id);
  const classesWithTasks: (AssetClass & Pick<AssetClassWithModes, "pm_tasks">)[] = library.assetClasses.map((c) => ({
    ...c,
    pm_tasks: library.pmTasks.filter((t) => t.class_id === c.id),
  }));
  // One schedule per asset per applicable PM task: the maintenance index.
  const scheduleKeys: { id: string; asset: Asset; task: PmTask; interval: number }[] = [];
  for (const asset of ALL_ASSETS) {
    const cls = classesWithTasks.find((c) => c.id === asset.class_id);
    if (!cls) continue;
    for (const task of applicableTasks(cls, asset.criticality)) {
      scheduleKeys.push({ id: seedId("pmSchedule", scheduleKeys.length + 1), asset, task, interval: effectiveInterval(task, asset.criticality) });
    }
  }
  const scheduleFor = (floc: string | null, code: string) => {
    const key = scheduleKeys.find((k) => k.asset.floc === floc && k.task.code === code);
    if (!key) throw new Error(`No PM schedule for ${floc} ${code}`);
    return key.id;
  };

  let woN = 0;
  const seedRows: { id: string; def: WoDef; site: Site }[] = [];
  for (const { site, woDefs, crew } of [...SITE_SEEDS].reverse()) {
    for (const def of woDefs) {
      const id = seedId("wo", ++woN);
      seedRows.push({ id, def, site });
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
        // Numbered after every row exists: see the JCN pass below.
        wo_number: "",
        jcn: "",
        wce_seq: 0,
        deferred_to_jcn: null,
        deferred_from_wo_id: null,
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
            ? onShiftDay(def.assignedTo, dateIn(def.scheduledInDays))
            : stageIndex >= WO_STAGES.indexOf("execution")
              ? at(stageDaysAgo(WO_STAGES.indexOf("execution"))).slice(0, 10)
              : null,
        estimated_hours: estHours,
        actual_hours: def.actualHours ?? null,
        plan_summary: def.planSummary ?? null,
        debrief: status === "closed" ? def.debrief ?? null : null,
        pm_schedule_id: def.pm ? scheduleFor(def.floc, def.pm) : null,
        created_at: createdAt,
        updated_at: closedAt ?? at(Math.max(stageDaysAgo(stageIndex) - (status === "rejected" ? 1 : 0), 0)),
        closed_at: closedAt,
      });

      def.tasks?.forEach((t, i) => {
        tasks.push({
          id: seedId("task", ++taskN),
          wo_id: id,
          seq: (i + 1) * 10,
          day: t.day ?? 1,
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
          expected_on: status === "planned" && p.etaInDays !== undefined ? dateIn(p.etaInDays) : null,
        });
        // Open reservations hold stock until the part is issued.
        if (pid && (status === "reserved" || status === "kitted")) {
          const row = inventory.find((r) => r.part_id === pid && r.site_id === site.id);
          if (row) row.reserved += p.qty;
        }
      });
    }
  }

  // Lead work (a scaffold) lands on its crew's last work day before the job it supports.
  for (const r of seedRows.filter((x) => x.def.startsBefore)) {
    const wo = workOrders.find((w) => w.id === r.id)!;
    const target = workOrders.find((w) => w.id === seedRows.find((x) => x.def.num === r.def.startsBefore)!.id)!;
    const days = SEED_SHIFTS.find(([name]) => name === r.def.assignedTo)?.[2] ?? [0, 1, 2, 3, 4, 5, 6];
    let d = addDays(target.scheduled_date!, -1);
    while (!days.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1);
    wo.scheduled_date = d;
    // Its last step (strike the scaffold) falls on the crew's first work day after the main job's last day.
    const own = tasks.filter((t) => t.wo_id === wo.id);
    const last = own.at(-1);
    if (last && last.day > 1) {
      const mainDays = Math.max(1, ...tasks.filter((t) => t.wo_id === target.id).map((t) => t.day));
      let strike = addDays(target.scheduled_date!, mainDays);
      while (!days.includes(new Date(`${strike}T00:00:00Z`).getUTCDay())) strike = addDays(strike, 1);
      last.day = daysBetween(d, strike) + 1;
    }
  }
  for (const r of seedRows.filter((x) => x.def.startsWith)) {
    const wo = workOrders.find((w) => w.id === r.id)!;
    const target = workOrders.find((w) => w.id === seedRows.find((x) => x.def.num === r.def.startsWith)!.id)!;
    wo.scheduled_date = onShiftDay(r.def.assignedTo, target.scheduled_date!);
  }
  assignJcns(workOrders, seedRows, events);
  const record = buildTroubleshooting(workOrders, seedRows, now);

  // PM schedule dates: from linked work orders where there are any, otherwise a
  // stable spread across each interval, with a few overdue for realism.
  const today = now.toISOString().slice(0, 10);
  const pmSchedules: PmSchedule[] = scheduleKeys.map(({ id, asset, task, interval }) => {
    const linked = workOrders.filter((w) => w.pm_schedule_id === id);
    const lastClosed = linked.filter((w) => w.status === "closed").sort((a, b) => b.closed_at!.localeCompare(a.closed_at!))[0];
    const open = linked.find((w) => w.status === "open");
    let lastDone: string | null;
    let nextDue: string;
    if (open) {
      // Generated inside the lead window before it fell due.
      nextDue = addDays(open.created_at.slice(0, 10), PM_LEAD_DAYS);
      lastDone = lastClosed ? lastClosed.closed_at!.slice(0, 10) : addDays(nextDue, -interval);
    } else if (lastClosed) {
      lastDone = lastClosed.closed_at!.slice(0, 10);
      nextDue = nextDueAfter(lastDone, interval);
    } else {
      const h = hash(`${asset.floc}|${task.code}`);
      const overdue = h % 29 === 0;
      // At least a day ago, so nothing reads as done tomorrow in any site's time zone.
      const ago = overdue ? interval + 3 + (h % 18) : Math.max(1, Math.floor((interval * (h % 1000)) / 1000));
      lastDone = addDays(today, -ago);
      nextDue = nextDueAfter(lastDone, interval);
      // Nothing is done before the asset exists: commissioning is the baseline.
      if (asset.install_date && lastDone < asset.install_date) {
        lastDone = null;
        nextDue = nextDueAfter(asset.install_date, interval);
      }
    }
    return { id, site_id: asset.site_id, asset_id: asset.id, pm_task_id: task.id, interval_days: interval, last_done_on: lastDone, next_due_on: nextDue, is_active: true };
  });
  const pmDeferrals: PmDeferral[] = SEED_DEFERRALS.map(([floc, code, days, reason, approver], i) => {
    const schedule = pmSchedules.find((s) => s.id === scheduleFor(floc, code))!;
    const from = addDays(today, -2);
    schedule.next_due_on = addDays(from, days);
    schedule.last_done_on = addDays(from, -schedule.interval_days);
    return {
      id: seedId("pmDeferral", i + 1),
      schedule_id: schedule.id,
      from_due_on: from,
      to_due_on: schedule.next_due_on,
      reason,
      approved_by: personId(approver),
      created_at: at(3),
    };
  });

  const siteOf = (profileId: string) => SITE_ACCESS.find((a) => a.user_id === profileId)!.site_id;
  const crewShifts: CrewShift[] = SEED_SHIFTS.map(([name, hours, days], i) => ({
    id: seedId("crewShift", i + 1),
    site_id: siteOf(personId(name)),
    profile_id: personId(name),
    shift_hours: hours,
    work_days: days,
  }));
  const timeOff: TimeOff[] = SEED_TIME_OFF.map(([name, from, to, hours, reason], i) => ({
    id: seedId("timeOff", i + 1),
    site_id: siteOf(personId(name)),
    profile_id: personId(name),
    starts_on: dateIn(from),
    ends_on: dateIn(to),
    hours_per_day: hours,
    reason,
    created_by: null,
    created_at: at(5),
  }));

  return {
    org: ORG,
    // Copies, so a settings change in the demo store never edits the seed.
    sites: DEMO_SITES.map((site) => ({ ...site, scheduler_roles: [...site.scheduler_roles] })),
    areas: [...AREAS, ...DC_AREAS],
    profiles: ALL_PROFILES,
    siteAccess: SITE_ACCESS,
    ...library,
    pmSchedules,
    pmDeferrals,
    crewShifts,
    timeOff,
    failureCodes: FAILURE_CODES.map((c, i) => ({ id: seedId("failureCode", i + 1), org_id: ORG.id, class_id: null, ...c })),
    ...record,
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
