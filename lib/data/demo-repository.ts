import "server-only";
import { buildDataset, type Dataset } from "@/lib/demo/dataset";
import type { JobPlan } from "@/lib/planning/plan-schema";
import type { NewWorkOrderInput, Repository, WorkOrderFilter } from "./repository";
import type {
  AssetDetail,
  InventoryItem,
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

function requireWo(db: Dataset, id: string): WorkOrder {
  const wo = db.workOrders.find((w) => w.id === id);
  if (!wo) throw new Error("Work order not found");
  return wo;
}

function logEvent(db: Dataset, event: Omit<WoEvent, "id" | "created_at">) {
  db.events.push({ ...event, id: newId(), created_at: nowIso() });
}

export class DemoRepository implements Repository {
  readonly mode = "demo" as const;

  async getSite() {
    const db = store();
    return { site: db.site, org: db.org };
  }

  async listProfiles() {
    return store().profiles;
  }

  async listAreas() {
    return store().areas;
  }

  async listWorkOrders(filter: WorkOrderFilter = {}) {
    const db = store();
    return db.workOrders
      .filter(
        (w) =>
          (!filter.stage || w.stage === filter.stage) &&
          (!filter.status || w.status === filter.status) &&
          (!filter.assetId || w.asset_id === filter.assetId),
      )
      .sort((a, b) => a.priority - b.priority || b.created_at.localeCompare(a.created_at))
      .map((w) => toListItem(db, w));
  }

  async getWorkOrder(id: string): Promise<WorkOrderDetail | null> {
    const db = store();
    const wo = db.workOrders.find((w) => w.id === id);
    if (!wo) return null;
    return {
      ...toListItem(db, wo),
      tasks: db.tasks.filter((t) => t.wo_id === id).sort((a, b) => a.seq - b.seq),
      parts: db.woParts
        .filter((p) => p.wo_id === id)
        .map((p) => ({
          ...p,
          part: db.parts.find((x) => x.id === p.part_id) ?? null,
          stock: db.inventory.find((r) => r.part_id === p.part_id) ?? null,
        })),
      events: db.events
        .filter((e) => e.wo_id === id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((e) => ({ ...e, actor_name: db.profiles.find((p) => p.id === e.actor_id)?.full_name ?? null })),
    };
  }

  async listAssets() {
    return [...store().assets].sort((a, b) => a.floc.localeCompare(b.floc));
  }

  async getAsset(id: string): Promise<AssetDetail | null> {
    const db = store();
    const asset = db.assets.find((a) => a.id === id);
    if (!asset) return null;
    const parent = asset.parent_id ? db.assets.find((a) => a.id === asset.parent_id) : undefined;
    return {
      ...asset,
      area: db.areas.find((a) => a.id === asset.area_id)!,
      parent: parent ? { id: parent.id, floc: parent.floc, name: parent.name } : null,
      children: db.assets
        .filter((a) => a.parent_id === id)
        .map((a) => ({ id: a.id, floc: a.floc, name: a.name, status: a.status })),
      history: await this.listWorkOrders({ assetId: id }),
    };
  }

  async listInventory(): Promise<InventoryItem[]> {
    const db = store();
    return db.inventory
      .map((row) => ({ ...row, part: db.parts.find((p) => p.id === row.part_id)! }))
      .sort((a, b) => a.part.part_number.localeCompare(b.part.part_number));
  }

  async createWorkOrder(input: NewWorkOrderInput, actorId: string) {
    const db = store();
    const next = Math.max(...db.workOrders.map((w) => Number(w.wo_number.split("-").pop()))) + 1;
    const id = newId();
    db.workOrders.push({
      id,
      site_id: db.site.id,
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
    const wo = requireWo(db, woId);
    logEvent(db, { wo_id: woId, event_type: "stage_change", from_stage: wo.stage, to_stage: to, note: note ?? null, actor_id: actorId });
    wo.stage = to;
    wo.updated_at = nowIso();
  }

  async rejectWorkOrder(woId: string, actorId: string, note: string) {
    const db = store();
    const wo = requireWo(db, woId);
    wo.status = "rejected";
    wo.updated_at = nowIso();
    logEvent(db, { wo_id: woId, event_type: "rejected", from_stage: wo.stage, to_stage: null, note, actor_id: actorId });
  }

  async commitPlan(woId: string, plan: JobPlan, actorId: string) {
    const db = store();
    const wo = requireWo(db, woId);
    // Replace any earlier plan for this work order.
    db.tasks = db.tasks.filter((t) => t.wo_id !== woId);
    for (const old of db.woParts.filter((p) => p.wo_id === woId && p.status === "reserved")) {
      const row = db.inventory.find((r) => r.part_id === old.part_id);
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
      const row = part ? db.inventory.find((r) => r.part_id === part.id) : undefined;
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
    const wo = requireWo(db, woId);
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
    task.is_complete = true;
    logEvent(db, { wo_id: task.wo_id, event_type: "task_completed", from_stage: null, to_stage: null, note: `Step ${task.seq}: ${task.description}`, actor_id: actorId });
  }

  async issuePart(woPartId: string, actorId: string) {
    const db = store();
    const line = db.woParts.find((p) => p.id === woPartId);
    if (!line) throw new Error("Part line not found");
    if (line.status === "issued") return;
    const row = db.inventory.find((r) => r.part_id === line.part_id);
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
    const wo = requireWo(db, woId);
    wo.status = "closed";
    wo.actual_hours = actualHours;
    wo.debrief = debrief;
    wo.closed_at = nowIso();
    wo.updated_at = nowIso();
    logEvent(db, { wo_id: woId, event_type: "closed", from_stage: "closure", to_stage: null, note: debrief, actor_id: actorId });
  }
}
