import Link from "next/link";
import { ArrowRight, BookOpen, History, Package, Sparkles } from "lucide-react";
import { CriticalityBadge, PriorityBadge } from "@/components/status";
import { EmptyState, Mono, Panel, PanelHeader } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { hasClaude } from "@/lib/config";
import { daysSince } from "@/lib/utils";

export const metadata = { title: "Planning" };

export default async function PlanningQueuePage() {
  const { profile, repo } = await getViewer();
  const queue = await repo.listWorkOrders({ stage: "planning", status: "open" });
  const isPlanner = profile.role === "planner" || profile.role === "admin";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-brass-dim">Stage 3</p>
        <h1 className="flex items-center gap-2 font-display text-3xl font-semibold uppercase tracking-wide">
          <Sparkles className="size-6 text-brass" aria-hidden /> Planning Mode
        </h1>
        <p className="mt-2 max-w-3xl text-tx-2">
          Pick an authorized work order and build its job plan with {hasClaude() ? "Claude" : "the planning assistant"}. Every plan is
          grounded in three layers of context, and nothing is committed until you commit it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Layer icon={BookOpen} n="1" title="Universal standards" body="Energy control, electrical safety, permits, planning and rotating-equipment practice." />
        <Layer icon={BookOpen} n="2" title="Industrial and utility" body="Redundancy, compliance analyzers, chemical feed, steam, cooling towers, standby power." />
        <Layer icon={History} n="3" title="This plant" body="The asset, its sister units, closed work and debriefs, and live storeroom stock." extra={<Package className="size-4 text-tx-3" aria-hidden />} />
      </div>

      {!isPlanner && (
        <p className="rounded-[3px] border border-line-strong bg-panel px-3 py-2 text-sm text-tx-2">
          You&apos;re viewing as a {profile.role}. Planning Mode is for planners. Switch to Marcus Reyes (Planner) in the top bar to try it.
        </p>
      )}

      <Panel>
        <PanelHeader eyebrow="Authorized, awaiting a plan" title="Planning queue" actions={<span className="font-mono text-xs text-tx-3">{queue.length}</span>} />
        {queue.length === 0 ? (
          <EmptyState>The queue is empty. Authorize a work order in Vetting to send it here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line/60">
            {queue.map((wo) => (
              <li key={wo.id}>
                <Link
                  href={isPlanner ? `/planning/${wo.id}` : `/work-orders/${wo.id}`}
                  className="group flex flex-col gap-2 px-4 py-3 hover:bg-panel-2 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Mono>{wo.wo_number}</Mono>
                      <PriorityBadge priority={wo.priority} compact />
                      {wo.asset && <CriticalityBadge criticality={wo.asset.criticality} />}
                      {wo.requires_shutdown && <span className="text-[11px] text-warn">Shutdown</span>}
                    </div>
                    <div className="mt-1 font-medium group-hover:text-brass-bright">{wo.title}</div>
                    <div className="mt-0.5 line-clamp-1 text-xs text-tx-3">
                      <span className="font-mono">{wo.asset?.floc}</span> · {wo.description}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-tx-3">
                    <span>{daysSince(wo.created_at)} d in queue</span>
                    {isPlanner && (
                      <span className="inline-flex items-center gap-1 font-medium text-brass group-hover:text-brass-bright">
                        Plan it <ArrowRight className="size-3" aria-hidden />
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Layer({ icon: Icon, n, title, body, extra }: { icon: typeof BookOpen; n: string; title: string; body: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-[3px] border border-line bg-panel px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-brass">L{n}</span>
        <Icon className="size-4 text-tx-3" aria-hidden />
        {extra}
      </div>
      <div className="mt-1.5 font-display text-base font-semibold uppercase tracking-wide">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-tx-3">{body}</p>
    </div>
  );
}
