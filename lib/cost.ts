import type { Craft, LaborRate, WoCostRow, WoLabor, WoPart } from "@/types/domain";

/**
 * Cost arithmetic. Every dollar figure the product shows comes from here (or
 * from SQL), never from a model.
 *
 * A work order's cost is its labor (hours × the craft's rate on the work
 * date, fixed when the hours were entered) plus its parts (quantity used ×
 * the catalog price when the line was issued). A line with no rate or no
 * price can't be costed; it is counted and reported, never guessed.
 */

/** The rate in effect for a craft on a date: the latest one that started on or before it. */
export function rateInEffect(rates: LaborRate[], craft: Craft, date: string): LaborRate | null {
  return (
    rates
      .filter((r) => r.craft === craft && r.effective_from <= date)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

export interface WoCost {
  laborHours: number;
  laborCost: number;
  partsCost: number;
  total: number;
  /** Hours entered when the site had no rate for the craft. Not in the labor cost. */
  unratedHours: number;
  /** Issued part lines with no price. Not in the parts cost. */
  unpricedParts: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function woCost(labor: Pick<WoLabor, "hours" | "hourly_rate">[], parts: Pick<WoPart, "qty_used" | "unit_cost" | "status">[]): WoCost {
  let laborHours = 0;
  let laborCost = 0;
  let unratedHours = 0;
  for (const l of labor) {
    laborHours += l.hours;
    if (l.hourly_rate === null) unratedHours += l.hours;
    else laborCost += l.hours * l.hourly_rate;
  }
  let partsCost = 0;
  let unpricedParts = 0;
  for (const p of parts) {
    if (p.status !== "issued" || p.qty_used <= 0) continue;
    if (p.unit_cost === null) unpricedParts += 1;
    else partsCost += p.qty_used * p.unit_cost;
  }
  return {
    laborHours: round2(laborHours),
    laborCost: round2(laborCost),
    partsCost: round2(partsCost),
    total: round2(laborCost + partsCost),
    unratedHours: round2(unratedHours),
    unpricedParts,
  };
}

export const ZERO_COST: WoCost = { laborHours: 0, laborCost: 0, partsCost: 0, total: 0, unratedHours: 0, unpricedParts: 0 };

export function addCosts(a: WoCost, b: WoCost): WoCost {
  return {
    laborHours: round2(a.laborHours + b.laborHours),
    laborCost: round2(a.laborCost + b.laborCost),
    partsCost: round2(a.partsCost + b.partsCost),
    total: round2(a.total + b.total),
    unratedHours: round2(a.unratedHours + b.unratedHours),
    unpricedParts: a.unpricedParts + b.unpricedParts,
  };
}

export const costOfRow = (row: WoCostRow): WoCost => woCost(row.labor, row.parts);
export const sumCosts = (rows: WoCostRow[]): WoCost => rows.map(costOfRow).reduce(addCosts, ZERO_COST);

/** Hours by craft on one work order, largest first. */
export function hoursByCraft(labor: Pick<WoLabor, "craft" | "hours">[]): { craft: Craft; hours: number }[] {
  const totals = new Map<Craft, number>();
  for (const l of labor) totals.set(l.craft, (totals.get(l.craft) ?? 0) + l.hours);
  return [...totals].map(([craft, hours]) => ({ craft, hours: round2(hours) })).sort((a, b) => b.hours - a.hours);
}

/** Maintenance cost over a period as a share of what the asset would cost to replace, scaled to a year. Null without a replacement value. */
export function costShareOfReplacement(cost: number, replacementValue: number | null, periodDays: number): number | null {
  if (!replacementValue || replacementValue <= 0 || periodDays <= 0) return null;
  return (cost * (365 / periodDays)) / replacementValue;
}

/** Whole years in service, and years left of the expected life (negative once past it). */
export function lifeStanding(installDate: string | null, expectedLifeYears: number | null, today: string): { ageYears: number; remainingYears: number | null } | null {
  if (!installDate) return null;
  const ageYears = Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${installDate.slice(0, 10)}T00:00:00Z`)) / (365.25 * 86_400_000)));
  return { ageYears, remainingYears: expectedLifeYears === null ? null : expectedLifeYears - ageYears };
}

export const underWarranty = (warrantyUntil: string | null, today: string): boolean => warrantyUntil !== null && warrantyUntil >= today;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const moneyCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole dollars for totals. */
export const formatMoney = (n: number | null): string => (n === null ? "—" : money.format(n));
/** Dollars and cents for rates and unit prices. */
export const formatRate = (n: number | null): string => (n === null ? "—" : moneyCents.format(n));
