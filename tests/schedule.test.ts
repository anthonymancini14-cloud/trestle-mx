import { beforeEach, describe, expect, it } from "vitest";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { buildDataset, personId } from "@/lib/demo/dataset";
import { DC_SITE } from "@/lib/demo/seed-datacenter";
import { SITE } from "@/lib/demo/seed";
import { addDays } from "@/lib/pm/program";
import { todayAt } from "@/lib/utils";
import { buildCalendar, latestEta, personAvailability, UNPLANNED, weekday, weekStart, workDays } from "@/lib/schedule/calendar";
import { availableActions, canReschedule, canScheduleAt, rolesFor } from "@/lib/workflow";
import type { CalendarWorkOrder, CrewMember, PmScheduleRow } from "@/types/domain";

const TODAY = "2026-11-04"; // a Wednesday

const member = (over: Partial<CrewMember> = {}): CrewMember => ({
  id: "t1",
  full_name: "Test Tech",
  role: "technician",
  craft: "mechanical",
  is_active: true,
  shift: { id: "s1", site_id: "site", profile_id: "t1", shift_hours: 10, work_days: [1, 2, 3, 4] },
  time_off: [],
  ...over,
});

const wo = (over: Partial<CalendarWorkOrder> = {}): CalendarWorkOrder => ({
  id: "w1",
  wo_number: "263080001-001",
  jcn: "263080001",
  wce_seq: 1,
  title: "Job",
  stage: "execution",
  priority: 3,
  wo_type: "corrective",
  requires_shutdown: false,
  scheduled_date: TODAY,
  assigned_to: "t1",
  estimated_hours: 4,
  pm_schedule_id: null,
  created_at: `${TODAY}T08:00:00Z`,
  asset: { id: "a1", floc: "X-1", name: "Pump", criticality: "B" },
  assignee: { id: "t1", full_name: "Test Tech", craft: "mechanical" },
  day_hours: { 1: { mechanical: 4 } },
  parts_short: 0,
  parts_ready_on: null,
  ...over,
});

describe("calendar dates", () => {
  it("finds the weekday and the Monday of the week", () => {
    expect(weekday("2026-11-04")).toBe(3);
    expect(weekStart("2026-11-04")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // Sunday belongs to the week before
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
  });
});

describe("capacity from the roster (TMX-016)", () => {
  it("counts shift hours on work days only", () => {
    expect(personAvailability(member(), "2026-11-04").hours).toBe(10);
    expect(personAvailability(member(), "2026-11-06").hours).toBe(0); // Friday off
    expect(personAvailability(member({ shift: null }), "2026-11-04").hours).toBe(0);
  });

  it("takes time off out, whole shift or part", () => {
    const off = (hours: number | null) =>
      member({
        time_off: [{ id: "o", site_id: "site", profile_id: "t1", starts_on: "2026-11-03", ends_on: "2026-11-04", hours_per_day: hours, reason: "Training", created_by: null, created_at: "" }],
      });
    expect(personAvailability(off(null), "2026-11-04")).toEqual({ hours: 0, away: "Training" });
    expect(personAvailability(off(4), "2026-11-04")).toEqual({ hours: 6, away: "Training (4 h)" });
    expect(personAvailability(off(4), "2026-11-05").hours).toBe(10);
  });
});

describe("work hours and parts", () => {
  it("uses the plan's hours by day, else the estimate on day 1", () => {
    expect(workDays(wo())).toEqual([{ mechanical: 4 }]);
    expect(workDays(wo({ day_hours: { 1: { contractor: 8 }, 3: { contractor: 6 } } }))).toEqual([{ contractor: 8 }, {}, { contractor: 6 }]);
    expect(workDays(wo({ day_hours: {}, assignee: null }))).toEqual([{ [UNPLANNED]: 4 }]);
    expect(workDays(wo({ day_hours: {}, estimated_hours: null }))).toEqual([{}]);
  });

  it("knows when parts are on site only if every short part has a date", () => {
    expect(latestEta([])).toBeNull();
    expect(latestEta([{ expected_on: "2026-11-06" }, { expected_on: "2026-11-09" }])).toBe("2026-11-09");
    expect(latestEta([{ expected_on: "2026-11-06" }, { expected_on: null }])).toBeNull();
  });
});

describe("buildCalendar", () => {
  const pm = (over: Partial<PmScheduleRow> = {}): PmScheduleRow =>
    ({
      id: "pm1",
      site_id: "site",
      asset_id: "a2",
      pm_task_id: "task",
      interval_days: 30,
      last_done_on: null,
      next_due_on: "2026-11-06",
      is_active: true,
      asset: { id: "a2", floc: "X-2", name: "Fan", criticality: "A" },
      task: { code: "FAN-PM01", title: "Fan PM", craft: "electrical", crew_size: 2, est_hours: 1.5 },
      open_wo: null,
      deferrals: [],
      ...over,
    }) as PmScheduleRow;

  const build = (work: CalendarWorkOrder[], schedules: PmScheduleRow[] = [], crew = [member()], days = 7) =>
    buildCalendar({ from: "2026-11-02", days, today: TODAY, work, pmSchedules: schedules, crew });
  const ready = (over: Partial<CalendarWorkOrder> = {}) => wo({ id: "r1", stage: "scheduling", scheduled_date: null, assigned_to: null, assignee: null, ...over });

  it("books scheduled work against the craft's capacity and the assignee", () => {
    const cal = build([wo()]);
    const day = cal.days.find((d) => d.date === TODAY)!;
    expect(day.isToday).toBe(true);
    expect(day.items.map((i) => i.kind)).toEqual(["scheduled"]);
    expect(day.load.mechanical).toEqual({ available: 10, booked: 4, forecast: 0 });
    expect(day.people[0]).toMatchObject({ available: 10, booked: 4 });
  });

  it("lays a multi-day WCE over its days with each day's hours", () => {
    const scaffold = wo({ day_hours: { 1: { mechanical: 8 }, 3: { mechanical: 6 } } });
    const cal = build([scaffold]);
    const on = (d: string) => cal.days.find((x) => x.date === d)!.items;
    expect(on(TODAY)[0]).toMatchObject({ span: { day: 1, of: 3 }, totalHours: 8 });
    expect(on("2026-11-05")[0]).toMatchObject({ span: { day: 2, of: 3 }, totalHours: 0 });
    expect(on("2026-11-06")[0]).toMatchObject({ span: { day: 3, of: 3 }, totalHours: 6 });
  });

  it("gives corrective work no due date: it goes on the first day parts are on site and the crew is free (TMX-019)", () => {
    // Today has 10 h of mechanical and 4 h are booked: a 4 h job fits today.
    expect(build([wo(), ready()]).backlog[0]).toMatchObject({ basis: "earliest", start: TODAY, due: null });
    // An 8 h job doesn't fit beside the booked 4 h, so it goes to Thursday.
    expect(build([wo(), ready({ day_hours: { 1: { mechanical: 8 } } })]).backlog[0].start).toBe("2026-11-05");
    // Parts arrive Thursday, a work day: it goes on Thursday.
    expect(build([ready({ parts_short: 1, parts_ready_on: "2026-11-05" })]).backlog[0]).toMatchObject({ start: "2026-11-05", partsReadyOn: "2026-11-05" });
    // Parts on Friday: the tech works Monday to Thursday, so the earliest day is the next Monday.
    expect(build([ready({ parts_short: 1, parts_ready_on: "2026-11-06" })], [], [member()], 14).backlog[0].start).toBe("2026-11-09");
  });

  it("lists corrective work waiting on parts with no date, but doesn't draw it", () => {
    const cal = build([ready({ parts_short: 2, parts_ready_on: null })]);
    expect(cal.backlog[0]).toMatchObject({ basis: "waiting_parts", partsShort: 2 });
    expect(cal.days.flatMap((d) => d.items)).toHaveLength(0);
  });

  it("puts higher priority corrective work first in line for crew hours", () => {
    const low = ready({ id: "low", priority: 4, day_hours: { 1: { mechanical: 10 } } });
    const high = ready({ id: "high", priority: 2, day_hours: { 1: { mechanical: 10 } }, created_at: "2026-11-04T09:00:00Z" });
    const cal = build([low, high]);
    expect(cal.backlog.find((i) => i.wo?.id === "high")!.start).toBe(TODAY);
    expect(cal.backlog.find((i) => i.wo?.id === "low")!.start).toBe("2026-11-05");
  });

  it("doesn't let crafts nobody on the roster has (operators, vendors) hold a job back", () => {
    const job = ready({ day_hours: { 1: { operations: 0.5, mechanical: 2 } } });
    const item = build([job]).backlog[0];
    expect(item.start).toBe(TODAY);
    expect(item.unrostered).toEqual(["operations"]);
  });

  it("keeps PM work on its due date and lists unplanned corrective work separately", () => {
    const pmWo = ready({ id: "p", pm_schedule_id: "pm1", wo_type: "preventive" });
    const fresh = wo({ id: "c", stage: "vetting", scheduled_date: null, day_hours: {}, estimated_hours: null });
    const cal = build([pmWo, fresh], [pm({ open_wo: { id: "p", wo_number: "x", stage: "scheduling" } })]);
    expect(cal.backlog[0]).toMatchObject({ basis: "pm_due", start: "2026-11-06" });
    expect(cal.awaitingPlanning.map((w) => w.id)).toEqual(["c"]);
  });

  it("draws late work on today so it can't drop off", () => {
    const late = wo({ scheduled_date: "2026-10-28" });
    const cal = build([late]);
    const item = cal.days.find((d) => d.isToday)!.items[0];
    expect(item).toMatchObject({ kind: "scheduled", late: true, date: TODAY });
    expect(cal.lateCount).toBe(1);
    // Still counted when the view is another week.
    expect(buildCalendar({ from: "2026-11-30", days: 7, today: TODAY, work: [late], pmSchedules: [], crew: [member()] }).lateCount).toBe(1);
  });

  it("forecasts PMs coming due that have no work order, from the task template", () => {
    const cal = build([], [pm(), pm({ id: "pm2", open_wo: { id: "w", wo_number: "WO", stage: "scheduling" } }), pm({ id: "pm3", next_due_on: "2026-12-30" })]);
    const fri = cal.days.find((d) => d.date === "2026-11-06")!;
    expect(fri.items.map((i) => i.key)).toEqual(["pm-pm1:1"]);
    expect(fri.load.electrical).toEqual({ available: 0, booked: 0, forecast: 3 });
    expect(cal.crafts).toEqual(["mechanical", "electrical"]);
  });

  it("is computed from the work orders, so a moved date moves the job (TMX-017)", () => {
    const moved = build([wo({ scheduled_date: "2026-11-05" })]);
    expect(moved.days.find((d) => d.date === TODAY)!.items).toHaveLength(0);
    expect(moved.days.find((d) => d.date === "2026-11-05")!.items).toHaveLength(1);
  });

  it("handles a roster of hundreds", () => {
    const crafts = ["mechanical", "electrical", "instrumentation", "process_controls", "contractor"] as const;
    const crew = Array.from({ length: 400 }, (_, i) =>
      member({ id: `t${i}`, full_name: `Tech ${i}`, craft: crafts[i % crafts.length], shift: { id: `s${i}`, site_id: "site", profile_id: `t${i}`, shift_hours: 10, work_days: [1, 2, 3, 4, 5] } }),
    );
    const work = Array.from({ length: 300 }, (_, i) =>
      i % 2
        ? wo({ id: `w${i}`, assigned_to: `t${i}`, assignee: { id: `t${i}`, full_name: `Tech ${i}`, craft: crafts[i % crafts.length] }, scheduled_date: addDays(TODAY, i % 10), day_hours: { 1: { [crafts[i % crafts.length]]: 6 } } })
        : ready({ id: `r${i}`, day_hours: { 1: { [crafts[i % crafts.length]]: 8 }, 2: { [crafts[i % crafts.length]]: 4 } } }),
    );
    const t0 = performance.now();
    const cal = build(work, [], crew, 14);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(cal.days[2].load.mechanical!.available).toBe(800);
    expect(cal.backlog).toHaveLength(150);
  });
});

describe("who schedules (TMX-015)", () => {
  it("uses the site's scheduler roles; admin always can", () => {
    expect(canScheduleAt("admin", { schedulerRoles: [] })).toBe(true);
    expect(canScheduleAt("supervisor", { schedulerRoles: ["supervisor"] })).toBe(true);
    expect(canScheduleAt("planner", { schedulerRoles: ["supervisor"] })).toBe(false);
    expect(canScheduleAt("planner", { schedulerRoles: ["planner"] })).toBe(true);
    expect(rolesFor("schedule", { schedulerRoles: ["planner"] })).toEqual(["admin", "planner"]);
  });

  it("applies the setting to the Schedule action on a work order", () => {
    const open = { stage: "scheduling" as const, status: "open" as const };
    expect(availableActions("planner", open)).toEqual([]);
    expect(availableActions("planner", open, { schedulerRoles: ["planner"] })).toEqual(["schedule"]);
    expect(availableActions("supervisor", open, { schedulerRoles: ["planner"] })).toEqual([]);
  });

  it("only moves scheduled work in Execution", () => {
    const opts = { schedulerRoles: ["supervisor" as const] };
    expect(canReschedule("supervisor", { stage: "execution", status: "open", scheduled_date: TODAY }, opts)).toBe(true);
    expect(canReschedule("supervisor", { stage: "scheduling", status: "open", scheduled_date: null }, opts)).toBe(false);
    expect(canReschedule("technician", { stage: "execution", status: "open", scheduled_date: TODAY }, opts)).toBe(false);
  });
});

describe("demo roster and calendar data", () => {
  const db = buildDataset(new Date("2026-11-04T12:00:00Z"));

  it("gives every demo technician a shift at their site", () => {
    const techs = db.profiles.filter((p) => p.role === "technician");
    for (const t of techs) {
      const shift = db.crewShifts.find((c) => c.profile_id === t.id);
      expect(shift, t.full_name).toBeDefined();
      expect(db.siteAccess.some((a) => a.user_id === t.id && a.site_id === shift!.site_id)).toBe(true);
    }
    expect(db.timeOff.every((t) => db.crewShifts.some((c) => c.profile_id === t.profile_id && c.site_id === t.site_id))).toBe(true);
  });

  it("never seeds a scheduled job on its technician's day off", () => {
    for (const w of db.workOrders.filter((x) => x.status === "open" && x.stage === "execution" && x.assigned_to)) {
      const shift = db.crewShifts.find((c) => c.profile_id === w.assigned_to)!;
      expect(shift.work_days, w.wo_number).toContain(weekday(w.scheduled_date!));
    }
  });

  it("uses the site's time zone for today", () => {
    const lateEvening = new Date("2026-11-02T01:30:00Z"); // still Nov 1 in Denver and Los Angeles
    expect(todayAt("America/Denver", lateEvening)).toBe("2026-11-01");
    expect(todayAt("UTC", lateEvening)).toBe("2026-11-02");
    expect(todayAt("Not/AZone", lateEvening)).toBe("2026-11-02");
  });

  it("defaults both sites to supervisors scheduling, without sharing the seed object", () => {
    expect(db.sites.map((s) => s.scheduler_roles)).toEqual([["supervisor"], ["supervisor"]]);
    db.sites[0].scheduler_roles.push("planner");
    expect(buildDataset().sites[0].scheduler_roles).toEqual(["supervisor"]);
  });
});

describe("DemoRepository scheduling", () => {
  beforeEach(() => resetDemoStore());

  it("lists the site crew with shifts and only that site's open work", async () => {
    const repo = new DemoRepository(SITE.id);
    const crew = await repo.listCrew();
    expect(crew.map((c) => c.full_name.split(" ")[0]).sort()).toEqual(["Alex", "Devon", "Jordan", "Luis", "Nate", "Riley"]);
    expect(crew.every((c) => c.shift)).toBe(true);
    const work = await repo.listCalendarWork();
    expect(work.length).toBeGreaterThan(0);
    expect(work.every((w) => /^\d{2}\d{3}1\d{3}-\d{3}$/.test(w.wo_number))).toBe(true); // Basalt Ridge's block is 1000
    const planned = work.find((w) => w.stage === "execution")!;
    expect(Object.keys(planned.day_hours).length).toBeGreaterThan(0);
  });

  it("moves a scheduled job and logs it; refuses work that isn't scheduled", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    const work = await repo.listCalendarWork();
    const scheduled = work.find((w) => w.stage === "execution" && w.scheduled_date)!;
    const to = addDays(scheduled.scheduled_date!, 2);
    await repo.rescheduleWorkOrder(scheduled.id, to, personId("Hana"), "Parts arrive Thursday");
    const after = await repo.getWorkOrder(scheduled.id);
    expect(after!.scheduled_date).toBe(to);
    expect(after!.events.find((e) => e.event_type === "rescheduled")!.note).toBe(`${scheduled.scheduled_date} → ${to}: Parts arrive Thursday`);

    const ready = work.find((w) => w.stage === "scheduling")!;
    await expect(repo.rescheduleWorkOrder(ready.id, to, personId("Hana"))).rejects.toThrow(/scheduled work/);
  });

  it("saves the scheduler roles, time off and shifts for the site", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    await repo.setSchedulerRoles(["planner", "admin"], personId("Chris"));
    expect((await repo.getSite()).site.scheduler_roles).toEqual(["planner"]);
    expect((await new DemoRepository(SITE.id).getSite()).site.scheduler_roles).toEqual(["supervisor"]);

    const kai = personId("Kai");
    await repo.updateShift(kai, 12, [3, 1, 2], personId("Hana"));
    await repo.addTimeOff({ profile_id: kai, starts_on: "2030-01-01", ends_on: "2030-01-02", hours_per_day: null, reason: "Vacation" }, personId("Hana"));
    const crewKai = (await repo.listCrew()).find((c) => c.id === kai)!;
    expect(crewKai.shift).toMatchObject({ shift_hours: 12, work_days: [1, 2, 3] });
    expect(crewKai.time_off.at(-1)).toMatchObject({ starts_on: "2030-01-01", reason: "Vacation" });
    // Someone from the other site can't be put on this roster.
    await expect(repo.addTimeOff({ profile_id: personId("Jordan"), starts_on: "2030-01-01", ends_on: "2030-01-01", hours_per_day: null, reason: "Vacation" }, "x")).rejects.toThrow();
  });
});
