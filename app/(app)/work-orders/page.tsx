import Link from "next/link";
import { CriticalityBadge, PriorityBadge, StageBadge, TypeLabel } from "@/components/status";
import { Button } from "@/components/ui/button";
import { EmptyState, Mono, Panel, Table, Td, Th } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { cn, daysSince, formatDate, formatHours } from "@/lib/utils";
import { STAGE_LABELS, WO_STAGES, type WoStage } from "@/types/domain";

export const metadata = { title: "Work orders" };

type Filter = WoStage | "open" | "closed" | "all";

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const { stage } = await searchParams;
  const filter: Filter = (WO_STAGES as readonly string[]).includes(stage ?? "")
    ? (stage as WoStage)
    : stage === "closed" || stage === "all"
      ? stage
      : "open";

  const { repo } = await getViewer();
  const all = await repo.listWorkOrders();
  const rows = all.filter((w) =>
    filter === "all"
      ? true
      : filter === "closed"
        ? w.status !== "open"
        : filter === "open"
          ? w.status === "open"
          : w.status === "open" && w.stage === filter,
  );

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: "open", label: "All open", count: all.filter((w) => w.status === "open").length },
    ...WO_STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s], count: all.filter((w) => w.status === "open" && w.stage === s).length })),
    { key: "closed", label: "Closed / rejected", count: all.filter((w) => w.status !== "open").length },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Work orders</h1>
        <Button asChild variant="primary" size="sm">
          <Link href="/work-orders/new">Report a problem</Link>
        </Button>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "open" ? "/work-orders" : `/work-orders?stage=${t.key}`}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
              filter === t.key ? "border-brass text-tx" : "border-transparent text-tx-3 hover:text-tx-2",
            )}
          >
            {t.label}
            <span className="font-mono text-[11px] text-tx-3">{t.count}</span>
          </Link>
        ))}
      </nav>

      <Panel>
        {rows.length === 0 ? (
          <EmptyState>No work orders here.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-28">WO</Th>
                <Th>Title</Th>
                <Th>Asset</Th>
                <Th>Priority</Th>
                <Th>Stage</Th>
                <Th className="text-right">Est.</Th>
                <Th>Assigned</Th>
                <Th className="text-right">Age / date</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="hover:bg-panel-2">
                  <Td>
                    <Link href={`/work-orders/${w.id}`} className="hover:underline">
                      <Mono>{w.wo_number}</Mono>
                    </Link>
                  </Td>
                  <Td className="min-w-64">
                    <Link href={`/work-orders/${w.id}`} className="font-medium hover:text-brass-bright">
                      {w.title}
                    </Link>
                    <div className="flex items-center gap-2">
                      <TypeLabel type={w.wo_type} />
                      {w.requires_shutdown && <span className="text-[11px] text-warn">Shutdown</span>}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {w.asset ? (
                      <div className="flex items-center gap-2">
                        <Link href={`/assets/${w.asset.id}`} className="font-mono text-xs text-tx-2 hover:text-tx">
                          {w.asset.floc}
                        </Link>
                        <CriticalityBadge criticality={w.asset.criticality} />
                      </div>
                    ) : (
                      <span className="text-tx-3">—</span>
                    )}
                  </Td>
                  <Td>
                    <PriorityBadge priority={w.priority} compact />
                  </Td>
                  <Td>
                    <StageBadge stage={w.stage} status={w.status} />
                  </Td>
                  <Td className="text-right font-mono text-xs">{formatHours(w.estimated_hours)}</Td>
                  <Td className="whitespace-nowrap text-xs text-tx-2">{w.assignee_name ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-right text-xs text-tx-3">
                    {w.status === "open" ? (w.scheduled_date ? formatDate(w.scheduled_date) : `${daysSince(w.created_at)} d`) : formatDate(w.closed_at ?? w.updated_at)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
