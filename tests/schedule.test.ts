import { beforeEach, describe, expect, it } from "vitest";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { buildDataset, personId } from "@/lib/demo/dataset";
import { DC_SITE } from "@/lib/demo/seed-datacenter";
import { SITE } from "@/lib/demo/seed";
import { addDays } from "@/lib/pm/program";
import { todayAt } from "@/lib/utils";
import { buildCalendar, personAvailability, PRIORITY_TARGET_DAYS, targetDate, UNPLANNED, weekday, weekStart, workHours } from "@/lib/schedule/calendar";
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
  wo_number: "WO-26-1",
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
  craft_hours: { mechanical: 4 },
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

describe("work hours and target dates", () => {
  it("uses the plan's craft hours, else the estimate", () => {
    expect(workHours(wo())).toEqual({ mechanical: 4 });
    expect(workHours(wo({ craft_hours: {}, assignee: null }))).toEqual({ [UNPLANNED]: 4 });
    expect(workHours(wo({ craft_hours: {}, estimated_hours: null }))).toEqual({});
  });

  it("targets unscheduled work by PM due date, else by priority", () => {
    expect(targetDate(wo({ priority: 2 }), undefined)).toBe(addDays(TODAY, PRIORITY_TARGET_DAYS[2]));
    expect(targetDate(wo(), "2026-11-20")).toBe("2026-11-20");
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

  const build = (work: CalendarWorkOrder[], schedules: PmScheduleRow[] = [], crew = [member()]) =>
    buildCalendar({ from: "2026-11-02", days: 7, today: TODAY, work, pmSchedules: schedules, crew });

  it("books scheduled work against the craft's capacity and the assignee", () => {
    const cal = build([wo()]);
    const day = cal.days.find((d) => d.date === TODAY)!;
    expect(day.isToday).toBe(true);
    expect(day.items.map((i) => i.kind)).toEqual(["scheduled"]);
    expect(day.load.mechanical).toEqual({ available: 10, booked: 4, forecast: 0 });
    expect(day.people[0]).toMatchObject({ available: 10, booked: 4 });
  });

  it("puts ready work in the backlog and on its due date as forecast (TMX-018)", () => {
    const ready = wo({ id: "w2", stage: "scheduling", scheduled_date: null, assigned_to: null, assignee: null, priority: 4, created_at: "2026-10-10T00:00:00Z" });
    const cal = build([ready]);
    expect(cal.backlog.map((i) => i.key)).toEqual(["w2"]);
    const due = addDays("2026-10-10", PRIORITY_TARGET_DAYS[4]);
    expect(cal.backlog[0].due).toBe(due);
    // Due after this week, so nothing is drawn this week.
    expect(cal.days.flatMap((d) => d.items)).toHaveLength(0);
  });

  it("draws late work on today so it can't drop off", () => {
    const late = wo({ id: "w3", stage: "planning", scheduled_date: null, priority: 2, created_at: "2026-10-01T00:00:00Z" });
    const cal = build([late]);
    const item = cal.days.find((d) => d.isToday)!.items[0];
    expect(item).toMatchObject({ kind: "forecast", late: true, date: TODAY });
    expect(cal.lateCount).toBe(1);
    // Still counted when the view is another week.
    expect(buildCalendar({ from: "2026-11-30", days: 7, today: TODAY, work: [late], pmSchedules: [], crew: [member()] }).lateCount).toBe(1);
    expect(cal.days.find((d) => d.isToday)!.load.mechanical?.forecast).toBe(4);
  });

  it("forecasts PMs coming due that have no work order, from the task template", () => {
    const cal = build([], [pm(), pm({ id: "pm2", open_wo: { id: "w", wo_number: "WO", stage: "scheduling" } }), pm({ id: "pm3", next_due_on: "2026-12-30" })]);
    const fri = cal.days.find((d) => d.date === "2026-11-06")!;
    expect(fri.items.map((i) => i.key)).toEqual(["pm-pm1"]);
    expect(fri.load.electrical).toEqual({ available: 0, booked: 0, forecast: 3 });
    expect(cal.crafts).toEqual(["mechanical", "electrical"]);
  });

  it("is computed from the work orders, so a moved date moves the job (TMX-017)", () => {
    const moved = build([wo({ scheduled_date: "2026-11-05" })]);
    expect(moved.days.find((d) => d.date === TODAY)!.items).toHaveLength(0);
    expect(moved.days.find((d) => d.date === "2026-11-05")!.items).toHaveLength(1);
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
    expect(crew.map((c) => c.full_name.split(" ")[0]).sort()).toEqual(["Alex", "Devon", "Jordan", "Riley"]);
    expect(crew.every((c) => c.shift)).toBe(true);
    const work = await repo.listCalendarWork();
    expect(work.length).toBeGreaterThan(0);
    expect(work.every((w) => w.wo_number.startsWith("WO-26-10"))).toBe(true);
    const planned = work.find((w) => w.stage === "execution")!;
    expect(Object.keys(planned.craft_hours).length).toBeGreaterThan(0);
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
