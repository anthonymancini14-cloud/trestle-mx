import { beforeEach, describe, expect, it } from "vitest";
import { addCosts, costShareOfReplacement, formatMoney, formatRate, hoursByCraft, lifeStanding, rateInEffect, sumCosts, underWarranty, woCost, ZERO_COST } from "@/lib/cost";
import { siteCostReport } from "@/lib/cost-report";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { buildDataset, personId } from "@/lib/demo/dataset";
import { SITE } from "@/lib/demo/seed";
import { DC_SITE } from "@/lib/demo/seed-datacenter";
import { currentStatus, downtime, formatDuration, statusIntervals, woDowntimeHours } from "@/lib/downtime";
import { canCost, canLogLabor, canSetAssetStatus } from "@/lib/workflow";
import { ROLES, type AssetStatusEvent, type LaborRate, type WoCostRow, type WoType } from "@/types/domain";

const rate = (craft: LaborRate["craft"], hourly_rate: number, effective_from: string, created_at = `${effective_from}T08:00:00Z`): LaborRate => ({
  id: `${craft}-${effective_from}-${hourly_rate}`,
  site_id: "s",
  craft,
  hourly_rate,
  effective_from,
  created_by: null,
  created_at,
});

describe("labor rates", () => {
  const rates = [rate("mechanical", 60, "2026-01-01"), rate("mechanical", 66, "2026-08-01"), rate("electrical", 70, "2026-01-01")];

  it("uses the latest rate that started on or before the work date", () => {
    expect(rateInEffect(rates, "mechanical", "2026-07-31")?.hourly_rate).toBe(60);
    expect(rateInEffect(rates, "mechanical", "2026-08-01")?.hourly_rate).toBe(66);
    expect(rateInEffect(rates, "electrical", "2026-12-01")?.hourly_rate).toBe(70);
  });

  it("has no rate before the first one, or for a craft nobody set", () => {
    expect(rateInEffect(rates, "mechanical", "2025-12-31")).toBeNull();
    expect(rateInEffect(rates, "contractor", "2026-06-01")).toBeNull();
  });

  it("takes the one entered last when two start the same day", () => {
    const fixed = [...rates, rate("mechanical", 67, "2026-08-01", "2026-08-01T15:00:00Z")];
    expect(rateInEffect(fixed, "mechanical", "2026-09-01")?.hourly_rate).toBe(67);
  });
});

describe("work order cost", () => {
  it("adds labor at each entry's rate and parts at the price when issued", () => {
    const cost = woCost(
      [
        { hours: 7, hourly_rate: 62 },
        { hours: 1.5, hourly_rate: 54 },
        { hours: -0.5, hourly_rate: 62 },
      ],
      [
        { qty_used: 2, unit_cost: 412.5, status: "issued" },
        { qty_used: 0, unit_cost: null, status: "kitted" },
      ],
    );
    expect(cost).toEqual({ laborHours: 8, laborCost: 484, partsCost: 825, total: 1309, unratedHours: 0, unpricedParts: 0 });
  });

  it("reports what it can't cost instead of guessing", () => {
    const cost = woCost([{ hours: 4, hourly_rate: null }, { hours: 2, hourly_rate: 60 }], [{ qty_used: 1, unit_cost: null, status: "issued" }]);
    expect(cost).toMatchObject({ laborHours: 6, laborCost: 120, unratedHours: 4, partsCost: 0, unpricedParts: 1, total: 120 });
  });

  it("counts only parts that were issued and used", () => {
    expect(woCost([], [{ qty_used: 3, unit_cost: 10, status: "reserved" }, { qty_used: 0, unit_cost: 10, status: "issued" }])).toEqual(ZERO_COST);
  });

  it("rounds to cents and adds up", () => {
    const a = woCost([{ hours: 0.25, hourly_rate: 71.33 }], []);
    expect(a.laborCost).toBe(17.83);
    expect(addCosts(a, a)).toMatchObject({ laborHours: 0.5, laborCost: 35.66, total: 35.66 });
    expect(hoursByCraft([{ craft: "mechanical", hours: 3 }, { craft: "operations", hours: 1 }, { craft: "mechanical", hours: 2.5 }])).toEqual([
      { craft: "mechanical", hours: 5.5 },
      { craft: "operations", hours: 1 },
    ]);
  });

  it("formats dollars for totals and cents for rates", () => {
    expect(formatMoney(2604.4)).toBe("$2,604");
    expect(formatMoney(null)).toBe("—");
    expect(formatRate(62)).toBe("$62.00");
  });
});

describe("asset value and life", () => {
  it("scales cost to a year against the replacement value", () => {
    expect(costShareOfReplacement(2500, 50_000, 365)).toBeCloseTo(0.05);
    expect(costShareOfReplacement(2500, 50_000, 90)).toBeCloseTo(0.2028, 3);
    expect(costShareOfReplacement(2500, null, 365)).toBeNull();
  });

  it("counts whole years in service and what is left", () => {
    expect(lifeStanding("2013-06-01", 25, "2026-11-14")).toEqual({ ageYears: 13, remainingYears: 12 });
    expect(lifeStanding("2000-06-01", 20, "2026-11-14")).toEqual({ ageYears: 26, remainingYears: -6 });
    expect(lifeStanding("2024-03-01", null, "2026-11-14")).toEqual({ ageYears: 2, remainingYears: null });
    expect(lifeStanding(null, 20, "2026-11-14")).toBeNull();
  });

  it("is under warranty through its last day", () => {
    expect(underWarranty("2026-11-14", "2026-11-14")).toBe(true);
    expect(underWarranty("2026-11-13", "2026-11-14")).toBe(false);
    expect(underWarranty(null, "2026-11-14")).toBe(false);
  });
});

describe("downtime", () => {
  const ev = (status: AssetStatusEvent["status"], started_at: string, wo?: { id: string; wo_type: WoType }) => ({ status, started_at, wo_id: wo?.id ?? null, wo: wo ?? null });
  const events = [
    ev("running", "2026-01-01T00:00:00Z"),
    ev("down", "2026-03-01T06:00:00Z", { id: "w1", wo_type: "corrective" }),
    ev("running", "2026-03-01T20:00:00Z", { id: "w1", wo_type: "corrective" }),
    ev("down", "2026-06-10T08:00:00Z", { id: "w2", wo_type: "preventive" }),
    ev("standby", "2026-06-10T14:00:00Z", { id: "w2", wo_type: "preventive" }),
    ev("down", "2026-09-01T00:00:00Z"),
  ];

  it("turns the history into back-to-back intervals, whatever order it arrives in", () => {
    const intervals = statusIntervals([...events].reverse());
    expect(intervals.map((i) => i.status)).toEqual(["running", "down", "running", "down", "standby", "down"]);
    expect(intervals[1]).toMatchObject({ from: "2026-03-01T06:00:00Z", to: "2026-03-01T20:00:00Z", planned: false });
    expect(intervals[3].planned).toBe(true);
    expect(intervals.at(-1)?.to).toBeNull();
    expect(currentStatus(events)).toMatchObject({ status: "down", from: "2026-09-01T00:00:00Z" });
    expect(currentStatus([])).toBeNull();
  });

  it("splits planned from unplanned and counts standby as available", () => {
    const d = downtime(events, "2026-01-01T00:00:00Z", "2026-07-01T00:00:00Z");
    expect(d).toMatchObject({ plannedHours: 6, unplannedHours: 14, downEvents: 2, knownHours: 4344 });
    expect(d.availability).toBeCloseTo(1 - 20 / 4344);
  });

  it("clips an outage to the window and counts one that is still running", () => {
    const d = downtime(events, "2026-03-01T12:00:00Z", "2026-09-02T00:00:00Z");
    // 8 h of the March outage fall inside; it started before the window, so it isn't counted as an outage in it.
    expect(d).toMatchObject({ plannedHours: 6, unplannedHours: 8 + 24, downEvents: 2 });
  });

  it("leaves out time before the history starts and time after retirement", () => {
    expect(downtime(events, "2025-01-01T00:00:00Z", "2026-02-01T00:00:00Z").knownHours).toBe(31 * 24);
    expect(downtime([], "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")).toMatchObject({ knownHours: 0, availability: null });
    const retired = [ev("running", "2026-01-01T00:00:00Z"), ev("retired", "2026-01-11T00:00:00Z")];
    expect(downtime(retired, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")).toMatchObject({ knownHours: 240, availability: 1 });
  });

  it("gives a work order the outages that started on it", () => {
    expect(woDowntimeHours(events, "w1", "2026-12-01T00:00:00Z")).toBe(14);
    expect(woDowntimeHours(events, "w2", "2026-12-01T00:00:00Z")).toBe(6);
    expect(woDowntimeHours(events, "w3", "2026-12-01T00:00:00Z")).toBe(0);
    expect(formatDuration(6.5)).toBe("6.5 h");
    expect(formatDuration(55.2)).toBe("2.3 d");
  });
});

describe("who keeps the numbers", () => {
  it("lets an admin set rates, and a planner or admin record value and life", () => {
    expect(ROLES.filter((r) => canCost("set_rate", r))).toEqual(["admin"]);
    expect(ROLES.filter((r) => canCost("edit_lifecycle", r)).sort()).toEqual(["admin", "planner"]);
  });

  it("takes hours from the crew and supervisors while the job is being worked or waiting to close", () => {
    expect(ROLES.filter((r) => canLogLabor(r, { status: "open", stage: "execution" })).sort()).toEqual(["admin", "supervisor", "technician"]);
    expect(canLogLabor("technician", { status: "open", stage: "closure" })).toBe(true);
    expect(canLogLabor("technician", { status: "open", stage: "scheduling" })).toBe(false);
    expect(canLogLabor("supervisor", { status: "closed", stage: "closure" })).toBe(false);
  });

  it("lets anyone record equipment down or back, and only an admin retire it", () => {
    for (const r of ROLES) expect(canSetAssetStatus(r, "down") && canSetAssetStatus(r, "running")).toBe(true);
    expect(ROLES.filter((r) => canSetAssetStatus(r, "retired"))).toEqual(["admin"]);
  });
});

describe("demo cost and downtime history", () => {
  const now = new Date("2026-11-14T15:00:00Z");
  const db = buildDataset(now);

  it("gives every closed work order hours that add up to what was recorded, and a cost", () => {
    const closed = db.workOrders.filter((w) => w.status === "closed");
    expect(closed.length).toBeGreaterThan(5);
    for (const wo of closed) {
      const labor = db.woLabor.filter((l) => l.wo_id === wo.id);
      expect(labor.length, wo.wo_number).toBeGreaterThan(0);
      expect(labor.reduce((s, l) => s + l.hours, 0), wo.wo_number).toBe(wo.actual_hours);
      expect(woCost(labor, db.woParts.filter((p) => p.wo_id === wo.id)).laborCost, wo.wo_number).toBeGreaterThan(0);
    }
  });

  it("costs each entry at the craft's rate on the day it was worked", () => {
    for (const l of db.woLabor) {
      const wo = db.workOrders.find((w) => w.id === l.wo_id)!;
      const expected = rateInEffect(db.laborRates.filter((r) => r.site_id === wo.site_id), l.craft, l.work_date);
      expect(l.hourly_rate, `${wo.wo_number} ${l.craft}`).toBe(expected?.hourly_rate ?? null);
      expect(l.hourly_rate).not.toBeNull();
      expect(l.hours > 0 && l.hours <= 24).toBe(true);
      expect(l.work_date <= now.toISOString().slice(0, 10) && l.work_date >= wo.created_at.slice(0, 10), `${wo.wo_number} ${l.work_date}`).toBe(true);
    }
    // The raise shows: the same craft at the same site was costed at two rates.
    const mech = db.woLabor.filter((l) => l.craft === "mechanical" && db.workOrders.find((w) => w.id === l.wo_id)!.site_id === SITE.id);
    expect(new Set(mech.map((l) => l.hourly_rate)).size).toBe(2);
  });

  it("keeps people on their own site's work", () => {
    for (const l of db.woLabor.filter((x) => x.profile_id)) {
      const wo = db.workOrders.find((w) => w.id === l.wo_id)!;
      expect(db.siteAccess.some((a) => a.user_id === l.profile_id && a.site_id === wo.site_id), wo.wo_number).toBe(true);
    }
  });

  it("prices issued parts and nothing else", () => {
    for (const line of db.woParts) {
      const price = db.parts.find((p) => p.id === line.part_id)?.unit_cost ?? null;
      expect(line.unit_cost, line.description).toBe(line.status === "issued" ? price : null);
    }
  });

  it("gives every asset a status history that ends at its current status", () => {
    for (const asset of db.assets) {
      const events = db.assetStatusEvents.filter((e) => e.asset_id === asset.id);
      expect(events.length, asset.floc).toBeGreaterThan(0);
      expect(currentStatus(events)?.status, asset.floc).toBe(asset.status);
      for (const e of events) expect(e.started_at <= now.toISOString(), asset.floc).toBe(true);
      // An outage is on a work order for this asset.
      for (const e of events.filter((x) => x.wo_id)) expect(db.workOrders.find((w) => w.id === e.wo_id)?.asset_id).toBe(asset.id);
    }
    expect(db.assets.filter((a) => a.status === "down").map((a) => a.floc)).toEqual(["BRP-CTW-F-601"]);
  });

  it("has planned and unplanned outages, and corrective work that never took the asset down", () => {
    const withWo = db.assetStatusEvents.filter((e) => e.status === "down").map((e) => db.workOrders.find((w) => w.id === e.wo_id)!.wo_type);
    expect(withWo).toContain("preventive");
    expect(withWo).toContain("corrective");
    const neverDown = db.workOrders.filter((w) => w.status === "closed" && w.wo_type === "corrective" && !db.assetStatusEvents.some((e) => e.wo_id === w.id));
    expect(neverDown.length).toBeGreaterThan(0);
  });

  it("records a value and life where the class has one, and leaves cables without", () => {
    const classCode = (id: string | null) => db.assetClasses.find((c) => c.id === id)?.code;
    for (const a of db.assets) {
      const passive = ["CABLE", "CABLE-TRAY"].includes(classCode(a.class_id) ?? "");
      expect(a.replacement_value === null, a.floc).toBe(passive);
      if (!passive) expect(a.replacement_value! > 0 && a.expected_life_years! > 0, a.floc).toBe(true);
      if (a.warranty_until && a.install_date) expect(a.warranty_until > a.install_date, a.floc).toBe(true);
    }
    expect(db.assets.some((a) => underWarranty(a.warranty_until, "2026-11-14"))).toBe(true);
    expect(db.assets.some((a) => a.warranty_until && !underWarranty(a.warranty_until, "2026-11-14"))).toBe(true);
  });
});

describe("the site report", () => {
  const now = "2026-11-14T15:00:00Z";
  const since = "2026-08-16T15:00:00Z";
  const asset = { id: "a1", floc: "X-P-1", name: "Pump 1" };
  const row = (id: string, wo_type: WoType, closed_at: string | null, hours: number, est: number | null, a: typeof asset | null = asset): WoCostRow => ({
    id,
    wo_number: id,
    title: id,
    wo_type,
    status: closed_at ? "closed" : "open",
    created_at: "2026-08-01T00:00:00Z",
    closed_at,
    estimated_hours: est,
    asset: a,
    labor: [{ craft: "mechanical", hours, hourly_rate: 60 }],
    parts: [{ qty_used: 1, unit_cost: 100, status: "issued" }],
  });
  const rows = [row("w1", "corrective", "2026-10-01T00:00:00Z", 6, 4), row("w2", "preventive", "2026-10-05T00:00:00Z", 2, 2), row("w3", "corrective", "2026-07-01T00:00:00Z", 9, 9), row("w4", "corrective", null, 3, 5, null)];
  const event = (status: "running" | "down", started_at: string, wo_id: string | null, wo_type: WoType | null) => ({
    id: started_at,
    asset_id: "a1",
    status,
    started_at,
    wo_id,
    note: null,
    recorded_by: null,
    created_at: started_at,
    recorded_by_name: null,
    wo: wo_id && wo_type ? { id: wo_id, wo_number: wo_id, wo_type } : null,
  });
  const events = [event("running", "2026-01-01T00:00:00Z", null, null), event("down", "2026-09-30T12:00:00Z", "w1", "corrective"), event("running", "2026-10-01T00:00:00Z", "w1", "corrective")];
  const report = siteCostReport(rows, events, [asset, { id: "a2", floc: "X-P-2", name: "Pump 2" }], since, now);

  it("counts work closed in the period and keeps open work separate", () => {
    expect(report.closed.map((c) => c.row.id)).toEqual(["w1", "w2"]);
    expect(report.closedCost).toMatchObject({ laborHours: 8, laborCost: 480, partsCost: 200, total: 680 });
    expect(report.openCost.total).toBe(280);
    // All four, in or out of the period: 460 + 220 + 640 + 280.
    expect(sumCosts(rows).total).toBe(1600);
  });

  it("breaks it down by type and by asset", () => {
    expect(report.byType.map((t) => [t.type, t.count, t.cost.total])).toEqual([
      ["corrective", 1, 460],
      ["preventive", 1, 220],
    ]);
    expect(report.topCost).toEqual([{ asset, count: 2, cost: expect.objectContaining({ total: 680 }) }]);
  });

  it("puts downtime on the work order it started on and on the asset", () => {
    expect(report.closed.find((c) => c.row.id === "w1")?.downtimeHours).toBe(12);
    expect(report.closed.find((c) => c.row.id === "w2")?.downtimeHours).toBe(0);
    expect(report).toMatchObject({ unplannedHours: 12, plannedHours: 0, outages: 1 });
    expect(report.topDowntime.map((d) => d.asset.id)).toEqual(["a1"]);
  });

  it("compares logged hours with the estimate", () => {
    expect(report.hoursVsEstimate).toEqual({ logged: 8, estimated: 6, ratio: 8 / 6 });
    expect(siteCostReport([], [], [], since, now).hoursVsEstimate).toBeNull();
  });
});

describe("cost and downtime in the demo repository", () => {
  beforeEach(() => resetDemoStore());
  const plant = () => new DemoRepository(SITE.id);
  const dc = () => new DemoRepository(DC_SITE.id);
  const jordan = personId("Jordan");
  const lena = personId("Lena");
  const today = () => new Date().toISOString().slice(0, 10);
  const find = async (repo: DemoRepository, title: string) => (await repo.listWorkOrders()).find((w) => w.title.includes(title))!;

  it("logs hours at the rate in effect and keeps the work order's hours equal to what is logged", async () => {
    const repo = plant();
    const wo = await find(repo, "packing adjustment");
    const before = (await repo.getWorkOrder(wo.id))!;
    await repo.addLabor(wo.id, { profile_id: jordan, craft: "mechanical", hours: 1.5, work_date: before.created_at.slice(0, 10), note: null }, jordan);
    const after = (await repo.getWorkOrder(wo.id))!;
    expect(after.labor).toHaveLength(before.labor.length + 1);
    expect(after.actual_hours).toBe((before.actual_hours ?? 0) + 1.5);
    const entry = after.labor.find((l) => l.hours === 1.5)!;
    expect(entry).toMatchObject({ hourly_rate: 65, person_name: "Jordan Kim", entered_by: jordan });

    // A new rate applies from its date on; what was logged keeps its rate.
    await repo.setLaborRate({ craft: "mechanical", hourly_rate: 91, effective_from: today() }, personId("Chris"));
    expect((await repo.getWorkOrder(wo.id))!.labor.find((l) => l.hours === 1.5)?.hourly_rate).toBe(65);
    expect((await repo.listLaborRates())[0]).toMatchObject({ craft: "mechanical", hourly_rate: 91 });
    expect((await dc().listLaborRates()).some((r) => r.hourly_rate === 91)).toBe(false);
  });

  it("refuses hours that don't fit the rules", async () => {
    const repo = plant();
    const wo = await find(repo, "packing adjustment");
    const base = { profile_id: jordan, craft: "mechanical" as const, work_date: today(), note: null };
    await expect(repo.addLabor(wo.id, { ...base, hours: 0 }, jordan)).rejects.toThrow(/between 0 and 24/);
    await expect(repo.addLabor(wo.id, { ...base, hours: 30 }, jordan)).rejects.toThrow(/between 0 and 24/);
    await expect(repo.addLabor(wo.id, { ...base, hours: -0.25 }, jordan)).rejects.toThrow(/needs a note/);
    await expect(repo.addLabor(wo.id, { ...base, hours: -50 / 4, note: "too much" }, jordan)).rejects.toThrow(/below zero/);
    await expect(repo.addLabor(wo.id, { ...base, hours: 1, work_date: "2030-01-01" }, jordan)).rejects.toThrow(/work date/);
    await expect(repo.addLabor(wo.id, { ...base, hours: 1, profile_id: personId("Mateo") }, lena)).rejects.toThrow(/roster/);
    const planning = await find(repo, "Hypochlorite metering pump");
    await expect(repo.addLabor(planning.id, { ...base, hours: 1 }, jordan)).rejects.toThrow(/Execution or Closure/);
    await expect(dc().addLabor(wo.id, { ...base, hours: 1 }, jordan)).rejects.toThrow(/not found/);
  });

  it("closes on the hours logged, or records the supervisor's figure when nobody logged any", async () => {
    const site = dc();
    const hana = personId("Hana");
    // Preventive work, so the evidence-to-close rule for corrective work doesn't come into it.
    const logged = (await site.getWorkOrder((await find(site, "CH-02 condenser")).id))!;
    expect(logged.labor.length).toBeGreaterThan(0);
    await site.closeWorkOrder(logged.id, 99, "Tubes brushed and flushed. Approach temperature back in range.", hana);
    const closed = (await site.getWorkOrder(logged.id))!;
    expect(closed.status).toBe("closed");
    expect(closed.actual_hours).toBe(logged.actual_hours);
    expect(closed.labor).toHaveLength(logged.labor.length);

    const all = await site.listWorkOrders();
    const details = await Promise.all(all.filter((w) => w.wo_type === "preventive" && w.status === "open").map((w) => site.getWorkOrder(w.id)));
    const unlogged = details.find((w) => w && w.labor.length === 0)!;
    await expect(site.closeWorkOrder(unlogged.id, null, "Monthly checks complete, nothing found.", hana)).rejects.toThrow(/No hours are logged/);
    await site.closeWorkOrder(unlogged.id, 2.5, "Monthly checks complete, nothing found.", hana);
    const done = (await site.getWorkOrder(unlogged.id))!;
    expect(done.actual_hours).toBe(2.5);
    expect(done.labor).toHaveLength(1);
    expect(done.labor[0]).toMatchObject({ hours: 2.5, profile_id: unlogged.assigned_to, note: "Entered at close-out" });
    expect(done.labor[0].hourly_rate).not.toBeNull();
  });

  it("fixes the price on a part when it is issued", async () => {
    const repo = plant();
    const wo = (await repo.getWorkOrder((await find(repo, "packing adjustment")).id))!;
    const line = wo.parts.find((p) => p.status === "kitted")!;
    expect(line.unit_cost).toBeNull();
    await repo.issuePart(line.id, jordan);
    const issued = (await repo.getWorkOrder(wo.id))!.parts.find((p) => p.id === line.id)!;
    expect(issued.unit_cost).toBe(line.part!.unit_cost);
    const row = (await repo.listWorkCosts()).find((r) => r.id === wo.id)!;
    expect(woCost(row.labor, row.parts).partsCost).toBe(line.qty_required * line.part!.unit_cost);
  });

  it("records status changes, moves the asset with them and keeps them to the site", async () => {
    const repo = plant();
    const wo = await find(repo, "packing adjustment");
    const assetId = wo.asset!.id;
    await repo.setAssetStatus(assetId, { status: "down", wo_id: wo.id, note: "Packing blew out" }, personId("Grace"));
    expect((await repo.getAsset(assetId))?.status).toBe("down");
    const events = await repo.listAssetStatusEvents({ assetId });
    expect(events.at(-1)).toMatchObject({ status: "down", wo_id: wo.id, recorded_by_name: "Grace Lin", wo: { wo_number: wo.wo_number, wo_type: "corrective" } });
    await expect(repo.setAssetStatus(assetId, { status: "down", wo_id: null, note: null }, jordan)).rejects.toThrow(/already down/);
    const other = await find(repo, "Deaerator vent valve");
    await expect(repo.setAssetStatus(assetId, { status: "running", wo_id: other.id, note: null }, jordan)).rejects.toThrow(/not on this asset/);
    await expect(dc().setAssetStatus(assetId, { status: "running", wo_id: null, note: null }, personId("Mateo"))).rejects.toThrow(/not found/);
    expect((await dc().listAssetStatusEvents()).some((e) => e.asset_id === assetId)).toBe(false);
    await repo.setAssetStatus(assetId, { status: "running", wo_id: wo.id, note: null }, jordan);
    expect((await repo.getAsset(assetId))?.status).toBe("running");
  });

  it("lists costs for one asset or since a date, and updates value and life", async () => {
    const repo = plant();
    const pump = (await repo.listAssets()).find((a) => a.floc === "BRP-HSP-P-201A")!;
    const rows = await repo.listWorkCosts({ assetId: pump.id });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.asset?.id === pump.id)).toBe(true);
    const recent = await repo.listWorkCosts({ since: new Date(Date.now() - 30 * 86_400_000).toISOString() });
    expect(recent.every((r) => r.status === "open" || r.closed_at! >= new Date(Date.now() - 30 * 86_400_000).toISOString())).toBe(true);
    expect(recent.some((r) => r.status === "closed" && r.id === rows.find((x) => x.title.includes("inboard bearing"))?.id)).toBe(false);

    await repo.updateAssetLifecycle(pump.id, { replacement_value: 61_000, expected_life_years: 22, warranty_until: null }, personId("Marcus"));
    expect(await repo.getAsset(pump.id)).toMatchObject({ replacement_value: 61_000, expected_life_years: 22, warranty_until: null });
    await expect(dc().updateAssetLifecycle(pump.id, { replacement_value: 1, expected_life_years: 1, warranty_until: null }, personId("Owen"))).rejects.toThrow(/not found/);
  });
});
