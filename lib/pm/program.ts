/**
 * PM program logic: which PM tasks an asset gets, when they are due, which
 * failure modes the program covers, and whether critical spares are on the
 * shelf. Pure functions, shared by the demo store, the live repository, the
 * screens and the tests.
 */
import type {
  Asset,
  AssetClassWithModes,
  ClassSpare,
  Criticality,
  InventoryItem,
  JobPlanLike,
  PmSchedule,
  PmTask,
} from "./types";

/** Days ahead of the due date that a PM work order is generated. */
export const PM_LEAD_DAYS = 14;

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The tasks an asset of this class and criticality gets. Run-to-failure classes get none. */
export function applicableTasks(cls: Pick<AssetClassWithModes, "pm_tasks" | "run_to_failure">, criticality: Criticality): PmTask[] {
  if (cls.run_to_failure.includes(criticality)) return [];
  return cls.pm_tasks.filter((t) => t.criticalities.includes(criticality));
}

export function effectiveInterval(task: Pick<PmTask, "interval_days" | "interval_days_crit_a">, criticality: Criticality): number {
  return criticality === "A" && task.interval_days_crit_a ? task.interval_days_crit_a : task.interval_days;
}

export type DueState = "overdue" | "due" | "upcoming" | "current";

/**
 * overdue  past the due date
 * due      inside the lead window, so a work order should exist
 * upcoming due within 30 days, after the lead window
 * current  everything else
 */
export function dueState(nextDue: string, today: string, leadDays = PM_LEAD_DAYS): DueState {
  const days = daysBetween(today, nextDue);
  if (days < 0) return "overdue";
  if (days <= leadDays) return "due";
  if (days <= 30) return "upcoming";
  return "current";
}

export interface ProgramSummary {
  schedules: number;
  assetsCovered: number;
  overdue: number;
  due: number;
  upcoming: number;
  /** Share of schedules not overdue, 0 to 100. */
  inCompliancePct: number;
  deferrals: number;
}

export function summarizeProgram(
  schedules: (Pick<PmSchedule, "asset_id" | "next_due_on" | "is_active"> & { deferrals?: unknown[] })[],
  today: string,
): ProgramSummary {
  const active = schedules.filter((s) => s.is_active);
  const states = active.map((s) => dueState(s.next_due_on, today));
  const overdue = states.filter((s) => s === "overdue").length;
  return {
    schedules: active.length,
    assetsCovered: new Set(active.map((s) => s.asset_id)).size,
    overdue,
    due: states.filter((s) => s === "due").length,
    upcoming: states.filter((s) => s === "upcoming").length,
    inCompliancePct: active.length ? Math.round(((active.length - overdue) / active.length) * 100) : 100,
    deferrals: active.reduce((n, s) => n + (s.deferrals?.length ?? 0), 0),
  };
}

export type CoverageState = "covered" | "uncovered" | "run_to_failure" | "not_applicable";

export interface CoverageRow {
  code: string;
  name: string;
  /** Per criticality: covered by at least one task, uncovered, or run to failure. */
  byCriticality: Record<Criticality, { state: CoverageState; tasks: string[] }>;
}

const CRITS: Criticality[] = ["A", "B", "C"];

/** Failure mode coverage: which tasks address each failure mode, per criticality. */
export function coverage(cls: Pick<AssetClassWithModes, "failure_modes" | "pm_tasks" | "run_to_failure">): CoverageRow[] {
  return cls.failure_modes.map((m) => ({
    code: m.code,
    name: m.name,
    byCriticality: Object.fromEntries(
      CRITS.map((c) => {
        if (cls.run_to_failure.includes(c)) return [c, { state: "run_to_failure" as const, tasks: [] }];
        const tasks = applicableTasks(cls, c).filter((t) => t.failure_mode_codes.includes(m.code)).map((t) => t.code);
        return [c, { state: tasks.length ? ("covered" as const) : ("uncovered" as const), tasks }];
      }),
    ) as CoverageRow["byCriticality"],
  }));
}

export interface SpareCheck {
  spare: ClassSpare;
  part_number: string;
  description: string;
  /** Crit A assets at the site this spare protects. */
  protects: Pick<Asset, "id" | "floc">[];
  available: number;
  state: "ok" | "short" | "not_stocked";
}

/** Critical spares for a class at one site: only spares that protect at least one crit A asset there. */
export function checkSpares(
  cls: Pick<AssetClassWithModes, "id" | "spares">,
  siteAssets: Pick<Asset, "id" | "floc" | "class_id" | "criticality" | "model">[],
  inventory: InventoryItem[],
): SpareCheck[] {
  const critA = siteAssets.filter((a) => a.class_id === cls.id && a.criticality === "A");
  return cls.spares.flatMap((spare) => {
    const protects = critA.filter((a) => !spare.model || a.model === spare.model);
    if (!protects.length) return [];
    const stock = inventory.find((i) => i.part_id === spare.part_id);
    const available = stock ? stock.on_hand - stock.reserved : 0;
    return [
      {
        spare,
        part_number: stock?.part.part_number ?? "not in storeroom",
        description: stock?.part.description ?? "",
        protects: protects.map((a) => ({ id: a.id, floc: a.floc })),
        available,
        state: !stock ? "not_stocked" : available >= spare.qty ? "ok" : "short",
      },
    ];
  });
}

/** The job plan a generated PM work order starts with: the template task, plus isolation when the asset comes out of service. */
export function pmWorkPlan(task: PmTask, assetFloc: string): JobPlanLike {
  const steps: JobPlanLike["tasks"] = [];
  if (task.requires_shutdown) {
    steps.push({
      seq: 10,
      day: 1,
      description: `Coordinate with operations; isolate and verify ${assetFloc} per the site energy control procedure`,
      craft: "operations",
      crew_size: 1,
      est_hours: 0.5,
      safety_note: "Verify zero energy before work.",
      acceptance_criteria: null,
    });
  }
  steps.push({
    seq: steps.length ? 20 : 10,
    day: 1,
    description: task.title,
    craft: task.craft,
    crew_size: task.crew_size,
    est_hours: task.est_hours,
    safety_note: null,
    acceptance_criteria: task.acceptance_criteria,
  });
  if (task.requires_shutdown) {
    steps.push({
      seq: 30,
      day: 1,
      description: `Return ${assetFloc} to service and confirm with operations`,
      craft: "operations",
      crew_size: 1,
      est_hours: 0.25,
      safety_note: null,
      acceptance_criteria: "Operating normally.",
    });
  }
  return {
    summary: `${task.code}: ${task.title}`,
    requires_shutdown: task.requires_shutdown,
    tasks: steps,
  };
}

/** After a PM closes, the next due date runs from the completion date. */
export function nextDueAfter(doneOn: string, intervalDays: number): string {
  return addDays(doneOn, intervalDays);
}
