import type { AssetStatus, AssetStatusEvent, WoType } from "@/types/domain";

/**
 * Downtime arithmetic, from an asset's status history. An asset is down from
 * a "down" event until its next event. Standby counts as available: the
 * equipment could run. Time before the first event is unknown and is left
 * out of every figure.
 */

type Event = Pick<AssetStatusEvent, "status" | "started_at" | "wo_id"> & { wo?: { wo_type: WoType } | null };

export interface StatusInterval {
  status: AssetStatus;
  from: string;
  /** Null while this is still the current status. */
  to: string | null;
  wo_id: string | null;
  /** Down for preventive or project work, as opposed to a failure. */
  planned: boolean;
}

const PLANNED_TYPES: WoType[] = ["preventive", "project"];

/** The history as back-to-back intervals, oldest first. */
export function statusIntervals(events: Event[]): StatusInterval[] {
  const sorted = [...events].sort((a, b) => a.started_at.localeCompare(b.started_at));
  return sorted.map((e, i) => ({
    status: e.status,
    from: e.started_at,
    to: sorted[i + 1]?.started_at ?? null,
    wo_id: e.wo_id,
    planned: e.status === "down" && !!e.wo && PLANNED_TYPES.includes(e.wo.wo_type),
  }));
}

const HOUR_MS = 3_600_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Hours of an interval that fall inside a window. */
function overlapHours(interval: StatusInterval, from: number, to: number): number {
  const start = Math.max(Date.parse(interval.from), from);
  const end = Math.min(interval.to ? Date.parse(interval.to) : to, to);
  return end > start ? (end - start) / HOUR_MS : 0;
}

export interface DowntimeSummary {
  /** Hours of the window the status history covers (not retired). */
  knownHours: number;
  plannedHours: number;
  unplannedHours: number;
  /** Times the asset went down in the window. */
  downEvents: number;
  /** Share of the known hours the asset was not down. Null when the history covers none of the window. */
  availability: number | null;
}

/** Downtime between two instants. `until` is "now" for an open-ended window. */
export function downtime(events: Event[], since: string, until: string): DowntimeSummary {
  const from = Date.parse(since);
  const to = Date.parse(until);
  let known = 0;
  let planned = 0;
  let unplanned = 0;
  let downEvents = 0;
  for (const interval of statusIntervals(events)) {
    const hours = overlapHours(interval, from, to);
    if (interval.status === "retired") continue;
    known += hours;
    if (interval.status !== "down") continue;
    if (interval.planned) planned += hours;
    else unplanned += hours;
    const started = Date.parse(interval.from);
    if (started >= from && started <= to) downEvents += 1;
  }
  return {
    knownHours: round1(known),
    plannedHours: round1(planned),
    unplannedHours: round1(unplanned),
    downEvents,
    availability: known > 0 ? (known - planned - unplanned) / known : null,
  };
}

/** Hours the asset was down on intervals that started on this work order. Zero when the work order never took it down. */
export function woDowntimeHours(events: Event[], woId: string, until: string): number {
  const to = Date.parse(until);
  return round1(
    statusIntervals(events)
      .filter((i) => i.status === "down" && i.wo_id === woId)
      .reduce((sum, i) => sum + overlapHours(i, Date.parse(i.from), to), 0),
  );
}

/** The current status and when it started, or null with no history. */
export function currentStatus(events: Event[]): StatusInterval | null {
  return statusIntervals(events).at(-1) ?? null;
}

/** Hours as "6.5 h" under two days, otherwise days: "3.2 d". */
export function formatDuration(hours: number): string {
  if (hours < 48) return `${round1(hours)} h`;
  return `${round1(hours / 24)} d`;
}
