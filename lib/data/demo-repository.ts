import "server-only";
import { buildDataset, DEFAULT_DEMO_SITE_ID, type Dataset } from "@/lib/demo/dataset";
import type { JobPlan } from "@/lib/planning/plan-schema";
import type { NewWorkOrderInput, Repository, WorkOrderFilter } from "./repository";
import type {
  AssetClassWithModes,
  AssetDetail,
  InventoryItem,
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
const globalStore = globalThis as unknown as { __trestleDemo?: Dataset };

function store(): Dataset {
  globalStore.__trestleDemo ??= buildDataset();
  return globalStore.__trestleDemo;
}

export function resetDemoStore(): void {
  globalStore.__trestleDemo = buildDataset();
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

  async createWorkOrder(input: NewWorkOrderInput, actorId: string) {
    const db = store();
    const next = Math.max(...db.workOrders.map((w) => Number(w.wo_number.split("-").pop()))) + 1;
    const id = newId();
    db.workOrders.push({
      id,
      site_id: this.siteId,
      wo_number: `WO-26-${next}`,
      ...input,
      stage: "identification",
      status: "open",
      reported_by: actorId,
      planner_id: null,
      assigned_to: null,
      scheduled_date: null,
      estimated_hours: null,
      actual_hours: null,
      plan_summary: null,
      debrief: null,
      created_at: nowIso(),
      updated_at: nowIso(),
      closed_at: null,
    });
    logEvent(db, { wo_id: id, event_type: "created", from_stage: null, to_stage: "identification", note: null, actor_id: actorId });
    return id;
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
    wo.status = "closed";
    wo.actual_hours = actualHours;
    wo.debrief = debrief;
    wo.closed_at = nowIso();
    wo.updated_at = nowIso();
    logEvent(db, { wo_id: woId, event_type: "closed", from_stage: "closure", to_stage: null, note: debrief, actor_id: actorId });
  }
}
