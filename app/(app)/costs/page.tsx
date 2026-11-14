import Link from "next/link";
import { RateForm } from "@/components/costs/rate-form";
import { Stat, StatGrid } from "@/components/costs/stat";
import { TypeLabel } from "@/components/status";
import { EmptyState, Mono, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { formatMoney, formatRate, rateInEffect } from "@/lib/cost";
import { siteCostReport } from "@/lib/cost-report";
import { formatDuration } from "@/lib/downtime";
import { cn, formatDay, todayAt } from "@/lib/utils";
import { canCost } from "@/lib/workflow";
import { CRAFT_LABELS, CRAFTS } from "@/types/domain";

export const metadata = { title: "Cost and downtime" };

const PERIODS = [30, 90, 365] as const;

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: daysParam } = await searchParams;
  const days = PERIODS.find((p) => String(p) === daysParam) ?? 90;
  const { repo, profile } = await getViewer();
  const now = new Date().toISOString();
  const since = new Date(Date.parse(now) - days * 86_400_000).toISOString();
  const [{ site }, rows, events, assets, rates] = await Promise.all([repo.getSite(), repo.listWorkCosts({ since }), repo.listAssetStatusEvents(), repo.listAssets(), repo.listLaborRates()]);
  const today = todayAt(site.timezone);
  const report = siteCostReport(rows, events, assets, since, now);
  const cost = report.closedCost;
  const vs = report.hoursVsEstimate;
  const gaps = [cost.unratedHours ? `${cost.unratedHours} h with no rate` : null, cost.unpricedParts ? `${cost.unpricedParts} issued part${cost.unpricedParts === 1 ? "" : "s"} with no price` : null].filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Cost and downtime</h1>
          <p className="max-w-3xl text-sm text-tx-3">
            What the work at {site.name} cost and how long equipment was out of service. Every figure is added up from logged hours, issued parts and status changes.
          </p>
        </div>
        <nav aria-label="Period" className="flex gap-1 text-xs">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/costs?days=${p}`}
              aria-current={p === days ? "page" : undefined}
              className={cn("rounded-[3px] border px-2.5 py-1.5", p === days ? "border-brass/60 bg-brass/10 text-brass-bright" : "border-line text-tx-2 hover:border-line-strong")}
            >
              {p === 365 ? "12 months" : `${p} days`}
            </Link>
          ))}
        </nav>
      </div>

      <Panel>
        <StatGrid className="border-b-0 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Work closed" value={String(report.closed.length)} note={`${cost.laborHours} h logged`} />
          <Stat label="Labor" value={formatMoney(cost.laborCost)} note="Hours at each craft's rate" />
          <Stat label="Parts" value={formatMoney(cost.partsCost)} note="At the price when issued" />
          <Stat label="Total" value={formatMoney(cost.total)} note={report.openCost.total > 0 ? `${formatMoney(report.openCost.total)} more on open work` : "Closed work"} />
          <Stat
            label="Unplanned downtime"
            value={formatDuration(report.unplannedHours)}
            note={`${report.outages} outage${report.outages === 1 ? "" : "s"}, ${formatDuration(report.plannedHours)} planned`}
            tone={report.unplannedHours > 0 ? "bad" : undefined}
          />
          <Stat
            label="Hours vs estimate"
            value={vs ? `${vs.ratio >= 1 ? "+" : "−"}${Math.abs(Math.round((vs.ratio - 1) * 100))}%` : "—"}
            note={vs ? `${vs.logged} h logged, ${vs.estimated} h planned` : "No closed work with both"}
            tone={vs && vs.ratio > 1.15 ? "warn" : undefined}
          />
        </StatGrid>
        {gaps.length > 0 && <p className="border-t border-line px-4 py-2 text-xs text-warn">The cost is understated: {gaps.join(", ")}.</p>}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader eyebrow="Closed work" title="By type" />
          {report.byType.length === 0 ? (
            <EmptyState>Nothing closed in this period.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th className="w-12 text-right">Jobs</Th>
                  <Th className="w-24 text-right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {report.byType.map((t) => (
                  <tr key={t.type}>
                    <Td className="capitalize">{t.type}</Td>
                    <Td className="text-right font-mono text-xs">{t.count}</Td>
                    <Td className="text-right font-mono text-xs">{formatMoney(t.cost.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel>
          <PanelHeader eyebrow="Closed work" title="Most spent on" />
          {report.topCost.length === 0 ? (
            <EmptyState>No costed work on an asset in this period.</EmptyState>
          ) : (
            <ul className="divide-y divide-line/60">
              {report.topCost.map((a) => (
                <li key={a.asset.id}>
                  <Link href={`/assets/${a.asset.id}`} className="flex items-baseline gap-3 px-4 py-2 hover:bg-panel-2">
                    <span className="min-w-0 flex-1">
                      <Mono className="block truncate text-xs">{a.asset.floc}</Mono>
                      <span className="block truncate text-sm">{a.asset.name}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-sm">{formatMoney(a.cost.total)}</span>
                      <span className="block text-xs text-tx-3">
                        {a.count} job{a.count === 1 ? "" : "s"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader eyebrow="Status history" title="Most downtime" />
          {report.topDowntime.length === 0 ? (
            <EmptyState>Nothing was recorded down in this period.</EmptyState>
          ) : (
            <ul className="divide-y divide-line/60">
              {report.topDowntime.map((a) => (
                <li key={a.asset.id}>
                  <Link href={`/assets/${a.asset.id}`} className="flex items-baseline gap-3 px-4 py-2 hover:bg-panel-2">
                    <span className="min-w-0 flex-1">
                      <Mono className="block truncate text-xs">{a.asset.floc}</Mono>
                      <span className="block truncate text-sm">{a.asset.name}</span>
                    </span>
                    <span className="text-right">
                      <span className={cn("block font-mono text-sm", a.summary.unplannedHours > 0 && "text-bad")}>{formatDuration(a.summary.unplannedHours)}</span>
                      <span className="block text-xs text-tx-3">{a.summary.plannedHours > 0 ? `+ ${formatDuration(a.summary.plannedHours)} planned` : "unplanned"}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader eyebrow={`${report.closed.length} closed`} title="Work closed in the period" />
        {report.closed.length === 0 ? (
          <EmptyState>Nothing closed in this period.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="min-w-64">Work order</Th>
                <Th className="w-24">Closed</Th>
                <Th className="w-28 text-right">Hours (est.)</Th>
                <Th className="w-24 text-right">Labor</Th>
                <Th className="w-24 text-right">Parts</Th>
                <Th className="w-24 text-right">Total</Th>
                <Th className="w-24 text-right">Downtime</Th>
              </tr>
            </thead>
            <tbody>
              {report.closed.map(({ row, cost: c, downtimeHours }) => (
                <tr key={row.id} className="hover:bg-panel-2">
                  <Td>
                    <Link href={`/work-orders/${row.id}`} className="block hover:text-brass-bright">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <Mono className="whitespace-nowrap text-xs">{row.wo_number}</Mono>
                        <TypeLabel type={row.wo_type} />
                        {row.asset && <span className="font-mono text-xs text-tx-3">{row.asset.floc}</span>}
                      </span>
                      <span className="text-sm">{row.title}</span>
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-tx-2">{formatDay(row.closed_at)}</Td>
                  <Td className="whitespace-nowrap text-right font-mono text-xs">
                    {c.laborHours}
                    <span className="text-tx-3"> ({row.estimated_hours ?? "—"})</span>
                  </Td>
                  <Td className="text-right font-mono text-xs text-tx-2">{c.unratedHours ? <span className="text-warn">{formatMoney(c.laborCost)}*</span> : formatMoney(c.laborCost)}</Td>
                  <Td className="text-right font-mono text-xs text-tx-2">{c.unpricedParts ? <span className="text-warn">{formatMoney(c.partsCost)}*</span> : formatMoney(c.partsCost)}</Td>
                  <Td className="text-right font-mono text-xs">{formatMoney(c.total)}</Td>
                  <Td className={cn("text-right font-mono text-xs", downtimeHours > 0 ? (row.wo_type === "preventive" || row.wo_type === "project" ? "text-tx-2" : "text-bad") : "text-tx-3")}>
                    {downtimeHours > 0 ? formatDuration(downtimeHours) : "None"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {gaps.length > 0 && <p className="border-t border-line px-4 py-2 text-xs text-tx-3">* Understated: hours with no rate, or a part with no price.</p>}
      </Panel>

      <Panel>
        <PanelHeader eyebrow="What an hour costs" title="Labor rates" actions={<span className="text-xs text-tx-3">A new rate applies to hours worked from its date on</span>} />
        <Table>
          <thead>
            <tr>
              <Th>Craft</Th>
              <Th className="w-32 text-right">Rate today</Th>
              <Th className="w-32">Since</Th>
              <Th>Before that</Th>
            </tr>
          </thead>
          <tbody>
            {CRAFTS.map((craft) => {
              const current = rateInEffect(rates, craft, today);
              const earlier = rates.filter((r) => r.craft === craft && r.id !== current?.id && r.effective_from <= today);
              const upcoming = rates.filter((r) => r.craft === craft && r.effective_from > today);
              return (
                <tr key={craft}>
                  <Td>{CRAFT_LABELS[craft]}</Td>
                  <Td className="text-right font-mono text-sm">{current ? formatRate(current.hourly_rate) : <span className="text-warn">No rate</span>}</Td>
                  <Td className="text-xs text-tx-2">{current ? formatDay(current.effective_from) : "—"}</Td>
                  <Td className="text-xs text-tx-3">
                    {earlier.map((r) => `${formatRate(r.hourly_rate)} from ${formatDay(r.effective_from)}`).join(" · ") || "—"}
                    {upcoming.map((r) => (
                      <span key={r.id} className="text-info">
                        {" "}
                        · {formatRate(r.hourly_rate)} from {formatDay(r.effective_from)}
                      </span>
                    ))}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {canCost("set_rate", profile.role) ? <RateForm today={today} /> : <p className="border-t border-line px-4 py-2 text-xs text-tx-3">An admin sets labor rates.</p>}
      </Panel>
    </div>
  );
}
