import Link from "next/link";
import { Stat, StatGrid } from "@/components/costs/stat";
import { TypeLabel } from "@/components/status";
import { EmptyState, Mono, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/primitives";
import { costOfRow, costShareOfReplacement, formatMoney, sumCosts } from "@/lib/cost";
import { downtime, formatDuration } from "@/lib/downtime";
import { formatDay } from "@/lib/utils";
import type { AssetStatusEventItem, WoCostRow } from "@/types/domain";

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

/**
 * What an asset has cost and how long it was down over the last twelve
 * months. Every figure is computed here from the logged hours, issued parts
 * and status history.
 */
export function CostDowntimePanel({ rows, events, replacementValue, now }: { rows: WoCostRow[]; events: AssetStatusEventItem[]; replacementValue: number | null; now: string }) {
  const since = new Date(Date.parse(now) - 365 * 86_400_000).toISOString();
  const inWindow = rows.filter((r) => (r.closed_at ?? now) >= since);
  const cost = sumCosts(inWindow);
  const dt = downtime(events, since, now);
  const share = costShareOfReplacement(cost.total, replacementValue, 365);
  const costed = inWindow.filter((r) => r.labor.length > 0 || r.parts.some((p) => p.status === "issued"));
  const gaps = [cost.unratedHours ? `${cost.unratedHours} h with no rate` : null, cost.unpricedParts ? `${cost.unpricedParts} part${cost.unpricedParts === 1 ? "" : "s"} with no price` : null].filter(Boolean);

  return (
    <Panel>
      <PanelHeader eyebrow="Last 12 months" title="Cost and downtime" actions={<span className="font-mono text-sm text-brass-bright">{formatMoney(cost.total)}</span>} />
      <StatGrid className="sm:grid-cols-3">
        <Stat label="Maintenance cost" value={formatMoney(cost.total)} note={`${formatMoney(cost.laborCost)} labor, ${formatMoney(cost.partsCost)} parts`} />
        <Stat
          label="Of replacement value"
          value={share === null ? "—" : pct(share)}
          note={share === null ? "No replacement value recorded" : `Against ${formatMoney(replacementValue)}`}
          tone={share !== null && share > 0.1 ? "warn" : undefined}
        />
        <Stat label="Work orders" value={String(inWindow.length)} note={`${cost.laborHours} h logged`} />
        <Stat label="Unplanned downtime" value={formatDuration(dt.unplannedHours)} note={`${dt.downEvents} outage${dt.downEvents === 1 ? "" : "s"} in the period`} tone={dt.unplannedHours > 0 ? "bad" : undefined} />
        <Stat label="Planned downtime" value={formatDuration(dt.plannedHours)} note="For preventive or project work" />
        <Stat
          label="Availability"
          value={dt.availability === null ? "—" : pct(dt.availability, 2)}
          note={dt.availability === null ? "No status history" : `Over ${formatDuration(dt.knownHours)} of known history`}
        />
      </StatGrid>
      {gaps.length > 0 && <p className="border-b border-line px-4 py-2 text-xs text-warn">The cost is understated: {gaps.join(", ")}.</p>}
      {costed.length === 0 ? (
        <EmptyState>No hours or parts were logged on this asset in the last 12 months.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Work order</Th>
              <Th className="w-24">Closed</Th>
              <Th className="w-16 text-right">Hours</Th>
              <Th className="w-24 text-right">Labor</Th>
              <Th className="w-24 text-right">Parts</Th>
              <Th className="w-24 text-right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {costed.map((r) => {
              const c = costOfRow(r);
              return (
                <tr key={r.id} className="hover:bg-panel-2">
                  <Td>
                    <Link href={`/work-orders/${r.id}`} className="block hover:text-brass-bright">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <Mono className="whitespace-nowrap text-xs">{r.wo_number}</Mono>
                        <TypeLabel type={r.wo_type} />
                      </span>
                      <span className="text-sm">{r.title}</span>
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-tx-2">{r.closed_at ? formatDay(r.closed_at) : "Open"}</Td>
                  <Td className="text-right font-mono text-xs">{c.laborHours}</Td>
                  <Td className="text-right font-mono text-xs text-tx-2">{formatMoney(c.laborCost)}</Td>
                  <Td className="text-right font-mono text-xs text-tx-2">{formatMoney(c.partsCost)}</Td>
                  <Td className="text-right font-mono text-xs">{formatMoney(c.total)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
