import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { PriorityBadge, StageBadge, StockBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { EmptyState, Mono, Panel, PanelHeader } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { computeMetrics } from "@/lib/metrics";
import { cn, formatHours } from "@/lib/utils";
import { ACTION_RULES, availableActions } from "@/lib/workflow";
import { ROLE_LABELS, STAGE_LABELS, WO_STAGES } from "@/types/domain";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { profile, repo } = await getViewer();
  const [workOrders, inventory] = await Promise.all([repo.listWorkOrders(), repo.listInventory()]);
  const m = computeMetrics(workOrders, inventory);

  const mine = workOrders
    .map((w) => ({ wo: w, actions: availableActions(profile.role, w) }))
    .filter(({ wo, actions }) => {
      if (actions.length === 0) return false;
      // Technicians see their own jobs, not every job in execution.
      if (profile.role === "technician") return wo.assigned_to === profile.id;
      return true;
    });

  const maxStage = Math.max(1, ...Object.values(m.stageCounts));

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-brass-dim">{ROLE_LABELS[profile.role]} view</p>
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Good shift, {profile.full_name.split(" ")[0]}</h1>
        </div>
        {(profile.role === "planner" || profile.role === "admin") && m.stageCounts.planning > 0 && (
          <Button asChild variant="primary">
            <Link href="/planning">
              <Sparkles aria-hidden /> {m.stageCounts.planning} waiting in Planning
            </Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Open work orders" value={String(m.openCount)} note={m.emergencyOpen ? `${m.emergencyOpen} emergency` : "No emergencies"} tone={m.emergencyOpen ? "bad" : "neutral"} />
        <Kpi label="Ready backlog" value={formatHours(m.readyBacklogHours)} note="Planned, awaiting crew" />
        <Kpi label="Planning queue" value={String(m.stageCounts.planning)} note="Authorized, not yet planned" tone={m.stageCounts.planning > 3 ? "warn" : "neutral"} />
        <Kpi label="Proactive share" value={`${m.proactivePct}%`} note="PM + PdM of open work" />
        <Kpi
          label="Estimate accuracy"
          value={m.estimateRatio ? `${Math.round(m.estimateRatio * 100)}%` : "—"}
          note={`Actual vs planned, ${m.estimateSample} closed`}
          tone={m.estimateRatio && m.estimateRatio > 1.15 ? "warn" : "neutral"}
        />
      </div>

      <Panel>
        <PanelHeader eyebrow="Lifecycle" title="Open work by stage" />
        <div className="grid grid-cols-3 gap-px bg-line sm:grid-cols-6">
          {WO_STAGES.map((stage) => (
            <Link
              key={stage}
              href={`/work-orders?stage=${stage}`}
              className="group flex flex-col gap-2 bg-panel px-3 py-3 hover:bg-panel-2"
            >
              <span className="text-[11px] uppercase tracking-wider text-tx-3 group-hover:text-tx-2">{STAGE_LABELS[stage]}</span>
              <span className={cn("font-display text-3xl font-semibold", stage === "planning" && "text-brass-bright")}>
                {m.stageCounts[stage]}
              </span>
              <span className="h-1 rounded-full bg-panel-3">
                <span
                  className={cn("block h-1 rounded-full", stage === "planning" ? "bg-brass" : "bg-steel")}
                  style={{ width: `${(m.stageCounts[stage] / maxStage) * 100}%` }}
                />
              </span>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Panel>
          <PanelHeader eyebrow="Your queue" title="Waiting on you" actions={<span className="font-mono text-xs text-tx-3">{mine.length}</span>} />
          {mine.length === 0 ? (
            <EmptyState>Nothing needs a {ROLE_LABELS[profile.role].toLowerCase()} right now. Switch roles from the top bar to see another view.</EmptyState>
          ) : (
            <ul className="divide-y divide-line/60">
              {mine.slice(0, 10).map(({ wo, actions }) => (
                <li key={wo.id}>
                  <Link href={actions.includes("plan") ? `/planning/${wo.id}` : `/work-orders/${wo.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-panel-2">
                    <Mono className="w-24 shrink-0">{wo.wo_number}</Mono>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{wo.title}</div>
                      <div className="truncate font-mono text-[11px] text-tx-3">{wo.asset?.floc ?? "No asset"}</div>
                    </div>
                    <PriorityBadge priority={wo.priority} compact />
                    <StageBadge stage={wo.stage} status={wo.status} />
                    <span className="hidden w-36 shrink-0 text-right text-xs text-brass sm:block">
                      {ACTION_RULES[actions[0]].label} <ArrowRight className="inline size-3" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader eyebrow="Storeroom" title="Below minimum" actions={<Link href="/inventory" className="text-xs text-brass hover:text-brass-bright">All stock</Link>} />
          {m.lowStock.length === 0 ? (
            <EmptyState>All stocked items are at or above minimum.</EmptyState>
          ) : (
            <ul className="divide-y divide-line/60">
              {m.lowStock.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <Mono className="text-xs">{i.part.part_number}</Mono>
                    <div className="truncate text-xs text-tx-2">{i.part.description}</div>
                  </div>
                  <StockBadge available={i.on_hand - i.reserved} min={i.min_qty} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Kpi({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: "neutral" | "warn" | "bad" }) {
  return (
    <div className="rounded-[3px] border border-line bg-panel px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-wider text-tx-3">{label}</div>
      <div className={cn("mt-1 font-display text-3xl font-semibold leading-none", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>{value}</div>
      <div className="mt-1.5 truncate text-xs text-tx-3">{note}</div>
    </div>
  );
}
