import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { CableRoutePanel } from "@/components/assets/cable-panels";
import { LifecycleStepper } from "@/components/work-orders/lifecycle-stepper";
import { PartsTable } from "@/components/work-orders/parts-table";
import { TaskList } from "@/components/work-orders/task-list";
import { WoActions } from "@/components/work-orders/wo-actions";
import { CriticalityBadge, PriorityBadge, StageBadge, TypeLabel } from "@/components/status";
import { EmptyState, Mono, Panel, PanelHeader } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { formatDate, formatDateTime, formatHours } from "@/lib/utils";
import { availableActions, canAddWce, canDefer, canRecord, primaryCloseBlocker } from "@/lib/workflow";
import { currentResolution, DEFAULT_REPEAT_WINDOW_DAYS, EVIDENCE_TYPES, evidenceBlocker, repeatCheck, type RepeatCheck } from "@/lib/troubleshooting";
import { TroubleshootingPanel } from "@/components/work-orders/troubleshooting-panel";
import { daysBetween } from "@/lib/pm/program";
import { JobPanel } from "@/components/work-orders/job-panel";

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, repo } = await getViewer();
  const [wo, profiles, { site }] = await Promise.all([repo.getWorkOrder(id), repo.listProfiles(), repo.getSite()]);
  if (!wo) notFound();
  // Cable work: show the route so the crew knows which tray sections to work in.
  const asset = wo.asset ? await repo.getAsset(wo.asset.id) : null;
  const cableRoute = asset?.asset_class?.code === "CABLE" ? asset : null;
  const pmSource = wo.pm_schedule_id && wo.asset ? (await repo.listPmSchedules({ assetId: wo.asset.id })).find((s) => s.id === wo.pm_schedule_id) : undefined;
  const job = await repo.listJcn(wo.jcn);
  const primary = job.find((w) => w.wce_seq === 1) ?? wo;
  const deferredFrom = wo.deferred_from_wo_id ? await repo.getWorkOrder(wo.deferred_from_wo_id) : null;
  const deferredTo = wo.deferred_to_jcn ? (await repo.listJcn(wo.deferred_to_jcn)).find((w) => w.wce_seq === 1) : undefined;
  const [record, codes, assetHistory] = await Promise.all([
    repo.getTroubleshooting(wo.id),
    repo.listFailureCodes(),
    wo.asset ? repo.listResolutions({ assetId: wo.asset.id }) : Promise.resolve([]),
  ]);
  const evidence = evidenceBlocker(wo, record.resolutions);
  const evidenceApplies = wo.wce_seq === 1 && EVIDENCE_TYPES.includes(wo.wo_type) && !wo.deferred_to_jcn;
  const closeBlocker = primaryCloseBlocker(wo, job) ?? evidence;
  const assetClass = asset?.asset_class ?? null;
  const windowDays = assetClass ? assetClass.repeat_window_days : DEFAULT_REPEAT_WINDOW_DAYS;
  const repeat = repeatCheck(wo, assetHistory, windowDays, currentResolution(record.resolutions));
  const modes = (assetClass?.failure_modes ?? []).map((m) => ({ code: m.code, name: m.name }));

  const actions = availableActions(profile.role, wo, { schedulerRoles: site.scheduler_roles });
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
          <span className="text-[11px] uppercase tracking-wider text-tx-3">JCN</span>
          <Mono className="text-sm">{wo.jcn}</Mono>
          <span className="text-[11px] uppercase tracking-wider text-tx-3">WCE</span>
          <Mono className="text-sm">{String(wo.wce_seq).padStart(3, "0")}</Mono>
          {wo.wce_seq === 1 && <span className="text-[11px] text-tx-3">(primary)</span>}
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

      {deferredTo && (
        <div className="rounded-[3px] border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          Corrective action deferred, see JCN{" "}
          <Link href={`/work-orders/${deferredTo.id}`} className="font-mono underline">
            {deferredTo.jcn}
          </Link>
          .
        </div>
      )}
      {deferredFrom && (
        <div className="rounded-[3px] border border-line-strong bg-panel-2 px-3 py-2 text-sm text-tx-2">
          Written up from deferred WCE{" "}
          <Link href={`/work-orders/${deferredFrom.id}`} className="font-mono text-brass-bright underline">
            {deferredFrom.wo_number}
          </Link>{" "}
          ({deferredFrom.title}).
        </div>
      )}

      {wo.requires_shutdown && wo.status === "open" && (
        <div className="hazard-stripe flex items-center gap-2 rounded-[3px] border border-warn/40 px-3 py-2 text-sm text-warn">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Requires the equipment out of service. Coordinate the window with operations.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader eyebrow={pmSource ? "Preventive maintenance" : "Discrepancy"} title={pmSource ? "From the PM program" : "Reported problem"} />
            <p className="whitespace-pre-line px-4 py-3 leading-relaxed text-tx-2">{wo.description}</p>
            {pmSource && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-tx-3">
                <Link href="/pm?show=all" className="font-mono text-brass-bright hover:underline">
                  {pmSource.task.code}
                </Link>
                <span>Every {pmSource.interval_days} days</span>
                <span>
                  Addresses <span className="font-mono text-tx-2">{pmSource.task.failure_mode_codes.join(" ")}</span>
                </span>
                <span>Due {formatDate(pmSource.next_due_on)}</span>
                {pmSource.deferrals.length > 0 && <span className="text-warn">Deferred {pmSource.deferrals.length}×</span>}
              </div>
            )}
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

          {repeat && <RepeatPanel repeat={repeat} modes={modes} />}

          <TroubleshootingPanel
            woId={wo.id}
            record={record}
            modes={modes}
            mechanisms={codes.filter((c) => c.kind === "mechanism").map((c) => ({ code: c.code, name: c.name }))}
            causes={codes.filter((c) => c.kind === "cause").map((c) => ({ code: c.code, name: c.name }))}
            can={{
              action: canRecord("operator_action", profile.role, wo),
              finding: canRecord("finding", profile.role, wo),
              resolution: canRecord("resolution", profile.role, wo),
              addendum: canRecord("addendum", profile.role, wo, profile.id),
            }}
            evidence={evidenceApplies && wo.status === "open" && (wo.stage === "execution" || wo.stage === "closure") ? (evidence ?? "") : null}
          />

          <JobPanel jcn={wo.jcn} job={job} currentId={wo.id} canAdd={canAddWce(profile.role, primary)} />

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
              <TaskList woId={wo.id} tasks={wo.tasks} canComplete={actions.includes("complete_task")} scheduledDate={wo.scheduled_date} />
            )}
          </Panel>

          {cableRoute && <CableRoutePanel attributes={cableRoute.attributes} route={cableRoute.route} />}

          <Panel>
            <PanelHeader eyebrow="Materials" title="Parts" />
            {wo.parts.length === 0 ? (
              <EmptyState>No parts on this work order.</EmptyState>
            ) : (
              <PartsTable
                woId={wo.id}
                parts={wo.parts}
                canIssue={actions.includes("issue_part")}
                canSetEta={wo.status === "open" && ["storeroom", "planner", "admin"].includes(profile.role)}
              />
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
            isPrimary={wo.wce_seq === 1}
            closeBlocker={closeBlocker}
            canDefer={canDefer(profile.role, wo)}
          />

          <Panel>
            <PanelHeader title="Details" />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
              <dt className="text-tx-3">{wo.pm_schedule_id ? "Generated by" : "Reported by"}</dt>
              <dd>{nameOf(wo.reported_by)}</dd>
              <dt className="text-tx-3">Opened</dt>
              <dd>{formatDate(wo.created_at)}</dd>
              <dt className="text-tx-3">Planner</dt>
              <dd>{nameOf(wo.planner_id)}</dd>
              <dt className="text-tx-3">Scheduled</dt>
              <dd>
                {wo.scheduled_date ? (
                  <Link href={`/schedule?week=${wo.scheduled_date}`} className="hover:text-brass-bright hover:underline">
                    {formatDate(wo.scheduled_date)}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
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
                    <span className="font-medium text-tx">{e.actor_name ?? "System"}</span> {describeEvent(e.event_type, e.to_stage, !!wo.pm_schedule_id)}
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

function describeEvent(type: string, to: string | null, fromPm: boolean): string {
  switch (type) {
    case "created":
      return fromPm ? "generated it from the PM program" : "reported the discrepancy";
    case "plan_committed":
      return "committed the job plan";
    case "scheduled":
      return "scheduled the work";
    case "rescheduled":
      return "moved the scheduled date";
    case "closed":
      return "closed the WCE";
    case "task_completed":
      return "completed a step";
    case "part_issued":
      return "issued parts";
    case "rejected":
      return "rejected the work order";
    case "stage_change":
      return to ? `moved it to ${to}` : "changed the stage";
    default:
      return "added a note";
  }
}

/** Possible or confirmed repeat failure (TMX-008): put the prior fix in front of the gatekeeper and planner. */
function RepeatPanel({ repeat, modes }: { repeat: RepeatCheck; modes: { code: string; name: string }[] }) {
  const confirmed = repeat.sameMode.length > 0;
  return (
    <section aria-label="Repeat failure" className="rounded-[3px] border border-warn/50 bg-warn/[0.07]">
      <header className="flex items-center gap-2 border-b border-warn/30 px-4 py-2 text-sm text-warn">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <strong>{confirmed ? "Repeat failure" : "Possible repeat failure"}</strong>
        <span className="text-xs">
          {confirmed ? "Same failure mode on this asset" : "Corrective work on this asset closed"} within the {repeat.windowDays}-day window
        </span>
      </header>
      <ul className="divide-y divide-warn/20">
        {repeat.prior.map((p) => (
          <li key={p.id} className="space-y-0.5 px-4 py-2 text-sm">
            <Link href={`/work-orders/${p.wo.id}`} className="flex flex-wrap items-center gap-x-2">
              <span className="font-mono text-xs text-brass-bright">{p.wo.wo_number}</span>
              <span>{p.wo.title}</span>
              <span className="text-xs text-tx-3">closed {formatDate(p.wo.closed_at)}, {daysBetween(p.wo.closed_at!.slice(0, 10), new Date().toISOString().slice(0, 10))} days ago</span>
            </Link>
            <p className="text-xs text-tx-2">
              {p.failure_mode && <span className="font-mono">{p.failure_mode} {modes.find((m) => m.code === p.failure_mode)?.name} · </span>}
              {p.no_fault_found ? "No fault found. " : `Cause: ${p.cause_narrative} `}
              {p.remedy && `Fix: ${p.remedy}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
