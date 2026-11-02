/**
 * Scheduling calendar logic. Pure functions: the calendar is computed from the
 * work orders, PM schedules and crew roster on every request, so it never holds
 * its own copy of a date (TMX-017). Move a work order anywhere in the app and
 * the calendar shows it on the next render.
 */
import { addDays, daysBetween } from "@/lib/pm/program";
import type { CalendarWorkOrder, Craft, CrewMember, PmScheduleRow, Priority, WoStage } from "@/types/domain";

/** Target days from report to completion by priority, for work with no PM due date (TMX-018). */
export const PRIORITY_TARGET_DAYS: Record<Priority, number> = { 1: 1, 2: 7, 3: 30, 4: 90 };

/** Hours that have no craft yet: a work order that hasn't been planned. */
export const UNPLANNED = "unplanned" as const;
export type LoadKey = Craft | typeof UNPLANNED;

export type ItemKind =
  /** Has a scheduled date (Execution). Drag moves the date. */
  | "scheduled"
  /** Planned and waiting for a date (Scheduling). Drag schedules it. */
  | "ready"
  /** Not yet planned (Identification to Planning). Shown on its target date; can't be scheduled yet. */
  | "forecast"
  /** A PM coming due that has no work order yet. */
  | "pm_due";

export interface CalendarItem {
  key: string;
  kind: ItemKind;
  /** The day the item is drawn on. */
  date: string;
  /** Due or target date (forecast and ready items). */
  due: string | null;
  /** The item's own date is before today and it is still open. */
  late: boolean;
  title: string;
  floc: string | null;
  criticality: "A" | "B" | "C" | null;
  hours: Partial<Record<LoadKey, number>>;
  totalHours: number;
  wo: { id: string; number: string; stage: WoStage; priority: Priority; requiresShutdown: boolean } | null;
  assignee: { id: string; name: string } | null;
  pmCode: string | null;
}

export interface DayLoad {
  available: number;
  booked: number;
  forecast: number;
}

export interface PersonDay {
  id: string;
  name: string;
  craft: Craft | null;
  available: number;
  booked: number;
  /** Why capacity is reduced, e.g. "Training (4 h)". */
  away: string | null;
}

export interface CalendarDay {
  date: string;
  isToday: boolean;
  items: CalendarItem[];
  load: Partial<Record<LoadKey, DayLoad>>;
  people: PersonDay[];
}

export interface Calendar {
  days: CalendarDay[];
  /** Planned work waiting for a date, soonest due first. */
  backlog: CalendarItem[];
  crafts: LoadKey[];
  /** Open items past their date, wherever the view is (they're drawn on today). */
  lateCount: number;
}

/** 0 = Sunday, from an ISO date. */
export function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  return addDays(iso, -((weekday(iso) + 6) % 7));
}

/** Hours a crew member can work on a day: shift hours on a work day, less time off. */
export function personAvailability(member: CrewMember, date: string): { hours: number; away: string | null } {
  const shift = member.shift;
  if (!shift || !shift.work_days.includes(weekday(date))) return { hours: 0, away: null };
  const off = member.time_off.find((t) => t.starts_on <= date && date <= t.ends_on);
  if (!off) return { hours: shift.shift_hours, away: null };
  const lost = Math.min(off.hours_per_day ?? shift.shift_hours, shift.shift_hours);
  return { hours: shift.shift_hours - lost, away: off.hours_per_day === null ? off.reason : `${off.reason} (${lost} h)` };
}

/** Crew-hours by craft. Unplanned work counts its estimate (if any) against the assignee's craft, else as unplanned. */
export function workHours(wo: CalendarWorkOrder): Partial<Record<LoadKey, number>> {
  if (Object.keys(wo.craft_hours).length > 0) return wo.craft_hours;
  if (!wo.estimated_hours) return {};
  return { [wo.assignee?.craft ?? UNPLANNED]: wo.estimated_hours };
}

function sumHours(h: Partial<Record<LoadKey, number>>): number {
  return Object.values(h).reduce((s, v) => s + (v ?? 0), 0);
}

/** When an unscheduled work order is due: its PM due date, or its report date plus the priority target. */
export function targetDate(wo: CalendarWorkOrder, pmDue: string | undefined): string {
  return pmDue ?? addDays(wo.created_at.slice(0, 10), PRIORITY_TARGET_DAYS[wo.priority]);
}

export function buildCalendar(input: {
  from: string;
  days: number;
  today: string;
  work: CalendarWorkOrder[];
  pmSchedules: PmScheduleRow[];
  crew: CrewMember[];
}): Calendar {
  const { from, today, work, pmSchedules, crew } = input;
  const to = addDays(from, input.days - 1);
  const pmById = new Map(pmSchedules.map((s) => [s.id, s]));
  /** Late work is drawn on today, so it can't fall off the calendar. */
  const drawOn = (date: string) => (date < today ? today : date);

  const items: CalendarItem[] = [];
  for (const wo of work) {
    const pm = wo.pm_schedule_id ? pmById.get(wo.pm_schedule_id) : undefined;
    const hours = workHours(wo);
    const base = {
      key: wo.id,
      title: wo.title,
      floc: wo.asset?.floc ?? null,
      criticality: wo.asset?.criticality ?? null,
      hours,
      totalHours: sumHours(hours),
      wo: { id: wo.id, number: wo.wo_number, stage: wo.stage, priority: wo.priority, requiresShutdown: wo.requires_shutdown },
      assignee: wo.assignee ? { id: wo.assignee.id, name: wo.assignee.full_name } : null,
      pmCode: pm?.task.code ?? null,
    };
    if (wo.scheduled_date && wo.stage === "execution") {
      items.push({ ...base, kind: "scheduled", date: drawOn(wo.scheduled_date), due: pm?.next_due_on ?? null, late: wo.scheduled_date < today });
    } else {
      const due = targetDate(wo, pm?.next_due_on);
      items.push({ ...base, kind: wo.stage === "scheduling" ? "ready" : "forecast", date: drawOn(due), due, late: due < today });
    }
  }
  // PMs coming due with no work order yet: forecast load from the PM task template.
  for (const s of pmSchedules) {
    if (s.open_wo || !s.is_active || s.next_due_on > to) continue;
    const h = s.task.est_hours * s.task.crew_size;
    items.push({
      key: `pm-${s.id}`,
      kind: "pm_due",
      date: drawOn(s.next_due_on),
      due: s.next_due_on,
      late: s.next_due_on < today,
      title: s.task.title,
      floc: s.asset.floc,
      criticality: s.asset.criticality,
      hours: { [s.task.craft]: h },
      totalHours: h,
      wo: null,
      assignee: null,
      pmCode: s.task.code,
    });
  }

  const crafts = new Set<LoadKey>();
  for (const m of crew) if (m.craft && m.shift) crafts.add(m.craft);

  const days: CalendarDay[] = [];
  for (let i = 0; i < input.days; i++) {
    const date = addDays(from, i);
    const dayItems = items
      .filter((it) => it.date === date)
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.wo?.priority ?? 5) - (b.wo?.priority ?? 5) || (a.due ?? "").localeCompare(b.due ?? ""));
    const load: Partial<Record<LoadKey, DayLoad>> = {};
    const bucket = (k: LoadKey) => (load[k] ??= { available: 0, booked: 0, forecast: 0 });
    const people: PersonDay[] = crew
      .filter((m) => m.shift)
      .map((m) => {
        const { hours, away } = personAvailability(m, date);
        if (m.craft) bucket(m.craft).available += hours;
        const booked = dayItems
          .filter((it) => it.kind === "scheduled" && it.assignee?.id === m.id)
          .reduce((s, it) => s + (m.craft && it.hours[m.craft] !== undefined ? it.hours[m.craft]! : it.totalHours), 0);
        return { id: m.id, name: m.full_name, craft: m.craft, available: hours, booked, away };
      });
    for (const it of dayItems) {
      for (const [k, h] of Object.entries(it.hours) as [LoadKey, number][]) {
        crafts.add(k);
        if (it.kind === "scheduled") bucket(k).booked += h;
        else bucket(k).forecast += h;
      }
    }
    days.push({ date, isToday: date === today, items: dayItems, load, people });
  }

  const backlog = items
    .filter((it) => it.kind === "ready")
    .sort((a, b) => (a.wo!.priority - b.wo!.priority) || (a.due ?? "").localeCompare(b.due ?? ""));

  return { days, backlog, lateCount: items.filter((it) => it.late).length, crafts: [...crafts].sort((a, b) => LOAD_ORDER.indexOf(a) - LOAD_ORDER.indexOf(b)) };
}

const KIND_ORDER: Record<ItemKind, number> = { scheduled: 0, ready: 1, forecast: 2, pm_due: 3 };
const LOAD_ORDER: LoadKey[] = ["mechanical", "electrical", "instrumentation", "operations", "contractor", UNPLANNED];

/** Days from today, for "due in" labels. */
export function daysFrom(today: string, date: string): number {
  return daysBetween(today, date);
}
