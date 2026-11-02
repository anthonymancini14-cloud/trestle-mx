"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, GripVertical, Info, MoveRight, Package, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/primitives";
import { PriorityBadge, StageBadge } from "@/components/status";
import { rescheduleWorkOrder, scheduleWorkOrder } from "@/lib/actions";
import { addDays } from "@/lib/pm/program";
import { UNPLANNED, type Calendar, type CalendarDay, type CalendarItem, type LoadKey } from "@/lib/schedule/calendar";
import { cn, formatDay } from "@/lib/utils";
import { CRAFT_LABELS, STAGE_LABELS, type Craft } from "@/types/domain";

const SHORT: Record<LoadKey, string> = {
  mechanical: "Mech",
  electrical: "Elec",
  instrumentation: "I&C",
  process_controls: "Ctrl",
  operations: "Ops",
  contractor: "Contr",
  [UNPLANNED]: "Unpl",
};
const loadLabel = (k: LoadKey) => (k === UNPLANNED ? "Not yet planned" : CRAFT_LABELS[k]);
const fmtH = (h: number) => (Number.isInteger(h) ? `${h}` : h.toFixed(1));
/** Pixels a pointer moves before a press becomes a drag (so taps and clicks still open the job). */
const DRAG_THRESHOLD = 6;

interface Pending {
  item: CalendarItem;
  /** The WCE's new first day. */
  date: string;
}

interface DragState {
  item: CalendarItem;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
}

/** Day the WCE starts on if this segment is dropped on `date`: a multi-day job keeps its shape. */
const startFor = (item: CalendarItem, date: string) => addDays(date, -((item.span?.day ?? 1) - 1));

/**
 * The scheduling board. Everything on it comes from the server render, so it
 * shows the work orders as they are now; after any change (here or anywhere
 * else in the app) the server re-renders it. It also refreshes every minute
 * so a scheduler sees moves other people make.
 *
 * Dragging uses pointer events, so it works with a mouse, a pen or a finger.
 * On touch screens, drag by the grip so the board can still scroll.
 */
export function ScheduleBoard({
  calendar,
  canMove,
  crew,
  viewerRole,
  schedulers,
  demo,
}: {
  calendar: Calendar;
  canMove: boolean;
  crew: { id: string; name: string; craft: Craft | null }[];
  viewerRole: string;
  /** Who can schedule here, for the notice shown to everyone else. */
  schedulers: string;
  demo: boolean;
}) {
  const router = useRouter();
  const [craft, setCraft] = useState<"" | LoadKey>("");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [refreshedAt, setRefreshedAt] = useState<string>("");
  const scroller = useRef<HTMLDivElement>(null);
  /** Set right after a drag so the click that ends it doesn't open the work order. */
  const suppressClick = useRef(false);

  useEffect(() => {
    const stamp = () => setRefreshedAt(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    stamp();
    const t = setInterval(() => {
      if (drag) return;
      router.refresh();
      stamp();
    }, 60_000);
    return () => clearInterval(t);
  }, [router, drag]);

  const movable = (it: CalendarItem) => canMove && !!it.wo && (it.kind === "scheduled" || it.kind === "ready");
  const shows = (it: CalendarItem) => !craft || it.hours[craft] !== undefined;
  const weeks = useMemo(() => {
    const out: CalendarDay[][] = [];
    for (let i = 0; i < calendar.days.length; i += 7) out.push(calendar.days.slice(i, i + 7));
    return out;
  }, [calendar.days]);
  const rows = craft ? [craft] : calendar.crafts;

  const drop = useCallback(
    (item: CalendarItem, date: string) => {
      const start = startFor(item, date);
      if (item.kind === "scheduled") {
        if (start === item.start) return;
        startTransition(async () => {
          const r = await rescheduleWorkOrder({ woId: item.wo!.id, date: start });
          setMessage(r.ok ? { ok: true, text: `${item.wo!.number} moved to start ${formatDay(start)}.` } : { ok: false, text: r.error });
        });
      } else if (item.kind === "ready") {
        // Scheduling needs a technician, so ask before saving.
        setDialog({ item, date: start });
      }
    },
    [startTransition],
  );

  // Track the pointer on the window while dragging, so a drag that leaves the card still lands.
  useEffect(() => {
    if (!drag) return;
    const dayAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-drop-date]") as HTMLElement | null)?.dataset.dropDate ?? null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      const active = drag.active || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_THRESHOLD;
      if (active) e.preventDefault();
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, active } : d));
      if (active) {
        setOverDay(dayAt(e.clientX, e.clientY));
        // Scroll the board sideways near its edges (it scrolls on narrow screens).
        const box = scroller.current?.getBoundingClientRect();
        if (box && scroller.current) {
          if (e.clientX < box.left + 40) scroller.current.scrollBy({ left: -24 });
          else if (e.clientX > box.right - 40) scroller.current.scrollBy({ left: 24 });
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      if (drag.active) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        const date = dayAt(e.clientX, e.clientY);
        if (date) drop(drag.item, date);
      }
      setDrag(null);
      setOverDay(null);
    };
    const onCancel = () => {
      setDrag(null);
      setOverDay(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [drag, drop]);

  const startDrag = (item: CalendarItem) => (e: ReactPointerEvent) => {
    if (!movable(item) || e.button !== 0) return;
    // A finger has to start on the grip; elsewhere it scrolls the page. A mouse can grab the whole card.
    const fromGrip = (e.target as HTMLElement).closest("[data-grip]");
    if (e.pointerType !== "mouse" && !fromGrip) return;
    if (fromGrip) e.preventDefault();
    setDrag({ item, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false });
  };

  const card = (it: CalendarItem) => (
    <ItemCard
      key={it.key}
      item={it}
      movable={movable(it)}
      dragging={!!drag?.active && drag.item.wo?.id === it.wo?.id}
      onPointerDown={startDrag(it)}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onMove={() => setDialog({ item: it, date: it.start < (calendar.days.find((d) => d.isToday)?.date ?? it.start) ? (calendar.days.find((d) => d.isToday)?.date ?? it.start) : it.start })}
    />
  );

  return (
    <div className={cn("space-y-3", drag?.active && "select-none")}>
      {!canMove && (
        <div role="note" className="flex items-start gap-2 rounded-[3px] border border-info/40 bg-info/10 px-3 py-2 text-sm text-tx-2">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <span>
            You&apos;re viewing as <strong className="capitalize">{viewerRole}</strong>, so the board is read-only. Scheduling here is done by{" "}
            {schedulers}.{" "}
            {demo ? "Switch to the supervisor in the top bar to drag jobs between days." : "An admin can add your role in the setting below the roster."}
          </span>
        </div>
      )}

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

      <div ref={scroller} className="overflow-x-auto rounded-[3px] border border-line">
        <div className="min-w-[1060px]">
          {weeks.map((week, wi) => (
            <div key={week[0].date} className={cn("grid grid-cols-7", wi > 0 && "border-t-2 border-line-strong")}>
              {week.map((day) => (
                <section
                  key={day.date}
                  data-drop-date={day.date}
                  aria-label={`${formatDay(day.date)} schedule`}
                  className={cn(
                    "flex min-h-72 flex-col border-l border-line first:border-l-0",
                    day.isToday ? "bg-brass/[0.04]" : "bg-panel",
                    overDay === day.date && "outline outline-2 -outline-offset-2 outline-brass",
                  )}
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
        <header className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-4 py-2.5">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-brass-dim">Backlog</div>
            <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Ready to schedule</h2>
          </div>
          <span className="max-w-xl text-right text-xs text-tx-3">
            Planned WCEs waiting for a date. Corrective work shows on the first day its parts are on site and the crew has the hours; PMs on
            their due date. {canMove ? "Drag a job onto a day, or use Schedule." : ""}
          </span>
        </header>
        {calendar.backlog.filter(shows).length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-tx-3">Nothing waiting. Every planned job has a date.</p>
        ) : (
          <div className="grid gap-1.5 p-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{calendar.backlog.filter(shows).map(card)}</div>
        )}
      </section>

      {calendar.awaitingPlanning.length > 0 && (
        <section aria-label="Corrective work not yet planned" className="rounded-[3px] border border-line bg-panel">
          <header className="border-b border-line px-4 py-2.5">
            <div className="text-[11px] uppercase tracking-wider text-brass-dim">Coming through planning</div>
            <h2 className="text-sm font-semibold">Corrective work with no date yet ({calendar.awaitingPlanning.length})</h2>
            <p className="text-xs text-tx-3">Corrective work has no due date. Once it is planned, the board places it by parts and crew hours.</p>
          </header>
          <ul className="divide-y divide-line/60">
            {calendar.awaitingPlanning.map((w) => (
              <li key={w.id}>
                <Link href={`/work-orders/${w.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm hover:bg-panel-2">
                  <span className="font-mono text-xs text-brass-bright">{w.number}</span>
                  {w.priority <= 2 && <PriorityBadge priority={w.priority} compact />}
                  <span className="min-w-0 flex-1 truncate">{w.title}</span>
                  <span className="text-xs text-tx-3">In {STAGE_LABELS[w.stage]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {drag?.active && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 w-48 rounded-[3px] border border-brass bg-panel-2 px-2 py-1 text-xs shadow-xl"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          <div className="font-mono text-brass-bright">{drag.item.wo?.number}</div>
          <div className="line-clamp-2">{drag.item.title}</div>
          <div className="text-tx-3">{overDay ? `Start ${formatDay(startFor(drag.item, overDay))}` : "Drop on a day"}</div>
        </div>
      )}

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
  const hoursOnShift = onShift.reduce((s, p) => s + p.available, 0);
  return (
    <header className="space-y-1.5 border-b border-line px-2 py-2">
      <div className="flex items-baseline justify-between">
        <span className={cn("text-sm font-semibold", day.isToday ? "text-brass-bright" : "text-tx")}>
          {d.toLocaleDateString("en-US", { weekday: "short" })} {d.getDate()}
          {day.isToday && <span className="ml-1 text-[10px] font-normal uppercase tracking-wider">Today</span>}
        </span>
        <span className="text-[11px] text-tx-3" title={`${onShift.length} technicians on shift, ${fmtH(hoursOnShift)} h`}>
          {onShift.length} on · {fmtH(hoursOnShift)} h
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
                  {l.forecast > 0 && <span className="text-tx-3">+{fmtH(l.forecast)}</span>}/{l.available ? fmtH(l.available) : "—"} h
                </div>
              </dd>
            </div>
          );
        })}
      </dl>
      {away.length > 0 && (
        <p className="truncate text-[10px] text-warn" title={away.map((p) => `${p.name}: ${p.away}`).join("\n")}>
          {away.length <= 2 ? `Away: ${away.map((p) => `${p.name.split(" ")[0]} (${p.away})`).join(", ")}` : `${away.length} away or partly away`}
        </p>
      )}
    </header>
  );
}

function ItemCard({
  item,
  movable,
  dragging,
  onPointerDown,
  onClickCapture,
  onMove,
}: {
  item: CalendarItem;
  movable: boolean;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
  onMove: () => void;
}) {
  const ghost = item.kind === "forecast" || item.kind === "pm_due" || item.basis === "earliest" || item.basis === "waiting_parts";
  const craftText = (Object.entries(item.hours) as [LoadKey, number][]).map(([k, h]) => `${fmtH(h)} h ${SHORT[k]}`).join(" · ");
  const body = (
    <>
      <div className="flex items-center gap-1 pr-6">
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
        {item.span && <span className="rounded-[2px] bg-panel-3 px-1 text-tx-2">Day {item.span.day} of {item.span.of}</span>}
        {item.wo && item.kind === "scheduled" && <StageBadge stage={item.wo.stage} status="open" />}
        {item.basis === "earliest" && (
          <span className="text-tx-3">Earliest workable{item.partsReadyOn ? ` · parts on site ${formatDay(item.partsReadyOn)}` : ""}</span>
        )}
        {item.basis === "waiting_parts" && (
          <span className="inline-flex items-center gap-0.5 text-warn">
            <Package className="size-3" aria-hidden /> Waiting on {item.partsShort} part{item.partsShort === 1 ? "" : "s"}, no date
          </span>
        )}
        {item.basis === "pm_due" && item.kind !== "pm_due" && <span className="text-tx-3">PM due {formatDay(item.due)}</span>}
        {item.kind === "forecast" && item.wo && <span className="text-tx-3">In {STAGE_LABELS[item.wo.stage]}</span>}
        {item.kind === "pm_due" && <span className="text-tx-3">PM due {formatDay(item.due)} · no work order yet</span>}
        {item.wo?.requiresShutdown && <AlertTriangle className="size-3 text-warn" aria-label="Needs a shutdown" />}
      </div>
      <div className="flex items-center justify-between gap-1 text-[10px]">
        <span className="font-mono text-tx-3">{craftText || (item.span ? "No crew this day" : "Not estimated")}</span>
        {item.assignee && <span className="truncate text-tx-2">{item.assignee.name.split(" ")[0]}</span>}
      </div>
    </>
  );
  return (
    <article
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      data-wo={item.wo?.number}
      aria-label={`${item.wo?.number ?? item.pmCode} ${item.title}${item.span ? `, day ${item.span.day} of ${item.span.of}` : ""}`}
      className={cn(
        "group relative space-y-0.5 rounded-[3px] border px-1.5 py-1 transition-colors",
        ghost ? "border-dashed border-line-strong bg-transparent opacity-80" : "border-line-strong bg-panel-2",
        item.kind === "ready" && "border-info/50",
        movable && "cursor-grab hover:border-brass-dim",
        dragging && "opacity-40",
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
          className="mt-0.5 w-full rounded-[2px] border border-line-strong bg-panel-3 py-0.5 text-[10px] text-brass hover:text-brass-bright lg:hidden lg:group-hover:block lg:group-focus-within:block"
        >
          {item.kind === "scheduled" ? "Move to another day" : "Schedule"}
        </button>
      )}
      {movable && (
        <div className="absolute right-0.5 top-0.5">
          <span
            data-grip
            aria-hidden
            style={{ touchAction: "none" }}
            className="flex h-7 w-6 cursor-grab items-center justify-center rounded-[2px] text-tx-3 hover:bg-panel-3 hover:text-brass active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </span>
        </div>
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
        <span className="size-2.5 rounded-[2px] border border-info/60 bg-panel-2" /> Ready (PM due)
      </li>
      <li className="flex items-center gap-1">
        <span className="size-2.5 rounded-[2px] border border-dashed border-info/60" /> Ready (earliest workable day)
      </li>
      <li className="flex items-center gap-1">
        <span className="size-2.5 rounded-[2px] border border-dashed border-line-strong" /> PM forecast
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
  const needed = (Object.keys(item.hours) as LoadKey[]).filter((k): k is Craft => k !== UNPLANNED);
  // Default to the craft the job needs most; a roster of hundreds is filtered, not scrolled.
  const mainCraft = needed.sort((a, b) => (item.hours[b] ?? 0) - (item.hours[a] ?? 0))[0] ?? "";
  const [craftFilter, setCraftFilter] = useState<"" | Craft>(mainCraft && crew.some((c) => c.craft === mainCraft) ? mainCraft : "");
  const freeHours = (id: string) => {
    if (!day || day.date !== date) return null;
    const p = day.people.find((x) => x.id === id);
    return p ? p.available - p.booked : null;
  };
  const options = crew
    .filter((c) => !craftFilter || c.craft === craftFilter)
    .sort((a, b) => (freeHours(b.id) ?? 0) - (freeHours(a.id) ?? 0) || a.name.localeCompare(b.name));
  const [assignee, setAssignee] = useState(item.assignee?.id ?? options[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const crafts = [...new Set(crew.map((c) => c.craft).filter((c): c is Craft => !!c))];

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
            onDone(scheduling ? `${item.wo!.number} scheduled to start ${formatDay(date)} with ${who}.` : `${item.wo!.number} moved to start ${formatDay(date)}.`);
          });
        }}
        className="w-full max-w-md space-y-3 rounded-[3px] border border-line-strong bg-panel p-4 shadow-xl"
      >
        <div>
          <div className="text-[11px] uppercase tracking-wider text-brass-dim">
            {scheduling ? "Schedule" : "Move"} · WCE {item.wo?.number}
          </div>
          <h2 id="plan-dialog-title" className="text-base font-semibold">
            {item.title}
          </h2>
          <p className="text-xs text-tx-3">
            {item.span ? `${item.span.of}-day job; this sets day 1. ` : ""}
            {item.due && `PM due ${formatDay(item.due)}. `}
            {item.partsShort > 0 && (item.partsReadyOn ? `Parts on site ${formatDay(item.partsReadyOn)}. ` : "Waiting on parts with no date. ")}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="plan-date">{item.span ? "Day 1" : "Date"}</Label>
          <Input id="plan-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
          {item.partsReadyOn && date < item.partsReadyOn && <p className="text-xs text-warn">That&apos;s before the parts are expected on site.</p>}
        </div>
        {scheduling ? (
          <div className="space-y-1">
            <Label htmlFor="plan-tech">Lead technician</Label>
            <div className="flex gap-1">
              <Select aria-label="Technician craft" value={craftFilter} onChange={(e) => setCraftFilter(e.target.value as Craft | "")} className="h-11 w-36 shrink-0">
                <option value="">All crafts</option>
                {crafts.map((c) => (
                  <option key={c} value={c}>
                    {CRAFT_LABELS[c]}
                  </option>
                ))}
              </Select>
              <Select id="plan-tech" required value={assignee} onChange={(e) => setAssignee(e.target.value)} className="h-11 min-w-0 flex-1">
                {!options.some((o) => o.id === assignee) && <option value="">Pick a technician</option>}
                {options.map((c) => {
                  const free = freeHours(c.id);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {free !== null && ` · ${fmtH(free)} h free`}
                    </option>
                  );
                })}
              </Select>
            </div>
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
          <Button type="submit" variant="primary" disabled={busy || (scheduling && !assignee)}>
            <MoveRight aria-hidden />
            {busy ? "Saving…" : scheduling ? "Schedule" : "Move"}
          </Button>
        </div>
      </form>
    </div>
  );
}
