import { seedId } from "./ids";
import {
  AREAS,
  ASSETS,
  INVENTORY,
  ORG,
  PARTS,
  PROFILES,
  SITE,
  WO_DEFS,
  assetId,
  partId,
  personId,
} from "./seed";
import { WO_STAGES } from "@/types/domain";
import type {
  AreaCode,
  Asset,
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

export interface Dataset {
  org: Organization;
  site: Site;
  areas: AreaCode[];
  profiles: Profile[];
  assets: Asset[];
  parts: Part[];
  inventory: InventoryRow[];
  workOrders: WorkOrder[];
  tasks: WoTask[];
  woParts: WoPart[];
  events: WoEvent[];
}

const DAY_MS = 86_400_000;

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
  const inventory = INVENTORY.map((row) => ({ ...row }));

  let taskN = 0;
  let partN = 0;
  let eventN = 0;

  for (const [index, def] of WO_DEFS.entries()) {
    const id = seedId("wo", index + 1);
    const status = def.status ?? "open";
    const stageIndex = WO_STAGES.indexOf(def.stage);
    const createdAt = at(def.createdDaysAgo);
    // Spread stage changes evenly between creation and "now" (or close-out).
    const span = Math.max(def.createdDaysAgo, 0.5);
    const stepDays = span / (stageIndex + 2);

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
        actor_id: stageActor(to),
        created_at: at(def.createdDaysAgo - stepDays * s),
      });
    }
    const closedAt = status === "closed" ? at(Math.max(def.createdDaysAgo - span + 1, 0)) : null;
    if (status === "closed") {
      events.push({
        id: seedId("event", ++eventN),
        wo_id: id,
        event_type: "closed",
        from_stage: "closure",
        to_stage: null,
        note: def.debrief ?? null,
        actor_id: personId("Lena"),
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
        actor_id: personId("Sam"),
        created_at: at(def.createdDaysAgo - 1),
      });
    }

    const estHours =
      def.estHours ?? (def.tasks ? def.tasks.reduce((sum, t) => sum + t.hours * (t.crew ?? 1), 0) : null);

    workOrders.push({
      id,
      site_id: SITE.id,
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
      planner_id: stageIndex >= 3 ? personId("Marcus") : null,
      assigned_to: def.assignedTo ? personId(def.assignedTo) : null,
      scheduled_date:
        def.scheduledInDays !== undefined
          ? dateIn(def.scheduledInDays)
          : status === "closed" || def.stage === "closure"
            ? closedAt?.slice(0, 10) ?? dateIn(-2)
            : null,
      estimated_hours: estHours,
      actual_hours: def.actualHours ?? null,
      plan_summary: def.planSummary ?? null,
      debrief: status === "closed" ? def.debrief ?? null : null,
      created_at: createdAt,
      updated_at: closedAt ?? at(Math.max(def.createdDaysAgo - stepDays * stageIndex, 0)),
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
        description: p.desc ?? PARTS.find((x) => x.id === pid)?.description ?? "Unlisted part",
        qty_required: p.qty,
        qty_used: p.used ?? 0,
        status,
      });
      // Open reservations hold stock until the part is issued.
      if (pid && (status === "reserved" || status === "kitted")) {
        const row = inventory.find((r) => r.part_id === pid);
        if (row) row.reserved += p.qty;
      }
    });
  }

  return {
    org: ORG,
    site: SITE,
    areas: AREAS,
    profiles: PROFILES,
    assets: ASSETS,
    parts: PARTS,
    inventory,
    workOrders,
    tasks,
    woParts,
    events,
  };
}

function stageActor(stage: (typeof WO_STAGES)[number]): string {
  switch (stage) {
    case "vetting":
      return personId("Sam");
    case "planning":
      return personId("Sam");
    case "scheduling":
      return personId("Marcus");
    case "execution":
      return personId("Lena");
    case "closure":
      return personId("Jordan");
    default:
      return personId("Marcus");
  }
}
