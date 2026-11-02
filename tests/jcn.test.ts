import { beforeEach, describe, expect, it } from "vitest";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { buildDataset, personId, seedNumbers } from "@/lib/demo/dataset";
import { DC_SITE } from "@/lib/demo/seed-datacenter";
import { SITE } from "@/lib/demo/seed";
import { deferralNote, formatJcn, jcnPrefix, julianDay, nextJcn, nextWceSeq, parseJcn, wceNumber } from "@/lib/jcn";
import { addDays } from "@/lib/pm/program";
import { todayAt } from "@/lib/utils";
import { canAddWce, canDefer, primaryCloseBlocker } from "@/lib/workflow";
import { liveNum } from "./seed-numbers";

describe("JCN numbering (TMX-020)", () => {
  it("builds YY + Julian day + 4-digit job ID, like 263045000", () => {
    expect(julianDay("2026-01-01")).toBe(1);
    expect(julianDay("2026-10-31")).toBe(304);
    expect(julianDay("2028-12-31")).toBe(366); // leap year
    expect(jcnPrefix("2026-10-31")).toBe("26304");
    expect(formatJcn("2026-10-31", 5000)).toBe("263045000");
    expect(formatJcn("2026-01-05", 7)).toBe("260050007");
    expect(() => formatJcn("2026-01-05", 10000)).toThrow();
    expect(parseJcn("263045000")).toEqual({ year: 2026, julianDay: 304, jobId: 5000 });
    expect(parseJcn("WO-26-1")).toBeNull();
  });

  it("counts up from the site's block each day and starts over the next day", () => {
    expect(nextJcn([], "2026-10-31", 5000)).toBe("263045000");
    expect(nextJcn(["263045000", "263045001", "263031000"], "2026-10-31", 5000)).toBe("263045002");
    expect(nextJcn(["263045000", "263045001"], "2026-11-01", 5000)).toBe("263055000");
  });

  it("numbers WCEs within the JCN: 263045000-001, -002 …", () => {
    expect(wceNumber("263045000", 1)).toBe("263045000-001");
    expect(wceNumber("263045000", 50)).toBe("263045000-050");
    expect(nextWceSeq([1, 2, 3])).toBe(4);
    expect(nextWceSeq([])).toBe(1);
  });

  it("signs off a deferred WCE with the JCN that carries the work", () => {
    expect(deferralNote("263055003", "Part on order. ")).toBe("Corrective action deferred, see JCN 263055003. Part on order.");
  });
});

describe("demo JCNs", () => {
  const now = new Date("2026-11-04T18:00:00Z");
  const db = buildDataset(now);
  const nums = seedNumbers(db);
  const bySeed = (n: number) => db.workOrders.find((w) => w.wo_number === nums.get(n))!;

  it("dates every JCN from when its WCE -001 was written up, at the site's block", () => {
    for (const w of db.workOrders.filter((x) => x.wce_seq === 1)) {
      const site = db.sites.find((s) => s.id === w.site_id)!;
      expect(w.jcn.slice(0, 5), w.wo_number).toBe(jcnPrefix(todayAt(site.timezone, new Date(w.created_at))));
      expect(Number(w.jcn.slice(5)), w.wo_number).toBeGreaterThanOrEqual(site.jcn_block);
      expect(w.wo_number).toBe(wceNumber(w.jcn, 1));
    }
  });

  it("re-dates itself: a month later every number and date moves with it", () => {
    const later = buildDataset(new Date(now.getTime() + 30 * 86_400_000));
    const laterNums = seedNumbers(later);
    expect(laterNums.get(1031)).not.toBe(nums.get(1031));
    const a = bySeed(1031);
    const b = later.workOrders.find((w) => w.wo_number === laterNums.get(1031))!;
    expect(Date.parse(b.created_at) - Date.parse(a.created_at)).toBe(30 * 86_400_000);
  });

  it("seeds a job with three shops' WCEs and a multi-day scaffold", () => {
    const main = bySeed(1041);
    const job = db.workOrders.filter((w) => w.jcn === main.jcn).sort((x, y) => x.wce_seq - y.wce_seq);
    expect(job.map((w) => w.wce_seq)).toEqual([1, 2, 3]);
    expect(job[0].id).toBe(main.id);
    const scaffold = bySeed(1046);
    expect(scaffold.jcn).toBe(main.jcn);
    const days = db.tasks.filter((t) => t.wo_id === scaffold.id).map((t) => t.day);
    expect(days[0]).toBe(1);
    // Struck on a work day after the main job's last day.
    const mainLast = addDays(main.scheduled_date!, Math.max(...db.tasks.filter((t) => t.wo_id === main.id).map((t) => t.day)) - 1);
    const strike = addDays(scaffold.scheduled_date!, days[1] - 1);
    expect(strike > mainLast).toBe(true);
    expect(db.crewShifts.find((c) => c.profile_id === scaffold.assigned_to)!.work_days).toContain(new Date(`${strike}T00:00:00Z`).getUTCDay());
    expect(scaffold.scheduled_date! < main.scheduled_date!).toBe(true); // up before the seal job starts
    // …and never in the past, whatever day of the week the demo is built on.
    for (let d = 0; d < 7; d++) {
      const day = buildDataset(new Date(now.getTime() + d * 86_400_000));
      const n = seedNumbers(day);
      const s = day.workOrders.find((w) => w.wo_number === n.get(1046))!;
      expect(s.scheduled_date! >= todayAt("UTC", new Date(now.getTime() + d * 86_400_000)), `day ${d}`).toBe(true);
    }
  });

  it("seeds a WCE deferred to its own JCN", () => {
    const deferred = bySeed(2011);
    const carried = bySeed(2012);
    expect(deferred.status).toBe("closed");
    expect(deferred.deferred_to_jcn).toBe(carried.jcn);
    expect(deferred.debrief).toMatch(new RegExp(`^Corrective action deferred, see JCN ${carried.jcn}\\.`));
    expect(carried.deferred_from_wo_id).toBe(deferred.id);
    expect(carried.wce_seq).toBe(1);
    // The primary WCE on the original JCN closed after its other WCE.
    const primary = db.workOrders.find((w) => w.jcn === deferred.jcn && w.wce_seq === 1)!;
    expect(primary.closed_at! > deferred.closed_at!).toBe(true);
  });
});

describe("WCE rules", () => {
  it("only lets -001 close once every other WCE is closed", () => {
    const sibs = [
      { id: "a", wo_number: "263045000-001", status: "open" as const },
      { id: "b", wo_number: "263045000-002", status: "open" as const },
    ];
    expect(primaryCloseBlocker({ id: "a", wce_seq: 1 }, sibs)).toMatch(/263045000-002/);
    expect(primaryCloseBlocker({ id: "b", wce_seq: 2 }, sibs)).toBeNull();
    expect(primaryCloseBlocker({ id: "a", wce_seq: 1 }, [sibs[0], { ...sibs[1], status: "closed" }])).toBeNull();
  });

  it("lets supervisors defer open work in Scheduling, Execution or Closure; anyone who reports can add a WCE", () => {
    expect(canDefer("supervisor", { stage: "execution", status: "open" })).toBe(true);
    expect(canDefer("supervisor", { stage: "planning", status: "open" })).toBe(false);
    expect(canDefer("technician", { stage: "execution", status: "open" })).toBe(false);
    expect(canAddWce("technician", { status: "open" })).toBe(true);
    expect(canAddWce("storeroom", { status: "open" })).toBe(false);
    expect(canAddWce("planner", { status: "closed" })).toBe(false);
  });
});

describe("JCNs and WCEs in the demo store", () => {
  beforeEach(() => resetDemoStore());

  it("writes up a new discrepancy as WCE -001 of a new JCN dated today", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    const id = await repo.createWorkOrder(
      { title: "UPS A2 fan noise", description: "Bearing noise from module fan.", asset_id: null, wo_type: "corrective", priority: 3, requires_shutdown: false },
      personId("Kai"),
    );
    const wo = (await repo.getWorkOrder(id))!;
    expect(wo.jcn.slice(0, 5)).toBe(jcnPrefix(todayAt(DC_SITE.timezone)));
    expect(Number(wo.jcn.slice(5))).toBeGreaterThanOrEqual(5000);
    expect(wo.wo_number).toBe(`${wo.jcn}-001`);
  });

  it("adds another shop's WCE with the next number; -001 then can't close until it does", async () => {
    const repo = new DemoRepository(SITE.id);
    const main = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1031))!;
    const id = await repo.addWce(main.jcn, { title: "Scaffold", description: "Access for the bearing job.", asset_id: main.asset_id, wo_type: "corrective", priority: 3, requires_shutdown: false }, personId("Marcus"));
    const wce = (await repo.getWorkOrder(id))!;
    expect(wce.wo_number).toBe(`${main.jcn}-002`);
    expect(wce.stage).toBe("identification");
    await expect(repo.closeWorkOrder(main.id, 1, "Summary of the corrective action.", personId("Lena"))).rejects.toThrow(/closes last/);
  });

  it("defers a WCE to a new JCN, signs it off and gives its parts back", async () => {
    const repo = new DemoRepository(SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1022))!; // in Execution, kitted parts
    const before = await repo.getWorkOrder(wo.id);
    const newId = await repo.deferWorkOrder(wo.id, "Needs a vendor tech; doesn't affect operation.", personId("Lena"));
    const closed = (await repo.getWorkOrder(wo.id))!;
    const carried = (await repo.getWorkOrder(newId))!;
    expect(closed.status).toBe("closed");
    expect(closed.debrief).toBe(`Corrective action deferred, see JCN ${carried.jcn}. Needs a vendor tech; doesn't affect operation.`);
    expect(closed.deferred_to_jcn).toBe(carried.jcn);
    expect(carried).toMatchObject({ wce_seq: 1, stage: "vetting", deferred_from_wo_id: wo.id, asset_id: wo.asset_id });
    expect(carried.jcn).not.toBe(wo.jcn);
    if (before!.parts.some((p) => p.status === "kitted" || p.status === "reserved")) {
      expect(closed.parts.every((p) => p.status === "planned" || p.status === "issued")).toBe(true);
    }
    // A closed JCN takes no more WCEs.
    await expect(repo.addWce(wo.jcn, { title: "x", description: "more work here", asset_id: null, wo_type: "corrective", priority: 3, requires_shutdown: false }, personId("Lena"))).rejects.toThrow(/closed/);
  });

  it("sets an expected date on a part that isn't on site", async () => {
    const repo = new DemoRepository(SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1027))!;
    const part = (await repo.getWorkOrder(wo.id))!.parts.find((p) => p.status === "planned")!;
    await repo.setPartEta(part.id, "2030-01-15", personId("Teresa"));
    expect((await repo.getWorkOrder(wo.id))!.parts.find((p) => p.id === part.id)!.expected_on).toBe("2030-01-15");
    const cal = (await repo.listCalendarWork()).find((w) => w.id === wo.id)!;
    expect(cal.parts_ready_on).toBe("2030-01-15");
  });
});
