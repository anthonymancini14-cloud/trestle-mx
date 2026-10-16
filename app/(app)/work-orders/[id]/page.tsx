import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { LifecycleStepper } from "@/components/work-orders/lifecycle-stepper";
import { PartsTable } from "@/components/work-orders/parts-table";
import { TaskList } from "@/components/work-orders/task-list";
import { WoActions } from "@/components/work-orders/wo-actions";
import { CriticalityBadge, PriorityBadge, StageBadge, TypeLabel } from "@/components/status";
import { EmptyState, Mono, Panel, PanelHeader } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { formatDate, formatDateTime, formatHours } from "@/lib/utils";
import { availableActions } from "@/lib/workflow";

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, repo } = await getViewer();
  const [wo, profiles] = await Promise.all([repo.getWorkOrder(id), repo.listProfiles()]);
  if (!wo) notFound();

  const actions = availableActions(profile.role, wo);
  const nameOf = (pid: string | null) => profiles.find((p) => p.id === pid)?.full_name ?? "—";
  const technicians = profiles.filter((p) => p.role === "technician");
  const crewHours = wo.tasks.reduce((s, t) => s + t.est_hours * t.crew_size, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/work-orders" className="inline-flex items-center gap-1 text-xs text-tx-3 hover:text-tx-2">
        <ArrowLeft className="size-3" aria-hidden /> Work orders
      </Link>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Mono className="text-sm">{wo.wo_number}</Mono>
          <StageBadge stage={wo.stage} status={wo.status} />
          <PriorityBadge priority={wo.priority} />
          <TypeLabel type={wo.wo_type} />
        </div>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-wide sm:text-4xl">{wo.title}</h1>
        {wo.asset && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/assets/${wo.asset.id}`} className="font-mono text-tx-2 hover:text-brass-bright">
              {wo.asset.floc}
            </Link>
            <span className="text-tx-3">{wo.asset.name}</span>
            <CriticalityBadge criticality={wo.asset.criticality} />
          </div>
        )}
      </header>

      <LifecycleStepper stage={wo.stage} status={wo.status} />

      {wo.requires_shutdown && wo.status === "open" && (
        <div className="hazard-stripe flex items-center gap-2 rounded-[3px] border border-warn/40 px-3 py-2 text-sm text-warn">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Requires the equipment out of service. Coordinate the window with operations.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader eyebrow="Discrepancy" title="Reported problem" />
            <p className="whitespace-pre-line px-4 py-3 leading-relaxed text-tx-2">{wo.description}</p>
            {wo.plan_summary && (
              <div className="border-t border-line px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-brass-dim">Plan summary</div>
                <p className="mt-1 leading-relaxed">{wo.plan_summary}</p>
              </div>
            )}
            {wo.debrief && (
              <div className="border-t border-line bg-good/5 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-good">After-action debrief</div>
                <p className="mt-1 leading-relaxed">{wo.debrief}</p>
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Job plan"
              title="Steps"
              actions={wo.tasks.length > 0 && <span className="font-mono text-xs text-tx-3">{formatHours(crewHours)} crew</span>}
            />
            {wo.tasks.length === 0 ? (
              <EmptyState>
                No plan yet.{" "}
                {actions.includes("plan") ? (
                  <Link href={`/planning/${wo.id}`} className="text-brass hover:text-brass-bright">
                    Build one in Planning Mode.
                  </Link>
                ) : (
                  "A planner builds it once the work order is authorized."
                )}
              </EmptyState>
            ) : (
              <TaskList woId={wo.id} tasks={wo.tasks} canComplete={actions.includes("complete_task")} />
            )}
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Materials" title="Parts" />
            {wo.parts.length === 0 ? (
              <EmptyState>No parts on this work order.</EmptyState>
            ) : (
              <PartsTable woId={wo.id} parts={wo.parts} canIssue={actions.includes("issue_part")} />
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <WoActions
            woId={wo.id}
            actions={actions}
            technicians={technicians}
            estimatedHours={wo.estimated_hours}
            openTasks={wo.tasks.filter((t) => !t.is_complete).length}
          />

          <Panel>
            <PanelHeader title="Details" />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
              <dt className="text-tx-3">Reported by</dt>
              <dd>{nameOf(wo.reported_by)}</dd>
              <dt className="text-tx-3">Opened</dt>
              <dd>{formatDate(wo.created_at)}</dd>
              <dt className="text-tx-3">Planner</dt>
              <dd>{nameOf(wo.planner_id)}</dd>
              <dt className="text-tx-3">Scheduled</dt>
              <dd>{formatDate(wo.scheduled_date)}</dd>
              <dt className="text-tx-3">Assigned</dt>
              <dd>{wo.assignee_name ?? "—"}</dd>
              <dt className="text-tx-3">Estimate</dt>
              <dd className="font-mono text-xs leading-5">{formatHours(wo.estimated_hours)}</dd>
              <dt className="text-tx-3">Actual</dt>
              <dd className="font-mono text-xs leading-5">{formatHours(wo.actual_hours)}</dd>
            </dl>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Audit log" title="Activity" />
            <ol className="max-h-96 space-y-3 overflow-y-auto px-4 py-3">
              {wo.events.map((e) => (
                <li key={e.id} className="border-l-2 border-line-strong pl-3 text-xs">
                  <div className="text-tx-2">
                    <span className="font-medium text-tx">{e.actor_name ?? "System"}</span> {describeEvent(e.event_type, e.to_stage)}
                  </div>
                  {e.note && <p className="mt-0.5 line-clamp-3 text-tx-3">{e.note}</p>}
                  <div className="mt-0.5 font-mono text-[10px] text-tx-3">{formatDateTime(e.created_at)}</div>
                </li>
              ))}
            </ol>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function describeEvent(type: string, to: string | null): string {
  switch (type) {
    case "created":
      return "reported the discrepancy";
    case "plan_committed":
      return "committed the job plan";
    case "scheduled":
      return "scheduled the work";
    case "task_completed":
      return "completed a step";
    case "part_issued":
      return "issued parts";
    case "rejected":
      return "rejected the work order";
    case "closed":
      return "closed the work order";
    case "stage_change":
      return to ? `moved it to ${to}` : "changed the stage";
    default:
      return "added a note";
  }
}
