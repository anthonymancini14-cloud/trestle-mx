import type { InventoryItem, WorkOrderListItem, WoStage } from "@/types/domain";
import { WO_STAGES } from "@/types/domain";

export interface DashboardMetrics {
  openCount: number;
  stageCounts: Record<WoStage, number>;
  /** Crew-hours of planned work waiting to be scheduled or executed. */
  readyBacklogHours: number;
  /** Share of open work that is preventive or predictive. */
  proactivePct: number;
  /** Mean actual/estimated hours on closed work with both values; 1.0 = perfect. */
  estimateRatio: number | null;
  /** Closed work orders behind estimateRatio. */
  estimateSample: number;
  emergencyOpen: number;
  lowStock: InventoryItem[];
}

export function computeMetrics(workOrders: WorkOrderListItem[], inventory: InventoryItem[]): DashboardMetrics {
  const open = workOrders.filter((w) => w.status === "open");
  const stageCounts = Object.fromEntries(WO_STAGES.map((s) => [s, 0])) as Record<WoStage, number>;
  for (const w of open) stageCounts[w.stage] += 1;

  const readyBacklogHours = open
    .filter((w) => w.stage === "scheduling" || w.stage === "execution")
    .reduce((sum, w) => sum + (w.estimated_hours ?? 0), 0);

  const proactive = open.filter((w) => w.wo_type === "preventive" || w.wo_type === "predictive").length;

  const estimated = workOrders.filter(
    (w) => w.status === "closed" && (w.estimated_hours ?? 0) > 0 && w.actual_hours !== null,
  );
  const estimateRatio = estimated.length
    ? estimated.reduce((sum, w) => sum + w.actual_hours! / w.estimated_hours!, 0) / estimated.length
    : null;

  return {
    openCount: open.length,
    stageCounts,
    readyBacklogHours,
    proactivePct: open.length ? Math.round((proactive / open.length) * 100) : 0,
    estimateRatio,
    estimateSample: estimated.length,
    emergencyOpen: open.filter((w) => w.priority === 1).length,
    lowStock: inventory.filter((i) => i.on_hand - i.reserved < i.min_qty),
  };
}
