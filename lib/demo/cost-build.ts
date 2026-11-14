import { rateInEffect } from "@/lib/cost";
import type { Asset, AssetStatusEvent, Craft, LaborRate, Part, Profile, Site, WoLabor, WoPart, WorkOrder, WoTask } from "@/types/domain";
import { seedId } from "./ids";
import type { WoDef } from "./seed";

/**
 * Cost and downtime history for the demo: labor rates, hours on every job
 * that has been worked, the price of each issued part, each asset's status
 * history, and what each asset is worth. Every number here is invented.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Hourly rate by craft: [rate a year ago, rate since the raise 90 days ago, or null for no raise]. */
const RATES: Record<string, Record<Craft, [number, number | null]>> = {
  BRP: { mechanical: [62, 65], electrical: [68, 71], instrumentation: [70, null], process_controls: [76, null], operations: [54, null], contractor: [105, null] },
  CFD: { mechanical: [72, 75], electrical: [78, 82], instrumentation: [80, null], process_controls: [88, null], operations: [60, null], contractor: [125, null] },
};

/** Replacement value, expected life in years and warranty length in years, by asset class. Cables and trays are left without, as a real register would have gaps. */
const CLASS_LIFECYCLE: Record<string, [value: number, life: number, warrantyYears: number]> = {
  "PUMP-CENT": [48_000, 20, 2],
  "PUMP-PD": [22_000, 15, 2],
  "MOTOR-IND": [18_000, 20, 2],
  VFD: [26_000, 15, 2],
  "COMP-SCREW": [140_000, 20, 2],
  "BLOWER-PD": [60_000, 20, 2],
  "FAN-CT": [85_000, 25, 2],
  "BOILER-FT": [420_000, 30, 2],
  VESSEL: [160_000, 30, 2],
  TANK: [120_000, 40, 2],
  "SCREEN-TWS": [210_000, 30, 2],
  "VALVE-ACT": [14_000, 20, 2],
  "VALVE-CHECK": [6_000, 25, 2],
  ANALYZER: [16_000, 10, 2],
  "DRYER-DES": [55_000, 15, 2],
  MCC: [190_000, 30, 2],
  SWGR: [480_000, 30, 2],
  "XFMR-LIQ": [260_000, 35, 2],
  "GEN-DIESEL": [800_000, 25, 5],
  "UPS-STATIC": [650_000, 15, 5],
  "BATT-STRING": [90_000, 10, 3],
  PDU: [75_000, 20, 2],
  ATS: [110_000, 25, 2],
  CHILLER: [720_000, 23, 5],
  CRAH: [68_000, 15, 2],
  CDU: [180_000, 12, 3],
  "BMS-CTRL": [35_000, 12, 2],
  "FIRE-SUPP": [150_000, 20, 2],
  CABINET: [9_000, 15, 2],
};

const quarter = (n: number) => Math.round(n * 4) / 4;

interface Args {
  now: Date;
  sites: Site[];
  profiles: Profile[];
  siteAccess: { user_id: string; site_id: string }[];
  /** Copies owned by this dataset: status, value, life and warranty are set on them. */
  assets: Asset[];
  classCodeById: Map<string, string>;
  workOrders: WorkOrder[];
  tasks: WoTask[];
  woParts: WoPart[];
  parts: Part[];
  seedRows: { id: string; def: WoDef }[];
}

export function buildCostRows(args: Args): { laborRates: LaborRate[]; woLabor: WoLabor[]; assetStatusEvents: AssetStatusEvent[] } {
  const { now, sites, profiles, siteAccess, assets, workOrders, tasks, woParts, parts, seedRows } = args;
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY_MS).toISOString();
  const today = now.toISOString().slice(0, 10);

  // ---- labor rates
  const laborRates: LaborRate[] = [];
  for (const site of sites) {
    const admin = profiles.find((p) => p.role === "admin" && siteAccess.some((a) => a.user_id === p.id && a.site_id === site.id)) ?? null;
    for (const [craft, [first, raised]] of Object.entries(RATES[site.code] ?? {}) as [Craft, [number, number | null]][]) {
      const row = (hourly_rate: number, daysAgo: number): LaborRate => ({
        id: seedId("laborRate", laborRates.length + 1),
        site_id: site.id,
        craft,
        hourly_rate,
        effective_from: at(daysAgo).slice(0, 10),
        created_by: admin?.id ?? null,
        created_at: at(daysAgo),
      });
      laborRates.push(row(first, 400));
      if (raised !== null) laborRates.push(row(raised, 90));
    }
  }

  // ---- hours on every job that has been worked
  const woLabor: WoLabor[] = [];
  const crewAt = (siteId: string) => profiles.filter((p) => siteAccess.some((a) => a.user_id === p.id && a.site_id === siteId));
  const logHours = (wo: WorkOrder, profileId: string | null, craft: Craft, hours: number, workDate: string) => {
    if (hours <= 0) return;
    const rates = laborRates.filter((r) => r.site_id === wo.site_id);
    woLabor.push({
      id: seedId("woLabor", woLabor.length + 1),
      wo_id: wo.id,
      profile_id: profileId,
      craft,
      hours,
      work_date: workDate,
      note: null,
      hourly_rate: rateInEffect(rates, craft, workDate)?.hourly_rate ?? null,
      entered_by: profileId ?? wo.assigned_to,
      created_at: `${workDate}T22:00:00.000Z` < now.toISOString() ? `${workDate}T22:00:00.000Z` : now.toISOString(),
    });
  };
  /** The people who would do a craft's work on this job: the assignee first, then others of the craft, then crew not on the roster. */
  const peopleFor = (wo: WorkOrder, craft: Craft, count: number): (string | null)[] => {
    const crew = crewAt(wo.site_id);
    const ofCraft = craft === "operations" ? crew.filter((p) => p.role === "operator") : crew.filter((p) => p.role === "technician" && p.craft === craft);
    ofCraft.sort((a, b) => Number(b.id === wo.assigned_to) - Number(a.id === wo.assigned_to));
    return Array.from({ length: count }, (_, i) => ofCraft[i]?.id ?? null);
  };
  /** Split person-hours for a craft across the crew, in quarter hours that add back up exactly. */
  const split = (wo: WorkOrder, craft: Craft, hours: number, crewSize: number, workDate: string) => {
    const people = peopleFor(wo, craft, crewSize);
    const each = quarter(hours / people.length);
    people.forEach((person, i) => logHours(wo, person, craft, i === 0 ? quarter(hours - each * (people.length - 1)) : each, workDate));
  };

  for (const wo of workOrders) {
    const own = tasks.filter((t) => t.wo_id === wo.id);
    const def = seedRows.find((r) => r.id === wo.id)?.def;
    // Work in progress is dated its scheduled day, or today if that day hasn't come yet.
    const planned = (wo.closed_at ?? wo.scheduled_date ?? wo.updated_at).slice(0, 10);
    const workDate = planned > today ? today : planned;
    const total = def?.actualHours ?? null;

    if (total !== null) {
      // Finished work: the recorded hours, shared across the crafts in proportion to the plan.
      const byCraft = new Map<Craft, { weight: number; crew: number }>();
      for (const t of own) {
        const entry = byCraft.get(t.craft) ?? { weight: 0, crew: 1 };
        byCraft.set(t.craft, { weight: entry.weight + t.est_hours * t.crew_size, crew: Math.max(entry.crew, t.crew_size) });
      }
      const assignee = profiles.find((p) => p.id === wo.assigned_to);
      if (byCraft.size === 0) byCraft.set(assignee?.craft ?? "mechanical", { weight: 1, crew: 1 });
      const weightSum = [...byCraft.values()].reduce((s, c) => s + c.weight, 0);
      const crafts = [...byCraft].sort((a, b) => b[1].weight - a[1].weight);
      let left = total;
      crafts.forEach(([craft, c], i) => {
        // The largest craft takes whatever rounding leaves, so the entries add up to the recorded total.
        const hours = i === crafts.length - 1 ? left : quarter((total * c.weight) / weightSum);
        left = quarter(left - hours);
        split(wo, craft, hours, c.crew, workDate);
      });
    } else if (wo.stage === "execution" && wo.status === "open") {
      // Work in progress: hours for the steps already done.
      for (const t of own.filter((x) => x.is_complete)) split(wo, t.craft, t.est_hours * t.crew_size, t.crew_size, workDate);
    }
    const logged = woLabor.filter((l) => l.wo_id === wo.id);
    if (logged.length > 0) wo.actual_hours = logged.reduce((s, l) => s + l.hours, 0);
  }

  // ---- the price of each issued part, fixed at issue
  for (const line of woParts) {
    line.unit_cost = line.status === "issued" ? (parts.find((p) => p.id === line.part_id)?.unit_cost ?? null) : null;
  }

  // ---- what each asset is worth, how long it should last, and its warranty
  assets.forEach((asset, i) => {
    const lifecycle = CLASS_LIFECYCLE[args.classCodeById.get(asset.class_id ?? "") ?? ""];
    if (!lifecycle) return;
    const [value, life, warrantyYears] = lifecycle;
    // A little spread so every pump isn't worth exactly the same.
    asset.replacement_value = Math.round((value * (1 + (((i * 37) % 7) - 3) * 0.03)) / 500) * 500;
    asset.expected_life_years = life;
    if (asset.install_date) asset.warranty_until = `${Number(asset.install_date.slice(0, 4)) + warrantyYears}${asset.install_date.slice(4, 10)}`;
  });

  // ---- status history: a starting status for every asset, then the outages the work orders caused
  const assetStatusEvents: AssetStatusEvent[] = [];
  const push = (asset: Asset, status: Asset["status"], startedAt: string, woId: string | null, note: string | null, by: string | null) =>
    assetStatusEvents.push({ id: seedId("assetStatusEvent", assetStatusEvents.length + 1), asset_id: asset.id, status, started_at: startedAt, wo_id: woId, note, recorded_by: by, created_at: startedAt });

  for (const asset of assets) {
    const historyStart = at(365);
    const installed = asset.install_date ? `${asset.install_date.slice(0, 10)}T00:00:00.000Z` : historyStart;
    push(asset, asset.status, installed > historyStart ? installed : historyStart, null, "Status history starts here", null);
  }
  const outages = seedRows.flatMap(({ id, def }): { wo: WorkOrder; asset: Asset; from: string; to: string | null }[] => {
    const wo = workOrders.find((w) => w.id === id);
    const asset = wo && assets.find((a) => a.id === wo.asset_id);
    if (!def.down || !wo || !asset) return [];
    if ("sinceDaysAgo" in def.down) return [{ wo, asset, from: at(def.down.sinceDaysAgo), to: null }];
    const end = def.down.endedDaysAgo !== undefined ? at(def.down.endedDaysAgo) : wo.closed_at!;
    return [{ wo, asset, from: new Date(Date.parse(end) - def.down.hours * HOUR_MS).toISOString(), to: end }];
  });
  for (const { wo, asset, from, to } of outages.sort((a, b) => a.from.localeCompare(b.from))) {
    const before = asset.status;
    const planned = wo.wo_type === "preventive" || wo.wo_type === "project";
    push(asset, "down", from, wo.id, planned ? "Taken out of service for the work" : "Out of service", wo.reported_by);
    if (to) push(asset, before, to, wo.id, "Returned to service", wo.assigned_to);
    else asset.status = "down";
  }
  assetStatusEvents.sort((a, b) => a.started_at.localeCompare(b.started_at));
  return { laborRates, woLabor, assetStatusEvents };
}
