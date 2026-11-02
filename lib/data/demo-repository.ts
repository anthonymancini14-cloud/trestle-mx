import "server-only";
import { buildDataset, DEFAULT_DEMO_SITE_ID, seedNumbers, type Dataset } from "@/lib/demo/dataset";
import type { JobPlan } from "@/lib/planning/plan-schema";
import { addDays, dueState, nextDueAfter, PM_LEAD_DAYS, pmWorkPlan } from "@/lib/pm/program";
import { todayAt } from "@/lib/utils";
import { deferralNote, nextJcn, nextWceSeq, wceNumber } from "@/lib/jcn";
import { latestEta } from "@/lib/schedule/calendar";
import type { NewTimeOffInput, NewWorkOrderInput, Repository, WorkOrderFilter } from "./repository";
import type {
  AssetClassWithModes,
  AssetDetail,
  CalendarWorkOrder,
  CrewMember,
  InventoryItem,
  PmScheduleRow,
  Role,
  Site,
  WoEvent,
  WoStage,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderListItem,
} from "@/types/domain";

/**
 * In-memory store seeded from `lib/demo/seed.ts`. It lives on globalThis so it
 * survives hot reloads in development. On serverless hosting it resets when an
 * instance recycles, which is the intended behavior for a public demo.
 */
const globalStore = globalThis as unknown as { __trestleDemo?: Dataset; __trestleDemoDay?: string };

/**
 * The demo's day. Seed dates are relative to when the store is built, so the
 * store is rebuilt when the day turns over: a visitor a month from now sees
 * this week's work, not last month's. (Changes made in the demo reset then too.)
 */
const demoDay = () => todayAt("America/Los_Angeles");

function store(): Dataset {
  const day = demoDay();
  if (!globalStore.__trestleDemo || globalStore.__trestleDemoDay !== day) {
    globalStore.__trestleDemo = buildDataset();
    globalStore.__trestleDemoDay = day;
  }
  return globalStore.__trestleDemo;
}

/** Today's WCE number of each seeded work order, by seed key (for scripted Planning Mode). */
export function demoSeedNumbers(): Map<number, string> {
  return seedNumbers(store());
}

export function resetDemoStore(): void {
  globalStore.__trestleDemo = buildDataset();
  globalStore.__trestleDemoDay = demoDay();
}

const nowIso = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

function toListItem(db: Dataset, wo: WorkOrder): WorkOrderListItem {
  const asset = wo.asset_id ? db.assets.find((a) => a.id === wo.asset_id) : undefined;
  const assignee = wo.assigned_to ? db.profiles.find((p) => p.id === wo.assigned_to) : undefined;
  return {
    ...wo,
    asset: asset ? { id: asset.id, floc: asset.floc, name: asset.name, criticality: asset.criticality } : null,
    assignee_name: assignee?.full_name ?? null,
  };
}

function requireWo(db: Dataset, id: string, siteId: string): WorkOrder {
  // Same scoping the live database enforces with row-level security.
  const wo = db.workOrders.find((w) => w.id === id && w.site_id === siteId);
  if (!wo) throw new Error("Work order not found");
  return wo;
}

/** A new JCN for the site, today in the site's time zone, from the site's block. */
function newJcn(db: Dataset, siteId: string): string {
  const site = db.sites.find((x) => x.id === siteId)!;
  return nextJcn(db.workOrders.filter((w) => w.site_id === siteId).map((w) => w.jcn), todayAt(site.timezone), site.jcn_block);
}

function logEvent(db: Dataset, event: Omit<WoEvent, "id" | "created_at">) {
  db.events.push({ ...event, id: newId(), created_at: nowIso() });
}

/**
 * Demo data layer scoped to one site, like the live repository: every read
 * and write is limited to `siteId`.
 */
export class DemoRepository implements Repository {
  readonly mode = "demo" as const;
  readonly siteId: string;

  constructor(siteId: string = DEFAULT_DEMO_SITE_ID) {
    this.siteId = siteId;
  }

  async getSite() {
    const db = store();
    const site = db.sites.find((s) => s.id === this.siteId);
    if (!site) throw new Error("Site not found");
    return { site, org: db.org };
  }

  async listSites(): Promise<Site[]> {
    return store().sites;
  }

  async listProfiles() {
    const db = store();
    const ids = new Set(db.siteAccess.filter((a) => a.site_id === this.siteId).map((a) => a.user_id));
    // Site crew first, in seed order; the org admin last.
    return db.profiles.filter((p) => ids.has(p.id)).sort((a, b) => Number(a.role === "admin") - Number(b.role === "admin"));
  }

  async listAreas() {
    return store().areas.filter((a) => a.site_id === this.siteId);
  }

  private stock(db: Dataset, partId: string | null) {
    return partId ? db.inventory.find((r) => r.part_id === partId && r.site_id === this.siteId) : undefined;
  }

  async listWorkOrders(filter: WorkOrderFilter = {}) {
    const db = store();
    return db.workOrders
      .filter(
        (w) =>
          w.site_id === this.siteId &&
          (!filter.stage || w.stage === filter.stage) &&
          (!filter.status || w.status === filter.status) &&
          (!filter.assetId || w.asset_id === filter.assetId),
      )
      .sort((a, b) => a.priority - b.priority || b.created_at.localeCompare(a.created_at))
      .map((w) => toListItem(db, w));
  }

  async getWorkOrder(id: string): Promise<WorkOrderDetail | null> {
    const db = store();
    const wo = db.workOrders.find((w) => w.id === id && w.site_id === this.siteId);
    if (!wo) return null;
    return {
      ...toListItem(db, wo),
      tasks: db.tasks.filter((t) => t.wo_id === id).sort((a, b) => a.seq - b.seq),
      parts: db.woParts
        .filter((p) => p.wo_id === id)
        .map((p) => ({
          ...p,
          part: db.parts.find((x) => x.id === p.part_id) ?? null,
          stock: this.stock(db, p.part_id) ?? null,
        })),
      events: db.events
        .filter((e) => e.wo_id === id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((e) => ({ ...e, actor_name: db.profiles.find((p) => p.id === e.actor_id)?.full_name ?? null })),
    };
  }

  async listAssetClasses(): Promise<AssetClassWithModes[]> {
    const db = store();
    const { org } = await this.getSite();
    return db.assetClasses
      .filter((c) => c.org_id === org.id && c.is_active)
      .map((c) => ({
        ...c,
        failure_modes: db.failureModes.filter((m) => m.class_id === c.id).sort((a, b) => a.code.localeCompare(b.code)),
        pm_tasks: db.pmTasks.filter((pt) => pt.class_id === c.id).sort((a, b) => a.code.localeCompare(b.code)),
        spares: db.classSpares.filter((s) => s.class_id === c.id),
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  async listAssets() {
    return store()
      .assets.filter((a) => a.site_id === this.siteId)
      .sort((a, b) => a.floc.localeCompare(b.floc));
  }

  async getAsset(id: string): Promise<AssetDetail | null> {
    const db = store();
    const asset = db.assets.find((a) => a.id === id && a.site_id === this.siteId);
    if (!asset) return null;
    const parent = asset.parent_id ? db.assets.find((a) => a.id === asset.parent_id) : undefined;
    const classes = await this.listAssetClasses();
    return {
      ...asset,
      area: db.areas.find((a) => a.id === asset.area_id)!,
      asset_class: classes.find((c) => c.id === asset.class_id) ?? null,
      parent: parent ? { id: parent.id, floc: parent.floc, name: parent.name } : null,
      children: db.assets
        .filter((a) => a.parent_id === id)
        .map((a) => ({ id: a.id, floc: a.floc, name: a.name, status: a.status })),
      history: await this.listWorkOrders({ assetId: id }),
      route: db.cableRoutes
        .filter((r) => r.cable_id === id)
        .sort((a, b) => a.seq - b.seq)
        .map((r) => {
          const tray = db.assets.find((a) => a.id === r.pathway_id)!;
          return { seq: r.seq, note: r.note, pathway: { id: tray.id, floc: tray.floc, name: tray.name, attributes: tray.attributes } };
        }),
      carried_cables: db.cableRoutes
        .filter((r) => r.pathway_id === id)
        .map((r) => db.assets.find((a) => a.id === r.cable_id)!)
        .sort((a, b) => a.floc.localeCompare(b.floc))
        .map((c) => ({ id: c.id, floc: c.floc, name: c.name, status: c.status, attributes: c.attributes })),
    };
  }

  async listInventory(): Promise<InventoryItem[]> {
    const db = store();
    return db.inventory
      .filter((row) => row.site_id === this.siteId)
      .map((row) => ({ ...row, part: db.parts.find((p) => p.id === row.part_id)! }))
      .sort((a, b) => a.part.part_number.localeCompare(b.part.part_number));
  }

  async createWorkOrder(input: NewWorkOrderInput, actorId: string, opts: { jcn?: string; deferredFrom?: string; stage?: WoStage } = {}) {
    const db = store();
    const jcn = opts.jcn ?? newJcn(db, this.siteId);
    const seq = nextWceSeq(db.workOrders.filter((w) => w.site_id === this.siteId && w.jcn === jcn).map((w) => w.wce_seq));
    const id = newId();
    const stage = opts.stage ?? "identification";
    db.workOrders.push({
      id,
      site_id: this.siteId,
      wo_number: wceNumber(jcn, seq),
      jcn,
      wce_seq: seq,
      deferred_to_jcn: null,
      deferred_from_wo_id: opts.deferredFrom ?? null,
      ...input,
      stage,
      status: "open",
      reported_by: actorId,
      planner_id: null,
      assigned_to: null,
      scheduled_date: null,
      estimated_hours: null,
      actual_hours: null,
      plan_summary: null,
      debrief: null,
      pm_schedule_id: null,
      created_at: nowIso(),
      updated_at: nowIso(),
      closed_at: null,
    });
    logEvent(db, { wo_id: id, event_type: "created", from_stage: null, to_stage: stage, note: seq > 1 ? `WCE ${String(seq).padStart(3, "0")} added to JCN ${jcn}` : null, actor_id: actorId });
    return id;
  }

  async listJcn(jcn: string): Promise<WorkOrderListItem[]> {
    const db = store();
    return db.workOrders
      .filter((w) => w.site_id === this.siteId && w.jcn === jcn)
      .sort((a, b) => a.wce_seq - b.wce_seq)
      .map((w) => toListItem(db, w));
  }

  async addWce(jcn: string, input: NewWorkOrderInput, actorId: string) {
    const db = store();
    const primary = db.workOrders.find((w) => w.site_id === this.siteId && w.jcn === jcn && w.wce_seq === 1);
    if (!primary) throw new Error("JCN not found");
    if (primary.status !== "open") throw new Error("This JCN is closed");
    return this.createWorkOrder(input, actorId, { jcn });
  }

  async deferWorkOrder(woId: string, reason: string, actorId: string): Promise<string> {
    const db = store();
    const wo = requireWo(db, woId, this.siteId);
    if (wo.status !== "open") throw new Error("Only open work can be deferred");
    // The remaining work becomes its own discrepancy under a new JCN, already reported.
    const newId_ = await this.createWorkOrder(
      {
        title: wo.title,
        description: `Deferred from WCE ${wo.wo_number}: ${reason}\n\n${wo.description}`,
        asset_id: wo.asset_id,
        wo_type: wo.wo_type === "preventive" ? "corrective" : wo.wo_type,
        priority: wo.priority,
        requires_shutdown: wo.requires_shutdown,
      },
      actorId,
      { deferredFrom: wo.id, stage: "vetting" },
    );
    const carried = db.workOrders.find((w) => w.id === newId_)!;
    this.releaseParts(db, woId);
    const note = deferralNote(carried.jcn, reason);
    wo.status = "closed";
    wo.debrief = note;
    wo.deferred_to_jcn = carried.jcn;
    wo.closed_at = nowIso();
    wo.updated_at = nowIso();
    logEvent(db, { wo_id: woId, event_type: "closed", from_stage: wo.stage, to_stage: null, note, actor_id: actorId });
    return newId_;
  }

  /** Give back stock held for a work order that won't use it. */
  private releaseParts(db: Dataset, woId: string) {
    for (const p of db.woParts.filter((x) => x.wo_id === woId && (x.status === "reserved" || x.status === "kitted"))) {
      const row = this.stock(db, p.part_id);
      if (row) row.reserved = Math.max(row.reserved - p.qty_required, 0);
      p.status = "planned";
    }
  }

  async setPartEta(woPartId: string, date: string | null, _actorId: string) {
    const db = store();
    const line = db.woParts.find((p) => p.id === woPartId);
    if (!line) throw new Error("Part line not found");
    requireWo(db, line.wo_id, this.siteId);
    if (line.status !== "planned") throw new Error("That part is already on site");
    line.expected_on = date;
  }

  async moveStage(woId: string, to: WoStage, actorId: string, note?: string) {
    const db = store();
    const wo = requireWo(db, woId, this.siteId);
    logEvent(db, { wo_id: woId, event_type: "stage_change", from_stage: wo.stage, to_stage: to, note: note ?? null, actor_id: actorId });
    wo.stage = to;
    wo.updated_at = nowIso();
  }

  async rejectWorkOrder(woId: string, actorId: string, note: string) {
    const db = store();
    const wo = requireWo(db, woId, this.siteId);
    wo.status = "rejected";
    wo.updated_at = nowIso();
    logEvent(db, { wo_id: woId, event_type: "rejected", from_stage: wo.stage, to_stage: null, note, actor_id: actorId });
  }

  async commitPlan(woId: string, plan: JobPlan, actorId: string) {
    const db = store();
    const wo = requireWo(db, woId, this.siteId);
    // Replace any earlier plan for this work order.
    db.tasks = db.tasks.filter((t) => t.wo_id !== woId);
    for (const old of db.woParts.filter((p) => p.wo_id === woId && p.status === "reserved")) {
      const row = this.stock(db, old.part_id);
      if (row) row.reserved -= old.qty_required;
    }
    db.woParts = db.woParts.filter((p) => p.wo_id !== woId);

    for (const t of plan.tasks) {
      db.tasks.push({
        id: newId(),
        wo_id: woId,
        seq: t.seq,
        day: t.day ?? 1,
        description: t.description,
        craft: t.craft,
        crew_size: t.crew_size,
        est_hours: t.est_hours,
        safety_note: t.safety_note,
        acceptance_criteria: t.acceptance_criteria,
        is_complete: false,
      });
    }
    for (const p of plan.parts) {
      const part = p.part_number ? db.parts.find((x) => x.part_number === p.part_number) : undefined;
      const row = part ? this.stock(db, part.id) : undefined;
      const available = row ? row.on_hand - row.reserved : 0;
      const canReserve = !!row && available >= p.qty;
      if (canReserve) row!.reserved += p.qty;
      db.woParts.push({
        id: newId(),
        wo_id: woId,
        part_id: part?.id ?? null,
        description: part?.description ?? p.description,
        qty_required: p.qty,
        qty_used: 0,
        status: canReserve ? "reserved" : "planned",
        // Short parts get an expected date from the catalog lead time; the storeroom can change it.
        expected_on: canReserve || !part?.lead_time_days ? null : addDays(todayAt("UTC"), part.lead_time_days),
      });
    }

    wo.plan_summary = plan.summary;
    wo.requires_shutdown = plan.requires_shutdown;
    wo.estimated_hours = plan.tasks.reduce((s, t) => s + t.est_hours * t.crew_size, 0);
    wo.planner_id = actorId;
    logEvent(db, { wo_id: woId, event_type: "plan_committed", from_stage: "planning", to_stage: "scheduling", note: plan.summary, actor_id: actorId });
    wo.stage = "scheduling";
    wo.updated_at = nowIso();
  }

  async scheduleWorkOrder(woId: string, date: string, assigneeId: string, actorId: string) {
    const db = store();
    const wo = requireWo(db, woId, this.siteId);
    wo.scheduled_date = date;
    wo.assigned_to = assigneeId;
    const name = db.profiles.find((p) => p.id === assigneeId)?.full_name ?? "crew";
    logEvent(db, { wo_id: woId, event_type: "scheduled", from_stage: "scheduling", to_stage: "execution", note: `${date}, ${name}`, actor_id: actorId });
    for (const p of db.woParts.filter((x) => x.wo_id === woId && x.status === "reserved")) p.status = "kitted";
    wo.stage = "execution";
    wo.updated_at = nowIso();
  }

  async completeTask(taskId: string, actorId: string) {
    const db = store();
    const task = db.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("Task not found");
    requireWo(db, task.wo_id, this.siteId);
    task.is_complete = true;
    logEvent(db, { wo_id: task.wo_id, event_type: "task_completed", from_stage: null, to_stage: null, note: `Step ${task.seq}: ${task.description}`, actor_id: actorId });
  }

  async issuePart(woPartId: string, actorId: string) {
    const db = store();
    const line = db.woParts.find((p) => p.id === woPartId);
    if (!line) throw new Error("Part line not found");
    requireWo(db, line.wo_id, this.siteId);
    if (line.status === "issued") return;
    const row = this.stock(db, line.part_id);
    if (row) {
      if (line.status === "reserved" || line.status === "kitted") row.reserved -= line.qty_required;
      row.on_hand = Math.max(0, row.on_hand - line.qty_required);
    }
    line.status = "issued";
    line.qty_used = line.qty_required;
    logEvent(db, { wo_id: line.wo_id, event_type: "part_issued", from_stage: null, to_stage: null, note: `${line.qty_required} × ${line.description}`, actor_id: actorId });
  }

  async closeWorkOrder(woId: string, actualHours: number, debrief: string, actorId: string) {
    const db = store();
    const wo = requireWo(db, woId, this.siteId);
    if (wo.wce_seq === 1 && db.workOrders.some((w) => w.site_id === this.siteId && w.jcn === wo.jcn && w.id !== wo.id && w.status === "open")) {
      throw new Error("WCE -001 closes last: close the other WCEs on this JCN first");
    }
    wo.status = "closed";
    wo.actual_hours = actualHours;
    wo.debrief = debrief;
    wo.closed_at = nowIso();
    wo.updated_at = nowIso();
    logEvent(db, { wo_id: woId, event_type: "closed", from_stage: "closure", to_stage: null, note: debrief, actor_id: actorId });
    // A completed PM restarts its interval from today.
    const schedule = wo.pm_schedule_id ? db.pmSchedules.find((s) => s.id === wo.pm_schedule_id) : undefined;
    if (schedule) {
      schedule.last_done_on = wo.closed_at.slice(0, 10);
      schedule.next_due_on = nextDueAfter(schedule.last_done_on, schedule.interval_days);
    }
  }

  async listCrew(): Promise<CrewMember[]> {
    const db = store();
    return (await this.listProfiles())
      .filter((p) => p.role === "technician" && p.is_active)
      .map((p) => ({
        ...p,
        shift: db.crewShifts.find((c) => c.site_id === this.siteId && c.profile_id === p.id) ?? null,
        time_off: db.timeOff
          .filter((t) => t.site_id === this.siteId && t.profile_id === p.id)
          .sort((a, b) => a.starts_on.localeCompare(b.starts_on)),
      }));
  }

  async listCalendarWork(): Promise<CalendarWorkOrder[]> {
    const db = store();
    return db.workOrders
      .filter((w) => w.site_id === this.siteId && w.status === "open" && w.stage !== "closure")
      .map((w) => {
        const item = toListItem(db, w);
        const assignee = w.assigned_to ? db.profiles.find((p) => p.id === w.assigned_to) : undefined;
        const day_hours: CalendarWorkOrder["day_hours"] = {};
        for (const t of db.tasks.filter((t) => t.wo_id === w.id && !t.is_complete)) {
          const d = (day_hours[t.day] ??= {});
          d[t.craft] = (d[t.craft] ?? 0) + t.est_hours * t.crew_size;
        }
        const short = db.woParts.filter((p) => p.wo_id === w.id && p.status === "planned");
        return {
          id: w.id,
          wo_number: w.wo_number,
          jcn: w.jcn,
          wce_seq: w.wce_seq,
          title: w.title,
          stage: w.stage,
          priority: w.priority,
          wo_type: w.wo_type,
          requires_shutdown: w.requires_shutdown,
          scheduled_date: w.scheduled_date,
          assigned_to: w.assigned_to,
          estimated_hours: w.estimated_hours,
          pm_schedule_id: w.pm_schedule_id,
          created_at: w.created_at,
          asset: item.asset,
          assignee: assignee ? { id: assignee.id, full_name: assignee.full_name, craft: assignee.craft } : null,
          day_hours,
          parts_short: short.length,
          parts_ready_on: latestEta(short),
        };
      });
  }

  async rescheduleWorkOrder(woId: string, date: string, actorId: string, reason?: string) {
    const db = store();
    const wo = requireWo(db, woId, this.siteId);
    if (wo.status !== "open" || wo.stage !== "execution" || !wo.scheduled_date) throw new Error("Only scheduled work can be moved");
    if (wo.scheduled_date === date) return;
    const note = `${wo.scheduled_date} → ${date}${reason ? `: ${reason}` : ""}`;
    wo.scheduled_date = date;
    wo.updated_at = nowIso();
    logEvent(db, { wo_id: woId, event_type: "rescheduled", from_stage: null, to_stage: null, note, actor_id: actorId });
  }

  async setSchedulerRoles(roles: Role[], _actorId: string) {
    const site = store().sites.find((s) => s.id === this.siteId);
    if (!site) throw new Error("Site not found");
    site.scheduler_roles = roles.filter((r) => r !== "admin");
  }

  async addTimeOff(input: NewTimeOffInput, actorId: string) {
    const db = store();
    if (!db.crewShifts.some((c) => c.site_id === this.siteId && c.profile_id === input.profile_id)) throw new Error("Not on this site's roster");
    db.timeOff.push({ ...input, id: newId(), site_id: this.siteId, created_by: actorId, created_at: nowIso() });
  }

  async updateShift(profileId: string, shiftHours: number, workDays: number[], _actorId: string) {
    const db = store();
    const shift = db.crewShifts.find((c) => c.site_id === this.siteId && c.profile_id === profileId);
    if (shift) {
      shift.shift_hours = shiftHours;
      shift.work_days = [...workDays].sort();
    } else {
      if (!db.siteAccess.some((a) => a.site_id === this.siteId && a.user_id === profileId)) throw new Error("Not at this site");
      db.crewShifts.push({ id: newId(), site_id: this.siteId, profile_id: profileId, shift_hours: shiftHours, work_days: [...workDays].sort() });
    }
  }

  async listPmSchedules(filter: { assetId?: string } = {}): Promise<PmScheduleRow[]> {
    const db = store();
    return db.pmSchedules
      .filter((s) => s.site_id === this.siteId && (!filter.assetId || s.asset_id === filter.assetId))
      .map((s) => {
        const asset = db.assets.find((a) => a.id === s.asset_id)!;
        const open = db.workOrders.find((w) => w.pm_schedule_id === s.id && w.status === "open");
        return {
          ...s,
          asset: { id: asset.id, floc: asset.floc, name: asset.name, criticality: asset.criticality },
          task: db.pmTasks.find((t) => t.id === s.pm_task_id)!,
          open_wo: open ? { id: open.id, wo_number: open.wo_number, stage: open.stage } : null,
          deferrals: db.pmDeferrals
            .filter((d) => d.schedule_id === s.id)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((d) => ({ ...d, approver_name: db.profiles.find((p) => p.id === d.approved_by)?.full_name ?? null })),
        };
      })
      .sort((a, b) => a.next_due_on.localeCompare(b.next_due_on) || a.asset.floc.localeCompare(b.asset.floc));
  }

  async generateDuePms(asOf: string, actorId: string): Promise<number> {
    const db = store();
    let created = 0;
    for (const row of await this.listPmSchedules()) {
      if (!row.is_active || row.open_wo) continue;
      const state = dueState(row.next_due_on, asOf, PM_LEAD_DAYS);
      if (state !== "overdue" && state !== "due") continue;
      const plan = pmWorkPlan(row.task, row.asset.floc);
      const jcn = newJcn(db, this.siteId);
      const id = newId();
      db.workOrders.push({
        id,
        site_id: this.siteId,
        wo_number: wceNumber(jcn, 1),
        jcn,
        wce_seq: 1,
        deferred_to_jcn: null,
        deferred_from_wo_id: null,
        title: `PM ${row.task.code}: ${row.task.title}`,
        description: `Preventive maintenance from the PM program, due ${row.next_due_on}. Addresses failure modes ${row.task.failure_mode_codes.join(", ")}.`,
        asset_id: row.asset_id,
        wo_type: "preventive",
        // Routine PMs are P3; an overdue PM on a crit A asset is P2.
        priority: row.asset.criticality === "A" && state === "overdue" ? 2 : 3,
        stage: "scheduling",
        status: "open",
        requires_shutdown: plan.requires_shutdown,
        reported_by: actorId,
        planner_id: actorId,
        assigned_to: null,
        scheduled_date: null,
        estimated_hours: plan.tasks.reduce((s, t) => s + t.est_hours * t.crew_size, 0),
        actual_hours: null,
        plan_summary: plan.summary,
        debrief: null,
        pm_schedule_id: row.id,
        created_at: nowIso(),
        updated_at: nowIso(),
        closed_at: null,
      });
      for (const step of plan.tasks) db.tasks.push({ ...step, id: newId(), wo_id: id, is_complete: false });
      logEvent(db, { wo_id: id, event_type: "created", from_stage: null, to_stage: "scheduling", note: `Generated from PM schedule; due ${row.next_due_on}`, actor_id: actorId });
      created += 1;
    }
    return created;
  }

  async deferPm(scheduleId: string, toDate: string, reason: string, actorId: string) {
    const db = store();
    const schedule = db.pmSchedules.find((s) => s.id === scheduleId && s.site_id === this.siteId);
    if (!schedule) throw new Error("PM schedule not found");
    if (toDate <= schedule.next_due_on) throw new Error("The new date must be after the current due date");
    db.pmDeferrals.push({ id: newId(), schedule_id: scheduleId, from_due_on: schedule.next_due_on, to_due_on: toDate, reason, approved_by: actorId, created_at: nowIso() });
    const open = db.workOrders.find((w) => w.pm_schedule_id === scheduleId && w.status === "open");
    if (open) logEvent(db, { wo_id: open.id, event_type: "note", from_stage: null, to_stage: null, note: `PM deferred from ${schedule.next_due_on} to ${toDate}: ${reason}`, actor_id: actorId });
    schedule.next_due_on = toDate;
  }
}
