import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { QualityStat } from "@/components/assets/data-quality";
import { RosterPanel, SchedulerRolesForm } from "@/components/schedule/roster-panel";
import { ScheduleBoard } from "@/components/schedule/schedule-board";
import { getViewer } from "@/lib/auth/viewer";
import { addDays } from "@/lib/pm/program";
import { buildCalendar, weekStart } from "@/lib/schedule/calendar";
import { cn, formatDay, todayAt } from "@/lib/utils";
import { canScheduleAt } from "@/lib/workflow";
import { ROLE_LABELS } from "@/types/domain";

export const metadata = { title: "Schedule" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string; span?: string }> }) {
  const params = await searchParams;
  const { repo, profile } = await getViewer();
  const [work, pmSchedules, crew, { site }] = await Promise.all([repo.listCalendarWork(), repo.listPmSchedules(), repo.listCrew(), repo.getSite()]);

  // "Today" is the site's day, not the server's.
  const today = todayAt(site.timezone);
  const span = params.span === "2" ? 2 : 1;
  const from = weekStart(params.week && ISO.test(params.week) ? params.week : today);
  const calendar = buildCalendar({ from, days: span * 7, today, work, pmSchedules, crew });
  const canMove = canScheduleAt(profile.role, { schedulerRoles: site.scheduler_roles });

  // Totals for the visible range.
  let available = 0;
  let booked = 0;
  let forecast = 0;
  for (const d of calendar.days)
    for (const l of Object.values(d.load)) {
      available += l?.available ?? 0;
      booked += l?.booked ?? 0;
      forecast += l?.forecast ?? 0;
    }
  const loadPct = available ? Math.round((booked / available) * 100) : 0;
  const late = calendar.lateCount;
  const href = (week: string, s = span) => `/schedule?week=${week}${s === 2 ? "&span=2" : ""}`;
  const who = ["Admin", ...site.scheduler_roles.map((r) => ROLE_LABELS[r])].join(", ");

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Schedule</h1>
          <p className="max-w-3xl text-sm text-tx-3">
            Scheduled jobs, planned work waiting for a date, and forecast work on its due date, against the hours the crew has each day. It
            reads the work orders directly, so a job moved anywhere shows here. Schedulers at {site.name}: {who}.
          </p>
        </div>
        <nav aria-label="Weeks" className="flex flex-wrap items-center gap-1">
          <Link href={href(addDays(from, -7))} className="flex h-9 w-9 items-center justify-center rounded-[3px] border border-line-strong hover:border-brass-dim" aria-label="Previous week">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <Link href={href(today)} className="flex h-9 items-center whitespace-nowrap rounded-[3px] border border-line-strong px-3 text-sm hover:border-brass-dim">
            This week
          </Link>
          <Link href={href(addDays(from, 7))} className="flex h-9 w-9 items-center justify-center rounded-[3px] border border-line-strong hover:border-brass-dim" aria-label="Next week">
            <ChevronRight className="size-4" aria-hidden />
          </Link>
          <span className="mx-2 whitespace-nowrap font-mono text-xs text-tx-2">
            {formatDay(from)} – {formatDay(addDays(from, span * 7 - 1))}
          </span>
          <div className="flex overflow-hidden rounded-[3px] border border-line-strong text-sm">
            {[1, 2].map((s) => (
              <Link key={s} href={href(from, s)} className={cn("whitespace-nowrap px-3 py-1.5", span === s ? "bg-brass/15 text-brass-bright" : "text-tx-3 hover:text-tx-2")}>
                {s === 1 ? "1 week" : "2 weeks"}
              </Link>
            ))}
          </div>
        </nav>
      </div>

      <section aria-label="Schedule summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        <QualityStat label="Crew hours available" value={`${Math.round(available)} h`} detail={`${crew.filter((c) => c.shift).length} technicians, less time off`} />
        <QualityStat label="Booked" value={`${Math.round(booked)} h`} detail={`${loadPct}% of available`} tone={loadPct > 100 ? "bad" : loadPct > 85 ? "warn" : undefined} />
        <QualityStat label="Forecast" value={`${Math.round(forecast)} h`} detail="Unscheduled work due in this range" />
        <QualityStat label="Ready to schedule" value={String(calendar.backlog.length)} detail="Planned, waiting for a date" tone={calendar.backlog.length ? "warn" : "good"} />
        <QualityStat label="Late" value={String(late)} detail="Past its date and still open; shown on today" tone={late ? "bad" : "good"} />
      </section>

      <ScheduleBoard
        calendar={calendar}
        canMove={canMove}
        crew={crew.filter((c) => c.shift).map((c) => ({ id: c.id, name: c.full_name, craft: c.craft }))}
      />

      <RosterPanel crew={crew} canEdit={canMove} today={today} />
      {profile.role === "admin" && <SchedulerRolesForm current={site.scheduler_roles} siteName={site.name} />}
    </div>
  );
}
