import { beforeEach, describe, expect, it } from "vitest";
import { dbNum, liveNum } from "./seed-numbers";
import { buildSiteContext, formatSiteContext } from "@/lib/anthropic/context/site-context";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { buildDataset, personId } from "@/lib/demo/dataset";
import { DC_SITE } from "@/lib/demo/seed-datacenter";
import { SITE } from "@/lib/demo/seed";
import {
  addDays,
  applicableTasks,
  checkSpares,
  coverage,
  dueState,
  effectiveInterval,
  pmWorkPlan,
  summarizeProgram,
} from "@/lib/pm/program";
import { ASSET_CLASS_LIBRARY } from "@/lib/taxonomy/library";
import { CLASS_PM, pmTaskCode } from "@/lib/taxonomy/pm-library";
import { canPm } from "@/lib/workflow";
import { PM_STRATEGIES, type AssetClassWithModes } from "@/types/domain";

const NOW = new Date("2026-10-16T12:00:00Z");
const TODAY = "2026-10-16";
const db = buildDataset(NOW);
const classes: AssetClassWithModes[] = db.assetClasses.map((c) => ({
  ...c,
  failure_modes: db.failureModes.filter((m) => m.class_id === c.id),
  pm_tasks: db.pmTasks.filter((t) => t.class_id === c.id),
  spares: db.classSpares.filter((s) => s.class_id === c.id),
}));
const byCode = (code: string) => classes.find((c) => c.code === code)!;

describe("starter PM library", () => {
  it("gives every class a PM program entry", () => {
    for (const cls of ASSET_CLASS_LIBRARY) expect(CLASS_PM[cls.code], cls.code).toBeTruthy();
    for (const code of Object.keys(CLASS_PM)) expect(ASSET_CLASS_LIBRARY.some((c) => c.code === code), code).toBe(true);
  });

  for (const cls of ASSET_CLASS_LIBRARY) {
    it(`${cls.code}: every task is traceable to the class's failure modes`, () => {
      const modes = new Set(cls.failureModes.map((m) => m.code));
      const def = CLASS_PM[cls.code];
      const numbers = def.tasks.map((t) => t.n);
      expect(new Set(numbers).size).toBe(numbers.length);
      for (const t of def.tasks) {
        expect(PM_STRATEGIES).toContain(t.strategy);
        expect(t.modes.length, t.title).toBeGreaterThan(0);
        for (const m of t.modes) expect(modes.has(m), `${pmTaskCode(cls.code, t.n)} → ${m}`).toBe(true);
        expect(t.criticalities.length).toBeGreaterThan(0);
        expect(t.intervalDays).toBeGreaterThan(0);
        if (t.intervalDaysCritA) {
          expect(t.criticalities).toContain("A");
          expect(t.intervalDaysCritA).toBeLessThan(t.intervalDays);
        }
        // A task for a criticality that is run to failure would never be scheduled.
        for (const c of t.criticalities) expect(def.runToFailure ?? [], `${pmTaskCode(cls.code, t.n)} crit ${c}`).not.toContain(c);
      }
      for (const s of def.spares ?? []) expect(db.parts.some((p) => p.part_number === s.pn), s.pn).toBe(true);
    });
  }

  it("covers at least one failure mode for crit A in every class that is maintained at A", () => {
    for (const cls of classes) {
      if (cls.run_to_failure.includes("A")) continue;
      const rows = coverage(cls);
      expect(rows.some((r) => r.byCriticality.A.state === "covered"), cls.code).toBe(true);
    }
  });

  it("only defines model-specific spares for models that exist in the demo fleet", () => {
    for (const s of db.classSpares.filter((x) => x.model)) {
      expect(db.assets.some((a) => a.class_id === s.class_id && a.model === s.model), s.model!).toBe(true);
    }
  });
});

describe("PM program logic", () => {
  it("gives run-to-failure criticalities no tasks and shortens crit A intervals", () => {
    const pump = byCode("PUMP-CENT");
    expect(applicableTasks(pump, "C")).toEqual([]);
    expect(applicableTasks(pump, "A").length).toBeGreaterThan(0);
    const route = pump.pm_tasks.find((t) => t.code === "PUMP-CENT-PM01")!;
    expect(effectiveInterval(route, "A")).toBe(30);
    expect(effectiveInterval(route, "B")).toBe(90);
  });

  it("classifies due dates against today and the 14-day lead window", () => {
    expect(dueState(addDays(TODAY, -1), TODAY)).toBe("overdue");
    expect(dueState(TODAY, TODAY)).toBe("due");
    expect(dueState(addDays(TODAY, 14), TODAY)).toBe("due");
    expect(dueState(addDays(TODAY, 15), TODAY)).toBe("upcoming");
    expect(dueState(addDays(TODAY, 31), TODAY)).toBe("current");
  });

  it("marks coverage per criticality, including run to failure", () => {
    const rows = coverage(byCode("VALVE-CHECK"));
    const ftc = rows.find((r) => r.code === "FTC")!;
    expect(ftc.byCriticality.A.state).toBe("covered");
    expect(ftc.byCriticality.B.state).toBe("run_to_failure");
    const noise = coverage(byCode("CABLE")).find((r) => r.code === "TRM")!;
    expect(noise.byCriticality.A.state).toBe("uncovered");
  });

  it("checks critical spares only where they protect a crit A asset of the right model", () => {
    const dcAssets = db.assets.filter((a) => a.site_id === DC_SITE.id);
    const dcInventory = db.inventory.filter((r) => r.site_id === DC_SITE.id).map((r) => ({ ...r, part: db.parts.find((p) => p.id === r.part_id)! }));
    const gen = checkSpares(byCode("GEN-DIESEL"), dcAssets, dcInventory);
    expect(gen).toHaveLength(1);
    expect(gen[0].state).toBe("short"); // 1 filter kit on hand, 2 required
    expect(gen[0].protects.map((a) => a.floc).sort()).toEqual(["CFD-GEN-G-01", "CFD-GEN-G-02"]);
    const brpAssets = db.assets.filter((a) => a.site_id === SITE.id);
    // Basalt Ridge's generator is a different model: the data center kit doesn't apply there.
    expect(checkSpares(byCode("GEN-DIESEL"), brpAssets, [])).toEqual([]);
    expect(checkSpares(byCode("CDU"), dcAssets, dcInventory).every((s) => s.state === "ok")).toBe(true);
  });

  it("builds a PM work plan with isolation when the asset comes out of service", () => {
    const task = byCode("PUMP-CENT").pm_tasks.find((t) => t.code === "PUMP-CENT-PM04")!;
    const plan = pmWorkPlan(task, "BRP-HSP-P-201A");
    expect(plan.tasks.map((t) => t.seq)).toEqual([10, 20, 30]);
    expect(plan.tasks[0].craft).toBe("operations");
    const noShutdown = pmWorkPlan(byCode("PUMP-CENT").pm_tasks.find((t) => t.code === "PUMP-CENT-PM01")!, "X");
    expect(noShutdown.tasks).toHaveLength(1);
  });
});

describe("demo maintenance index", () => {
  it("schedules every applicable task on every asset, and nothing on run-to-failure assets", () => {
    for (const asset of db.assets) {
      const cls = classes.find((c) => c.id === asset.class_id)!;
      const expected = applicableTasks(cls, asset.criticality);
      const scheduled = db.pmSchedules.filter((s) => s.asset_id === asset.id);
      expect(scheduled.length, asset.floc).toBe(expected.length);
      for (const s of scheduled) {
        const task = expected.find((t) => t.id === s.pm_task_id)!;
        expect(task, asset.floc).toBeTruthy();
        expect(s.interval_days).toBe(effectiveInterval(task, asset.criticality));
        expect(s.site_id).toBe(asset.site_id);
      }
    }
  });

  it("links PM work orders to schedules on their own asset", () => {
    const linked = db.workOrders.filter((w) => w.pm_schedule_id);
    expect(linked.length).toBe(8);
    for (const w of linked) {
      const s = db.pmSchedules.find((x) => x.id === w.pm_schedule_id)!;
      expect(s.asset_id, w.wo_number).toBe(w.asset_id);
      expect(w.wo_type).toBe("preventive");
    }
    // A closed PM sets last done and the next due date from its close date.
    const ups = db.workOrders.find((w) => w.wo_number === dbNum(db, 2002))!;
    const sched = db.pmSchedules.find((s) => s.id === ups.pm_schedule_id)!;
    expect(sched.last_done_on).toBe(ups.closed_at!.slice(0, 10));
    expect(sched.next_due_on).toBe(addDays(sched.last_done_on!, sched.interval_days));
  });

  it("keeps a realistic, small share of PMs overdue at each site", () => {
    for (const site of db.sites) {
      const s = summarizeProgram(db.pmSchedules.filter((x) => x.site_id === site.id), TODAY);
      expect(s.schedules, site.code).toBeGreaterThan(50);
      expect(s.overdue, site.code).toBeGreaterThan(0);
      expect(s.inCompliancePct, site.code).toBeGreaterThanOrEqual(90);
    }
  });

  it("never records a PM as done before its asset was installed", () => {
    for (const s of db.pmSchedules) {
      const asset = db.assets.find((a) => a.id === s.asset_id)!;
      if (asset.install_date && s.last_done_on) expect(s.last_done_on >= asset.install_date, asset.floc).toBe(true);
    }
  });

  it("records seeded deferrals with a supervisor and a later date", () => {
    expect(db.pmDeferrals).toHaveLength(2);
    for (const d of db.pmDeferrals) {
      expect(d.to_due_on > d.from_due_on).toBe(true);
      expect(db.profiles.find((p) => p.id === d.approved_by)!.role).toBe("supervisor");
    }
  });
});

describe("PM program in the demo store", () => {
  beforeEach(() => resetDemoStore());

  it("generates due PMs straight into Scheduling, once", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    const today = new Date().toISOString().slice(0, 10);
    const before = await repo.listPmSchedules();
    const due = before.filter((s) => ["overdue", "due"].includes(dueState(s.next_due_on, today)) && !s.open_wo).length;
    expect(due).toBeGreaterThan(0);
    const created = await repo.generateDuePms(today, personId("Owen"));
    expect(created).toBe(due);
    expect(await repo.generateDuePms(today, personId("Owen"))).toBe(0);
    const wos = (await repo.listWorkOrders()).filter((w) => w.pm_schedule_id && w.title.startsWith("PM "));
    expect(wos.length).toBe(created);
    for (const w of wos) {
      expect(w.stage).toBe("scheduling");
      // Routine PMs are P3; only an overdue PM on a crit A asset is P2.
      const s = before.find((x) => x.id === w.pm_schedule_id)!;
      expect(w.priority, w.wo_number).toBe(s.asset.criticality === "A" && dueState(s.next_due_on, today) === "overdue" ? 2 : 3);
      expect(w.site_id).toBe(DC_SITE.id);
      expect((await repo.getWorkOrder(w.id))!.tasks.length).toBeGreaterThan(0);
    }
  });

  it("restarts the interval when a PM work order closes", async () => {
    const repo = new DemoRepository(SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1025))!; // compressor 4000-hour service
    await repo.closeWorkOrder(wo.id, 3, "Service done; separator differential back to normal.", personId("Lena"));
    const sched = (await repo.listPmSchedules()).find((s) => s.id === wo.pm_schedule_id)!;
    const today = new Date().toISOString().slice(0, 10);
    expect(sched.last_done_on).toBe(today);
    expect(sched.next_due_on).toBe(addDays(today, sched.interval_days));
    expect(sched.open_wo).toBeNull();
  });

  it("defers with a reason, refuses an earlier date, and notes it on the open work order", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    const withWo = (await repo.listPmSchedules()).find((s) => s.open_wo)!;
    await expect(repo.deferPm(withWo.id, addDays(withWo.next_due_on, -1), "Trying to move it earlier", personId("Hana"))).rejects.toThrow();
    const to = addDays(withWo.next_due_on, 10);
    await repo.deferPm(withWo.id, to, "Waiting on a change window for the A side", personId("Hana"));
    const after = (await repo.listPmSchedules()).find((s) => s.id === withWo.id)!;
    expect(after.next_due_on).toBe(to);
    expect(after.deferrals[0]).toMatchObject({ approver_name: "Hana Brooks", to_due_on: to });
    const events = (await repo.getWorkOrder(withWo.open_wo!.id))!.events;
    expect(events.some((e) => e.event_type === "note" && e.note?.includes("PM deferred"))).toBe(true);
  });

  it("scopes schedules to the site", async () => {
    const dc = await new DemoRepository(DC_SITE.id).listPmSchedules();
    expect(dc.every((s) => s.site_id === DC_SITE.id)).toBe(true);
    const brpSchedule = (await new DemoRepository(SITE.id).listPmSchedules())[0];
    await expect(new DemoRepository(DC_SITE.id).deferPm(brpSchedule.id, addDays(brpSchedule.next_due_on, 5), "Cross-site deferral attempt", "x")).rejects.toThrow();
  });

  it("gives Planning Mode the asset's PM schedule to bundle work", async () => {
    const repo = new DemoRepository(SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1031))!;
    const text = formatSiteContext((await buildSiteContext(repo, wo.id))!);
    expect(text).toContain("## PM schedule on this asset");
    expect(text).toContain("PUMP-CENT-PM04");
  });
});

describe("PM role rules", () => {
  it("lets planners and admins generate, and only supervisors defer", () => {
    expect(canPm("generate", "planner")).toBe(true);
    expect(canPm("generate", "admin")).toBe(true);
    expect(canPm("generate", "technician")).toBe(false);
    expect(canPm("defer", "supervisor")).toBe(true);
    expect(canPm("defer", "planner")).toBe(false);
    expect(canPm("defer", "admin")).toBe(false);
  });
});
