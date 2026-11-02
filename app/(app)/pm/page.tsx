import Link from "next/link";
import { QualityStat, qualityTone } from "@/components/assets/data-quality";
import { GeneratePmsButton } from "@/components/pm/pm-controls";
import { PmTable } from "@/components/pm/pm-table";
import { EmptyState, Mono, Panel, PanelHeader } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { daysBetween, dueState, summarizeProgram, type DueState } from "@/lib/pm/program";
import { cn, formatDay, todayAt } from "@/lib/utils";
import { canPm } from "@/lib/workflow";

export const metadata = { title: "PM program" };

const FILTERS: { key: "attention" | DueState | "all"; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "overdue", label: "Overdue" },
  { key: "due", label: "Due" },
  { key: "upcoming", label: "Next 30 days" },
  { key: "all", label: "All" },
];

export default async function PmProgramPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show = "attention" } = await searchParams;
  const { repo, profile } = await getViewer();
  const [schedules, assets, { site }, classes] = await Promise.all([repo.listPmSchedules(), repo.listAssets(), repo.getSite(), repo.listAssetClasses()]);
  const modeNames: Record<string, string> = {};
  for (const c of classes) for (const m of c.failure_modes) modeNames[m.code] ??= m.name;
  const today = todayAt(site.timezone);
  const summary = summarizeProgram(schedules, today);
  const rows = schedules.map((s) => ({ ...s, state: dueState(s.next_due_on, today), days: daysBetween(today, s.next_due_on) }));
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, 0])) as Record<string, number>;
  for (const r of rows) {
    counts[r.state] += 1;
    counts.all += 1;
    if (r.state !== "current") counts.attention += 1;
  }
  const visible = rows.filter((r) => (show === "all" ? true : show === "attention" ? r.state !== "current" : r.state === show));
  const dueWithoutWo = rows.filter((r) => (r.state === "overdue" || r.state === "due") && !r.open_wo).length;
  const deferrals = rows
    .flatMap((r) => r.deferrals.map((d) => ({ ...d, row: r })))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const canDefer = canPm("defer", profile.role);
  const coveredPct = assets.length ? Math.round((summary.assetsCovered / assets.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">PM program</h1>
          <p className="max-w-3xl text-sm text-tx-3">
            Every PM task from the class library, scheduled on every asset at {site.name} by its class and criticality. A due date moves only
            when the PM is completed or a supervisor approves a deferral.
          </p>
        </div>
        {canPm("generate", profile.role) && <GeneratePmsButton dueWithoutWo={dueWithoutWo} />}
      </div>

      <section aria-label="PM program summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        <QualityStat label="Assets with a PM program" value={`${summary.assetsCovered}/${assets.length}`} detail={`${coveredPct}%; the rest are run to failure`} />
        <QualityStat label="Scheduled PM tasks" value={String(summary.schedules)} />
        <QualityStat label="In compliance" value={`${summary.inCompliancePct}%`} detail="Not past due" tone={qualityTone(summary.inCompliancePct)} />
        <QualityStat label="Overdue" value={String(summary.overdue)} tone={summary.overdue ? "bad" : "good"} />
        <QualityStat label="Due (next 14 days)" value={String(summary.due)} detail={`${dueWithoutWo} due or overdue with no work order`} tone={dueWithoutWo ? "warn" : undefined} />
        <QualityStat label="Deferrals" value={String(summary.deferrals)} detail="Supervisor approved" />
      </section>

      <nav aria-label="Filter PMs" className="flex gap-1 overflow-x-auto border-b border-line">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/pm?show=${f.key}`}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm",
              show === f.key ? "border-brass text-tx" : "border-transparent text-tx-3 hover:text-tx-2",
            )}
          >
            {f.label} <span className="font-mono text-xs text-tx-3">{counts[f.key]}</span>
          </Link>
        ))}
      </nav>

      <Panel>
        <PmTable rows={visible} modeNames={modeNames} canDefer={canDefer} />
      </Panel>

      <Panel>
        <PanelHeader eyebrow="Audit" title="Deferral log" actions={<span className="font-mono text-xs text-tx-3">{deferrals.length}</span>} />
        {deferrals.length === 0 ? (
          <EmptyState>No deferrals.</EmptyState>
        ) : (
          <ul className="divide-y divide-line/60">
            {deferrals.map((d) => (
              <li key={d.id} className="px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Mono className="text-xs">{d.row.asset.floc}</Mono>
                  <span className="text-tx-2">{d.row.task.title}</span>
                  <span className="ml-auto text-xs text-tx-3">
                    {formatDay(d.from_due_on)} → {formatDay(d.to_due_on)} · {d.approver_name ?? "supervisor"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-tx-3">{d.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
