"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type DragEvent } from "react";
import { AlertTriangle, GripVertical, MoveRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/primitives";
import { PriorityBadge, StageBadge } from "@/components/status";
import { rescheduleWorkOrder, scheduleWorkOrder } from "@/lib/actions";
import { UNPLANNED, type Calendar, type CalendarDay, type CalendarItem, type LoadKey } from "@/lib/schedule/calendar";
import { cn, formatDay } from "@/lib/utils";
import { CRAFT_LABELS, type Craft } from "@/types/domain";

const SHORT: Record<LoadKey, string> = {
  mechanical: "Mech",
  electrical: "Elec",
  instrumentation: "I&C",
  operations: "Ops",
  contractor: "Contr",
  [UNPLANNED]: "Unpl",
};
const loadLabel = (k: LoadKey) => (k === UNPLANNED ? "Not yet planned" : CRAFT_LABELS[k]);
const fmtH = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(1));

interface Pending {
  item: CalendarItem;
  date: string;
}

/**
 * The scheduling board. Everything on it comes from the server render, so it
 * shows the work orders as they are now; after any change (here or anywhere
 * else in the app) the server re-renders it. It also refreshes every minute
 * so a scheduler sees moves other people make.
 */
export function ScheduleBoard({
  calendar,
  canMove,
  crew,
}: {
  calendar: Calendar;
  canMove: boolean;
  crew: { id: string; name: string; craft: Craft | null }[];
}) {
  const router = useRouter();
  const [craft, setCraft] = useState<"" | LoadKey>("");
  const [dragging, setDragging] = useState<CalendarItem | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [refreshedAt, setRefreshedAt] = useState<string>("");

  useEffect(() => {
    const stamp = () => setRefreshedAt(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    stamp();
    const t = setInterval(() => {
      router.refresh();
      stamp();
    }, 60_000);
    return () => clearInterval(t);
  }, [router]);

  const movable = (it: CalendarItem) => canMove && (it.kind === "scheduled" || it.kind === "ready");
  const shows = (it: CalendarItem) => !craft || it.hours[craft] !== undefined;
  const weeks = useMemo(() => {
    const out: CalendarDay[][] = [];
    for (let i = 0; i < calendar.days.length; i += 7) out.push(calendar.days.slice(i, i + 7));
    return out;
  }, [calendar.days]);
  const rows = craft ? [craft] : calendar.crafts;

  function drop(item: CalendarItem, date: string) {
    setDragging(null);
    setOverDay(null);
    if (item.kind === "scheduled") {
      if (item.date === date) return;
      startTransition(async () => {
        const r = await rescheduleWorkOrder({ woId: item.wo!.id, date });
        setMessage(r.ok ? { ok: true, text: `${item.wo!.number} moved to ${formatDay(date)}.` } : { ok: false, text: r.error });
      });
    } else if (item.kind === "ready") {
      // Scheduling needs a technician, so ask before saving.
      setDialog({ item, date });
    }
  }

  const dayProps = (date: string) =>
    canMove
      ? {
          onDragOver: (e: DragEvent) => {
            if (!dragging) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (overDay !== date) setOverDay(date);
          },
          onDragLeave: () => setOverDay((d) => (d === date ? null : d)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            if (dragging) drop(dragging, date);
          },
        }
      : {};

  const card = (it: CalendarItem) => (
    <ItemCard
      key={it.key}
      item={it}
      movable={movable(it)}
      onDragStart={() => setDragging(it)}
      onDragEnd={() => {
        setDragging(null);
        setOverDay(null);
      }}
      onMove={() => setDialog({ item: it, date: it.kind === "scheduled" ? it.date : calendar.days.find((d) => d.isToday)?.date ?? it.date })}
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Craft" value={craft} onChange={(e) => setCraft(e.target.value as LoadKey | "")} className="w-auto">
          <option value="">All crafts</option>
          {calendar.crafts.map((k) => (
            <option key={k} value={k}>
              {loadLabel(k)}
            </option>
          ))}
        </Select>
        <Legend />
        <span className="ml-auto text-xs text-tx-3" aria-live="polite">
          {pending ? "Saving…" : refreshedAt && `Live · refreshed ${refreshedAt}`}
        </span>
      </div>

      {message && (
        <div
          role="status"
          className={cn(
            "flex items-center justify-between rounded-[3px] border px-3 py-2 text-sm",
            message.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad",
          )}
        >
          {message.text}
          <button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-[3px] border border-line">
        <div className="min-w-[1060px]">
          {weeks.map((week, wi) => (
            <div key={week[0].date} className={cn("grid grid-cols-7", wi > 0 && "border-t-2 border-line-strong")}>
              {week.map((day) => (
                <section
                  key={day.date}
                  aria-label={`${formatDay(day.date)} schedule`}
                  className={cn(
                    "flex min-h-72 flex-col border-l border-line first:border-l-0",
                    day.isToday ? "bg-brass/[0.04]" : "bg-panel",
                    overDay === day.date && "outline outline-2 -outline-offset-2 outline-brass",
                  )}
                  {...dayProps(day.date)}
                >
                  <DayHeader day={day} rows={rows} />
                  <div className="flex flex-1 flex-col gap-1.5 p-1.5">
                    {day.items.filter(shows).map(card)}
                    {day.items.filter(shows).length === 0 && <p className="px-1 py-3 text-center text-[11px] text-tx-3">No work</p>}
                  </div>
                </section>
              ))}
            </div>
          ))}
        </div>
      </div>

      <section aria-label="Ready to schedule" className="rounded-[3px] border border-line bg-panel">
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-brass-dim">Backlog</div>
            <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Ready to schedule</h2>
          </div>
          <span className="max-w-md text-right text-xs text-tx-3">
            Planned work waiting for a date. {canMove ? "Drag a job onto a day, or use Schedule." : "A scheduler gives each job a date and a technician."}
          </span>
        </header>
        {calendar.backlog.filter(shows).length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-tx-3">Nothing waiting. Every planned job has a date.</p>
        ) : (
          <div className="grid gap-1.5 p-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{calendar.backlog.filter(shows).map(card)}</div>
        )}
      </section>

      {dialog && (
        <PlanDialog
          pending={dialog}
          crew={crew}
          day={calendar.days.find((d) => d.date === dialog.date)}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage({ ok: true, text });
          }}
        />
      )}
    </div>
  );
}

function DayHeader({ day, rows }: { day: CalendarDay; rows: LoadKey[] }) {
  const d = new Date(`${day.date}T12:00:00`);
  const onShift = day.people.filter((p) => p.available > 0);
  const away = day.people.filter((p) => p.away);
  return (
    <header className="space-y-1.5 border-b border-line px-2 py-2">
      <div className="flex items-baseline justify-between">
        <span className={cn("text-sm font-semibold", day.isToday ? "text-brass-bright" : "text-tx")}>
          {d.toLocaleDateString("en-US", { weekday: "short" })} {d.getDate()}
          {day.isToday && <span className="ml-1 text-[10px] font-normal uppercase tracking-wider">Today</span>}
        </span>
        <span className="text-[11px] text-tx-3" title={onShift.map((p) => `${p.name}: ${fmtH(p.available)} h`).join("\n")}>
          {onShift.length} on shift
        </span>
      </div>
      <dl className="space-y-1">
        {rows.map((k) => {
          const l = day.load[k] ?? { available: 0, booked: 0, forecast: 0 };
          if (k === UNPLANNED && !l.booked && !l.forecast) return null;
          const cap = Math.max(l.available, 0.0001);
          const over = l.booked > l.available;
          const overWithForecast = !over && l.booked + l.forecast > l.available;
          return (
            <div
              key={k}
              className="grid grid-cols-[2.6rem_1fr] items-center gap-1.5"
              title={`${loadLabel(k)}: ${fmtH(l.booked)} h booked, ${fmtH(l.forecast)} h forecast, ${fmtH(l.available)} h available`}
            >
              <dt className="text-[10px] uppercase tracking-wider text-tx-3">{SHORT[k]}</dt>
              <dd className="space-y-0.5">
                <div className="flex h-1.5 overflow-hidden rounded-full bg-panel-3">
                  <span className={cn("h-full", over ? "bg-bad" : "bg-brass")} style={{ width: `${Math.min(100, (l.booked / cap) * 100)}%` }} />
                  <span className="hazard-fill h-full bg-steel/60" style={{ width: `${Math.min(100, (l.forecast / cap) * 100)}%` }} />
                </div>
                <div className={cn("font-mono text-[10px] leading-none", over ? "text-bad" : overWithForecast ? "text-warn" : "text-tx-3")}>
                  {fmtH(l.booked)}
                  {l.forecast > 0 && <span className="text-tx-3">+{fmtH(l.forecast)}</span>}/{k === UNPLANNED ? "—" : fmtH(l.available)} h
                </div>
              </dd>
            </div>
          );
        })}
      </dl>
      {away.length > 0 && (
        <p className="truncate text-[10px] text-warn" title={away.map((p) => `${p.name}: ${p.away}`).join("\n")}>
          Away: {away.map((p) => `${p.name.split(" ")[0]} (${p.away})`).join(", ")}
        </p>
      )}
    </header>
  );
}

function ItemCard({
  item,
  movable,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  item: CalendarItem;
  movable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: () => void;
}) {
  const ghost = item.kind === "forecast" || item.kind === "pm_due";
  const craftText = (Object.entries(item.hours) as [LoadKey, number][]).map(([k, h]) => `${fmtH(h)} h ${SHORT[k]}`).join(" · ");
  const body = (
    <>
      <div className="flex items-center gap-1">
        {movable && <GripVertical className="size-3 shrink-0 text-tx-3" aria-hidden />}
        {item.wo ? (
          <span className="font-mono text-[11px] text-brass-bright">{item.wo.number}</span>
        ) : (
          <span className="font-mono text-[11px] text-tx-3">{item.pmCode}</span>
        )}
        {item.wo && item.wo.priority <= 2 && <PriorityBadge priority={item.wo.priority} compact />}
      </div>
      <div className="line-clamp-2 text-xs leading-snug text-tx">{item.title}</div>
      {item.floc && <div className="truncate font-mono text-[10px] text-tx-3">{item.floc}</div>}
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-tx-2">
        {item.late && <span className="font-semibold uppercase text-bad">Late</span>}
        {item.wo && !ghost && <StageBadge stage={item.wo.stage} status="open" />}
        {item.kind === "forecast" && item.wo && <span className="text-tx-3">{`In ${item.wo.stage} · target ${formatDay(item.due)}`}</span>}
        {item.kind === "ready" && <span className="text-tx-3">Due {formatDay(item.due)}</span>}
        {item.kind === "pm_due" && <span className="text-tx-3">PM due {formatDay(item.due)} · no work order yet</span>}
        {item.wo?.requiresShutdown && <AlertTriangle className="size-3 text-warn" aria-label="Needs a shutdown" />}
      </div>
      <div className="flex items-center justify-between gap-1 text-[10px]">
        <span className="font-mono text-tx-3">{craftText || "Not estimated"}</span>
        {item.assignee && <span className="truncate text-tx-2">{item.assignee.name.split(" ")[0]}</span>}
      </div>
    </>
  );
  return (
    <article
      draggable={movable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.key);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      aria-label={`${item.wo?.number ?? item.pmCode} ${item.title}`}
      className={cn(
        "group relative space-y-0.5 rounded-[3px] border px-1.5 py-1 transition-colors",
        ghost ? "border-dashed border-line-strong bg-transparent opacity-75" : "border-line-strong bg-panel-2",
        item.kind === "ready" && "border-info/40",
        movable && "cursor-grab active:cursor-grabbing hover:border-brass-dim",
      )}
    >
      {item.wo ? (
        <Link href={`/work-orders/${item.wo.id}`} className="block" draggable={false}>
          {body}
        </Link>
      ) : (
        <div>{body}</div>
      )}
      {movable && (
        <button
          type="button"
          onClick={onMove}
          className="absolute right-1 top-1 rounded-[2px] border border-line-strong bg-panel-3 px-1.5 py-0.5 text-[10px] text-brass hover:text-brass-bright lg:hidden lg:group-hover:block lg:group-focus-within:block"
        >
          {item.kind === "scheduled" ? "Move" : "Schedule"}
        </button>
      )}
    </article>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-[11px] text-tx-3" aria-label="Legend">
      <li className="flex items-center gap-1">
        <span className="size-2.5 rounded-[2px] border border-line-strong bg-panel-2" /> Scheduled
      </li>
      <li className="flex items-center gap-1">
        <span className="size-2.5 rounded-[2px] border border-info/50 bg-panel-2" /> Ready to schedule
      </li>
      <li className="flex items-center gap-1">
        <span className="size-2.5 rounded-[2px] border border-dashed border-line-strong" /> Forecast (not planned, or PM due)
      </li>
      <li className="flex items-center gap-1">
        <span className="h-1.5 w-4 rounded-full bg-brass" />
        <span className="hazard-fill h-1.5 w-4 rounded-full bg-steel/60" /> Booked + forecast vs available hours
      </li>
    </ul>
  );
}

/** Schedule a ready job (date + technician), or move a scheduled one (date + optional reason). */
function PlanDialog({
  pending: { item, date: initialDate },
  crew,
  day,
  onClose,
  onDone,
}: {
  pending: Pending;
  crew: { id: string; name: string; craft: Craft | null }[];
  day: CalendarDay | undefined;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const scheduling = item.kind === "ready";
  const [date, setDate] = useState(initialDate);
  const [reason, setReason] = useState("");
  const needed = Object.keys(item.hours) as LoadKey[];
  // Technicians whose craft the job needs come first.
  const options = [...crew].sort((a, b) => Number(!needed.includes(a.craft as LoadKey)) - Number(!needed.includes(b.craft as LoadKey)) || a.name.localeCompare(b.name));
  const [assignee, setAssignee] = useState(item.assignee?.id ?? options[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const freeHours = (id: string) => {
    if (!day || day.date !== date) return null;
    const p = day.people.find((x) => x.id === id);
    return p ? p.available - p.booked : null;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const r = scheduling
              ? await scheduleWorkOrder(item.wo!.id, date, assignee)
              : await rescheduleWorkOrder({ woId: item.wo!.id, date, reason });
            if (!r.ok) return setError(r.error);
            const who = crew.find((c) => c.id === assignee)?.name;
            onDone(scheduling ? `${item.wo!.number} scheduled for ${formatDay(date)} with ${who}.` : `${item.wo!.number} moved to ${formatDay(date)}.`);
          });
        }}
        className="w-full max-w-md space-y-3 rounded-[3px] border border-line-strong bg-panel p-4 shadow-xl"
      >
        <div>
          <div className="text-[11px] uppercase tracking-wider text-brass-dim">{scheduling ? "Schedule" : "Move"} · {item.wo?.number}</div>
          <h2 id="plan-dialog-title" className="text-base font-semibold">
            {item.title}
          </h2>
          <p className="text-xs text-tx-3">
            {(Object.entries(item.hours) as [LoadKey, number][]).map(([k, h]) => `${fmtH(h)} h ${loadLabel(k)}`).join(", ") || "Not estimated"}
            {item.due && ` · due ${formatDay(item.due)}`}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="plan-date">Date</Label>
          <Input id="plan-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
        </div>
        {scheduling ? (
          <div className="space-y-1">
            <Label htmlFor="plan-tech">Technician</Label>
            <Select id="plan-tech" required value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-11">
              {options.map((c) => {
                const free = freeHours(c.id);
                return (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.craft ? CRAFT_LABELS[c.craft] : "No craft"}
                    {free !== null && ` · ${fmtH(free)} h free`}
                  </option>
                );
              })}
            </Select>
            {freeHours(assignee) !== null && freeHours(assignee)! < item.totalHours && (
              <p className="text-xs text-warn">More hours than this technician has free that day.</p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="plan-reason">Reason (optional, goes in the audit log)</Label>
            <Input id="plan-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Parts arrive Thursday" className="h-11" />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            <MoveRight aria-hidden />
            {busy ? "Saving…" : scheduling ? "Schedule" : "Move"}
          </Button>
        </div>
      </form>
    </div>
  );
}
