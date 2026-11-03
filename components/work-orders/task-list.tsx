"use client";

import { Fragment, useOptimistic, useTransition } from "react";
import { CheckSquare, ShieldAlert, Square } from "lucide-react";
import { completeTask } from "@/lib/actions";
import { addDays } from "@/lib/pm/program";
import { cn, formatDay, formatHours } from "@/lib/utils";
import { CRAFT_LABELS, type WoTask } from "@/types/domain";

/** Job steps. In execution, technicians tick steps off (big targets for gloves on a tablet). */
export function TaskList({
  woId,
  tasks,
  canComplete,
  scheduledDate = null,
}: {
  woId: string;
  tasks: WoTask[];
  canComplete: boolean;
  /** Day 1 of a multi-day WCE; later days are labeled with their dates. */
  scheduledDate?: string | null;
}) {
  const multiDay = tasks.some((t) => t.day > 1);
  const [pending, startTransition] = useTransition();
  const [optimistic, markDone] = useOptimistic(tasks, (state, taskId: string) =>
    state.map((t) => (t.id === taskId ? { ...t, is_complete: true } : t)),
  );

  return (
    <ol className="divide-y divide-line/60">
      {optimistic.map((t, i) => (
        <Fragment key={t.id}>
        {multiDay && t.day !== optimistic[i - 1]?.day && (
          <li className="bg-panel-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-brass-dim">
            Day {t.day}
            {scheduledDate && ` · ${formatDay(addDays(scheduledDate, t.day - 1))}`}
          </li>
        )}
        <li className={cn("flex gap-3 px-4 py-3", t.is_complete && "opacity-60")}>
          {canComplete && !t.is_complete ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  markDone(t.id);
                  await completeTask(woId, t.id);
                })
              }
              className="-m-2 flex size-11 shrink-0 items-center justify-center text-tx-2 hover:text-brass"
              aria-label={`Mark step ${t.seq} complete`}
            >
              <Square className="size-6" aria-hidden />
            </button>
          ) : t.is_complete ? (
            <CheckSquare className="mt-0.5 size-5 shrink-0 text-good" aria-label="Complete" />
          ) : (
            <span className="w-7 shrink-0 pt-0.5 font-mono text-xs text-tx-3">{t.seq}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className={cn("leading-snug", t.is_complete && "line-through decoration-tx-3")}>{t.description}</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-tx-3">
              <span>{CRAFT_LABELS[t.craft]}</span>
              <span>
                {t.crew_size} × {formatHours(t.est_hours)}
              </span>
              {t.acceptance_criteria && <span className="text-tx-2">Accept: {t.acceptance_criteria}</span>}
            </div>
            {t.safety_note && (
              <p className="mt-1 flex items-start gap-1 text-xs text-warn">
                <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden /> {t.safety_note}
              </p>
            )}
          </div>
        </li>
        </Fragment>
      ))}
    </ol>
  );
}
