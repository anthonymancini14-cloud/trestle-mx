import Link from "next/link";
import { AddWceForm } from "@/components/work-orders/add-wce-form";
import { StageBadge } from "@/components/status";
import { Mono, Panel, PanelHeader } from "@/components/ui/primitives";
import { cn, formatDay } from "@/lib/utils";
import type { WorkOrderListItem } from "@/types/domain";

/**
 * Every WCE on the job's JCN: each shop's work runs its own lifecycle; -001 is
 * the primary shop's and closes last with the corrective action summary.
 */
export function JobPanel({ jcn, job, currentId, canAdd }: { jcn: string; job: WorkOrderListItem[]; currentId: string; canAdd: boolean }) {
  const open = job.filter((w) => w.status === "open").length;
  return (
    <Panel>
      <PanelHeader
        eyebrow={`JCN ${jcn}`}
        title={job.length === 1 ? "Work center events" : `${job.length} work center events`}
        actions={<span className="text-xs text-tx-3">{open === 0 ? "All closed" : `${open} open`}</span>}
      />
      <ol className="divide-y divide-line/60">
        {job.map((w) => (
          <li key={w.id} className={cn("px-4 py-2.5", w.id === currentId && "bg-brass/[0.05]")}>
            <Link href={`/work-orders/${w.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Mono className="text-xs">{w.wo_number}</Mono>
              <StageBadge stage={w.stage} status={w.status} />
              <span className="min-w-0 flex-1 truncate text-sm">{w.title}</span>
              <span className="text-xs text-tx-3">
                {w.scheduled_date ? formatDay(w.scheduled_date) : "No date"}
                {w.assignee_name && ` · ${w.assignee_name}`}
              </span>
            </Link>
            {w.deferred_to_jcn && <p className="mt-0.5 text-xs text-warn">Corrective action deferred, see JCN {w.deferred_to_jcn}</p>}
          </li>
        ))}
      </ol>
      {canAdd && <AddWceForm jcn={jcn} />}
    </Panel>
  );
}
