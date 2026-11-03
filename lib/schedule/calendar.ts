/**
 * Scheduling calendar logic. Pure functions: the calendar is computed from the
 * work orders, PM schedules and crew roster on every request, so it never holds
 * its own copy of a date (TMX-017). Move a work order anywhere in the app and
 * the calendar shows it on the next render.
 *
 * Where unscheduled work goes (TMX-019):
 * - PM and PdM work is recurring and has a due date: it sits on its due date.
 * - Corrective work has no due date. Once planned, it is placed on the earliest
 *   day all its parts are on site and every craft it needs has the hours free,
 *   after booked work and PMs. Until it is planned there is nothing to place.
 *
 * A WCE can run over several days: each plan step has a day (1 = the scheduled
 * date), and the calendar shows the WCE on each of its days with that day's hours.
 */
import { addDays, daysBetween } from "@/lib/pm/program";
import type { CalendarWorkOrder, Craft, CrewMember, PmScheduleRow, Priority, WoStage } from "@/types/domain";

/** How far ahead the calendar looks for a day with parts and crew for corrective work. */
export const SUGGEST_HORIZON_DAYS = 60;

/** Hours that have no craft yet: a work order with an estimate but no plan. */
export const UNPLANNED = "unplanned" as const;
export type LoadKey = Craft | typeof UNPLANNED;
type Hours = Partial<Record<LoadKey, number>>;

export type ItemKind =
  /** Has a scheduled date (Execution). Drag moves the date. */
  | "scheduled"
  /** Planned, waiting for a date (Scheduling). Drawn on its PM due date or its earliest workable day. Drag schedules it. */
  | "ready"
  /** PM or PdM work order not yet planned: drawn on its due date. */
  | "forecast"
  /** A PM coming due that has no work order yet. */
  | "pm_due";

/** Why a ready or forecast item sits on the day it does. */
export type Basis = "scheduled" | "pm_due" | "earliest" | "waiting_parts";

export interface CalendarItem {
  /** Unique per drawn segment (a multi-day WCE has one per day). */
  key: string;
  kind: ItemKind;
  basis: Basis;
  /** The day this segment is drawn on. */
  date: string;
  /** The WCE's first day (scheduled date, PM due date or earliest workable day). */
  start: string;
  /** PM due date, when there is one. */
  due: string | null;
  /** Corrective: the day all parts are on site (null when they already are or have no date). */
  partsReadyOn: string | null;
  partsShort: number;
  /** Day k of n for multi-day work; null for one-day work. */
  span: { day: number; of: number } | null;
  /** Its date is before today and it is still open. Late work is drawn on today. */
  late: boolean;
  title: string;
  floc: string | null;
  criticality: "A" | "B" | "C" | null;
  /** This segment's crew-hours by craft. */
  hours: Hours;
  totalHours: number;
  /** Crafts the work needs that have nobody on the roster (so they don't limit the date). */
  unrostered: LoadKey[];
  wo: { id: string; number: string; jcn: string; wceSeq: number; stage: WoStage; priority: Priority; requiresShutdown: boolean } | null;
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
  /** Planned WCEs waiting for a date (first segment each), highest priority first. */
  backlog: CalendarItem[];
  /** Corrective WCEs still in Identification, Vetting or Planning: no date until planned. */
  awaitingPlanning: { id: string; number: string; title: string; stage: WoStage; priority: Priority }[];
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

/** The latest expected date among parts not on site, or null if any of them has no date. */
export function latestEta(short: { expected_on: string | null }[]): string | null {
  if (short.length === 0 || short.some((p) => !p.expected_on)) return null;
  return short.map((p) => p.expected_on!).sort().at(-1)!;
}

/** Crew-hours by day of the WCE. Unplanned work counts its estimate on day 1 against the assignee's craft, else as unplanned. */
export function workDays(wo: CalendarWorkOrder): Hours[] {
  const keys = Object.keys(wo.day_hours).map(Number);
  if (keys.length > 0) {
    const last = Math.max(...keys);
    return Array.from({ length: last }, (_, i) => wo.day_hours[i + 1] ?? {});
  }
  if (!wo.estimated_hours) return [{}];
  return [{ [wo.assignee?.craft ?? UNPLANNED]: wo.estimated_hours }];
}

const mergeHours = (a: Hours, b: Hours): Hours => {
  const out: Hours = { ...a };
  for (const [k, v] of Object.entries(b) as [LoadKey, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
};
const sumHours = (h: Hours) => Object.values(h).reduce((s, v) => s + (v ?? 0), 0);
const isRecurring = (wo: CalendarWorkOrder) => wo.pm_schedule_id !== null;

/** Capacity per craft per date from the roster, computed once per date. */
class Capacity {
  private cache = new Map<string, Hours>();
  readonly rostered: Set<LoadKey>;
  constructor(private crew: CrewMember[]) {
    this.rostered = new Set(crew.filter((m) => m.craft && m.shift).map((m) => m.craft!));
  }
  on(date: string): Hours {
    let h = this.cache.get(date);
    if (!h) {
      h = {};
      for (const m of this.crew) {
        if (!m.craft || !m.shift) continue;
        h[m.craft] = (h[m.craft] ?? 0) + personAvailability(m, date).hours;
      }
      this.cache.set(date, h);
    }
    return h;
  }
}

/** Hours committed per craft per date (booked work, PMs and placed corrective work). */
class Ledger {
  private used = new Map<string, Hours>();
  add(date: string, hours: Hours) {
    const d = this.used.get(date) ?? {};
    for (const [k, v] of Object.entries(hours) as [LoadKey, number][]) d[k] = (d[k] ?? 0) + v;
    this.used.set(date, d);
  }
  get(date: string, k: LoadKey): number {
    return this.used.get(date)?.[k] ?? 0;
  }
}

/**
 * The earliest day on or after `from` where every day of the work fits in the
 * free hours of each rostered craft it needs. Crafts nobody on the roster has
 * (operators, outside vendors) don't limit the date.
 */
export function earliestFit(days: Hours[], from: string, cap: Capacity, ledger: Ledger, horizon = SUGGEST_HORIZON_DAYS): string | null {
  for (let i = 0; i <= horizon; i++) {
    const start = addDays(from, i);
    const fits = days.every((hours, k) => {
      const date = addDays(start, k);
      return (Object.entries(hours) as [LoadKey, number][]).every(
        ([c, h]) => !cap.rostered.has(c) || (cap.on(date)[c] ?? 0) - ledger.get(date, c) >= h - 1e-9,
      );
    });
    if (fits) return start;
  }
  return null;
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
  const cap = new Capacity(crew);
  const ledger = new Ledger();
  const segments: CalendarItem[] = [];

  const baseOf = (wo: CalendarWorkOrder) => ({
    title: wo.title,
    floc: wo.asset?.floc ?? null,
    criticality: wo.asset?.criticality ?? null,
    wo: { id: wo.id, number: wo.wo_number, jcn: wo.jcn, wceSeq: wo.wce_seq, stage: wo.stage, priority: wo.priority, requiresShutdown: wo.requires_shutdown },
    assignee: wo.assignee ? { id: wo.assignee.id, name: wo.assignee.full_name } : null,
    pmCode: wo.pm_schedule_id ? (pmById.get(wo.pm_schedule_id)?.task.code ?? null) : null,
    partsShort: wo.parts_short,
    partsReadyOn: wo.parts_short ? wo.parts_ready_on : null,
  });

  /**
   * Lay a WCE's days out from `start`. Days before today are late and fold onto
   * today, so unfinished work can't drop off the board.
   */
  const place = (key: string, kind: ItemKind, basis: Basis, start: string, days: Hours[], base: ReturnType<typeof baseOf> | Omit<ReturnType<typeof baseOf>, "wo">, due: string | null, reserve: boolean, draw = true) => {
    const n = days.length;
    const late: Hours = {};
    let anyLate = false;
    const out: CalendarItem[] = [];
    days.forEach((hours, k) => {
      const date = addDays(start, k);
      if (date < today) {
        anyLate = true;
        for (const [c, h] of Object.entries(hours) as [LoadKey, number][]) late[c] = (late[c] ?? 0) + h;
        return;
      }
      out.push(segment(date, k + 1, hours));
    });
    if (anyLate) out.unshift(segment(today, Math.min(daysBetween(start, today) + 1, n), late, true));
    function segment(date: string, day: number, hours: Hours, isLate = false): CalendarItem {
      return {
        key: `${key}:${day}${isLate ? "L" : ""}`,
        kind,
        basis,
        date,
        start,
        due,
        span: n > 1 ? { day, of: n } : null,
        late: isLate || (n === 1 && start < today),
        hours,
        totalHours: sumHours(hours),
        unrostered: (Object.keys(hours) as LoadKey[]).filter((c) => !cap.rostered.has(c)),
        wo: null,
        ...base,
      };
    }
    if (draw) segments.push(...out);
    if (reserve) for (const s of out) ledger.add(s.date, s.hours);
    return out;
  };

  const awaitingPlanning: Calendar["awaitingPlanning"] = [];
  const corrective: CalendarWorkOrder[] = [];

  // 1. Booked work, then recurring work on its due date: these come first.
  for (const wo of work) {
    const pm = wo.pm_schedule_id ? pmById.get(wo.pm_schedule_id) : undefined;
    if (wo.scheduled_date && wo.stage === "execution") {
      place(wo.id, "scheduled", "scheduled", wo.scheduled_date, workDays(wo), baseOf(wo), pm?.next_due_on ?? null, true);
    } else if (isRecurring(wo) && pm) {
      const days = Object.keys(wo.day_hours).length || wo.estimated_hours ? workDays(wo) : [{ [pm.task.craft]: pm.task.est_hours * pm.task.crew_size }];
      place(wo.id, wo.stage === "scheduling" ? "ready" : "forecast", "pm_due", pm.next_due_on, days, baseOf(wo), pm.next_due_on, true);
    } else if (wo.stage === "scheduling") {
      corrective.push(wo);
    } else if (!isRecurring(wo)) {
      awaitingPlanning.push({ id: wo.id, number: wo.wo_number, title: wo.title, stage: wo.stage, priority: wo.priority });
    }
  }
  // PMs coming due with no work order yet: forecast from the PM task template.
  for (const s of pmSchedules) {
    if (s.open_wo || !s.is_active || s.next_due_on > to) continue;
    const h = s.task.est_hours * s.task.crew_size;
    place(
      `pm-${s.id}`,
      "pm_due",
      "pm_due",
      s.next_due_on,
      [{ [s.task.craft]: h }],
      { title: s.task.title, floc: s.asset.floc, criticality: s.asset.criticality, assignee: null, pmCode: s.task.code, partsShort: 0, partsReadyOn: null },
      s.next_due_on,
      true,
    );
  }

  // 2. Corrective work: earliest day with parts on site and crew free, highest priority first.
  const waitingParts: CalendarItem[] = [];
  corrective.sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at));
  for (const wo of corrective) {
    const days = workDays(wo);
    const partsKnown = wo.parts_short === 0 || wo.parts_ready_on !== null;
    if (!partsKnown) {
      // No date for the parts, so no date for the job. Listed in the backlog, not drawn.
      waitingParts.push(...place(wo.id, "ready", "waiting_parts", today, [days.reduce(mergeHours, {})], baseOf(wo), null, false, false));
      continue;
    }
    const earliest = wo.parts_short && wo.parts_ready_on! > today ? wo.parts_ready_on! : today;
    const start = earliestFit(days, earliest, cap, ledger) ?? earliest;
    place(wo.id, "ready", "earliest", start, days, baseOf(wo), null, true);
  }

  // 3. Lay out the visible days.
  const crafts = new Set<LoadKey>(cap.rostered);
  const days: CalendarDay[] = [];
  for (let i = 0; i < input.days; i++) {
    const date = addDays(from, i);
    const dayItems = segments
      .filter((it) => it.date === date)
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.wo?.priority ?? 5) - (b.wo?.priority ?? 5) || a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
    const load: Partial<Record<LoadKey, DayLoad>> = {};
    const bucket = (k: LoadKey) => (load[k] ??= { available: 0, booked: 0, forecast: 0 });
    const capacity = cap.on(date);
    for (const [c, h] of Object.entries(capacity) as [LoadKey, number][]) bucket(c).available = h;
    const bookedBy = new Map<string, number>();
    for (const it of dayItems) {
      for (const [k, h] of Object.entries(it.hours) as [LoadKey, number][]) {
        crafts.add(k);
        if (it.kind === "scheduled") bucket(k).booked += h;
        else bucket(k).forecast += h;
      }
      if (it.kind === "scheduled" && it.assignee) bookedBy.set(it.assignee.id, (bookedBy.get(it.assignee.id) ?? 0) + it.totalHours);
    }
    const people: PersonDay[] = [];
    for (const m of crew) {
      if (!m.shift) continue;
      const { hours, away } = personAvailability(m, date);
      people.push({ id: m.id, name: m.full_name, craft: m.craft, available: hours, booked: bookedBy.get(m.id) ?? 0, away });
    }
    days.push({ date, isToday: date === today, items: dayItems, load, people });
  }

  const firstOf = new Map<string, CalendarItem>();
  for (const s of [...segments, ...waitingParts]) {
    if (s.kind !== "ready" || !s.wo) continue;
    const prev = firstOf.get(s.wo.id);
    if (!prev || s.date < prev.date) firstOf.set(s.wo.id, s);
  }
  const backlog = [...firstOf.values()].sort((a, b) => a.wo!.priority - b.wo!.priority || a.start.localeCompare(b.start));
  const lateWos = new Set(segments.filter((s) => s.late).map((s) => s.wo?.id ?? s.key));

  return {
    days,
    backlog,
    awaitingPlanning: awaitingPlanning.sort((a, b) => a.priority - b.priority),
    lateCount: lateWos.size,
    crafts: [...crafts].sort((a, b) => LOAD_ORDER.indexOf(a) - LOAD_ORDER.indexOf(b)),
  };
}

const KIND_ORDER: Record<ItemKind, number> = { scheduled: 0, ready: 1, forecast: 2, pm_due: 3 };
const LOAD_ORDER: LoadKey[] = ["mechanical", "electrical", "instrumentation", "process_controls", "operations", "contractor", UNPLANNED];
