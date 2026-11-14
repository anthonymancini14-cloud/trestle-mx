import { addCosts, costOfRow, sumCosts, ZERO_COST, type WoCost } from "@/lib/cost";
import { downtime, woDowntimeHours, type DowntimeSummary } from "@/lib/downtime";
import type { AssetStatusEventItem, WoCostRow, WoType } from "@/types/domain";

/**
 * A site's cost and downtime over a period, from the logged hours, issued
 * parts and status history. Computed in code; nothing here is estimated.
 */

type AssetRef = { id: string; floc: string; name: string };

export interface ClosedWorkLine {
  row: WoCostRow;
  cost: WoCost;
  /** Hours the asset was down on outages that started on this work order. */
  downtimeHours: number;
}

export interface SiteCostReport {
  /** Work closed in the period. */
  closed: ClosedWorkLine[];
  closedCost: WoCost;
  /** Hours and parts already on work that is still open. */
  openCost: WoCost;
  byType: { type: WoType; count: number; cost: WoCost }[];
  topCost: { asset: AssetRef; count: number; cost: WoCost }[];
  topDowntime: { asset: AssetRef; summary: DowntimeSummary }[];
  plannedHours: number;
  unplannedHours: number;
  outages: number;
  /** Logged hours over estimated hours, for closed work that has both. Null when none does. */
  hoursVsEstimate: { logged: number; estimated: number; ratio: number } | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function siteCostReport(rows: WoCostRow[], events: AssetStatusEventItem[], assets: AssetRef[], since: string, now: string): SiteCostReport {
  const eventsByAsset = new Map<string, AssetStatusEventItem[]>();
  for (const e of events) eventsByAsset.set(e.asset_id, [...(eventsByAsset.get(e.asset_id) ?? []), e]);

  const closedRows = rows.filter((r) => r.status === "closed" && r.closed_at !== null && r.closed_at >= since);
  const closed = closedRows.map((row) => ({
    row,
    cost: costOfRow(row),
    downtimeHours: row.asset ? woDowntimeHours(eventsByAsset.get(row.asset.id) ?? [], row.id, now) : 0,
  }));

  const types = new Map<WoType, { count: number; cost: WoCost }>();
  const perAsset = new Map<string, { asset: AssetRef; count: number; cost: WoCost }>();
  for (const { row, cost } of closed) {
    const t = types.get(row.wo_type) ?? { count: 0, cost: ZERO_COST };
    types.set(row.wo_type, { count: t.count + 1, cost: addCosts(t.cost, cost) });
    if (row.asset) {
      const a = perAsset.get(row.asset.id) ?? { asset: row.asset, count: 0, cost: ZERO_COST };
      perAsset.set(row.asset.id, { asset: row.asset, count: a.count + 1, cost: addCosts(a.cost, cost) });
    }
  }

  const perAssetDowntime = assets
    .map((asset) => ({ asset, summary: downtime(eventsByAsset.get(asset.id) ?? [], since, now) }))
    .filter((x) => x.summary.plannedHours + x.summary.unplannedHours > 0);

  const withBoth = closed.filter((c) => c.row.estimated_hours !== null && c.row.estimated_hours > 0 && c.cost.laborHours > 0);
  const logged = withBoth.reduce((s, c) => s + c.cost.laborHours, 0);
  const estimated = withBoth.reduce((s, c) => s + (c.row.estimated_hours ?? 0), 0);

  return {
    closed,
    closedCost: sumCosts(closedRows),
    openCost: sumCosts(rows.filter((r) => r.status === "open")),
    byType: [...types].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.cost.total - a.cost.total),
    topCost: [...perAsset.values()].filter((a) => a.cost.total > 0).sort((a, b) => b.cost.total - a.cost.total).slice(0, 5),
    topDowntime: perAssetDowntime.sort((a, b) => b.summary.unplannedHours - a.summary.unplannedHours || b.summary.plannedHours - a.summary.plannedHours).slice(0, 5),
    plannedHours: round1(perAssetDowntime.reduce((s, x) => s + x.summary.plannedHours, 0)),
    unplannedHours: round1(perAssetDowntime.reduce((s, x) => s + x.summary.unplannedHours, 0)),
    outages: perAssetDowntime.reduce((s, x) => s + x.summary.downEvents, 0),
    hoursVsEstimate: withBoth.length ? { logged: round1(logged), estimated: round1(estimated), ratio: logged / estimated } : null,
  };
}
