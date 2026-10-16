import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, WO_STAGES, type WoStage, type WoStatus } from "@/types/domain";

export function LifecycleStepper({ stage, status }: { stage: WoStage; status: WoStatus }) {
  const current = WO_STAGES.indexOf(stage);
  return (
    <ol className="grid grid-cols-6 gap-px overflow-hidden rounded-[3px] border border-line bg-line" aria-label="Work order lifecycle">
      {WO_STAGES.map((s, i) => {
        const done = i < current || status === "closed";
        const active = i === current && status === "open";
        const stopped = i === current && status === "rejected";
        return (
          <li
            key={s}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5 px-2 py-2 text-[11px] font-medium uppercase tracking-wide sm:text-xs",
              done && "bg-panel text-good",
              active && "bg-brass/15 text-brass-bright shadow-[inset_0_-2px_0_var(--brass)]",
              stopped && "bg-bad/10 text-bad",
              !done && !active && !stopped && "bg-panel text-tx-3",
            )}
          >
            {done ? <Check className="size-3.5 shrink-0" aria-hidden /> : <span className="font-mono text-[10px]">{i + 1}</span>}
            <span className="truncate">{STAGE_LABELS[s]}</span>
          </li>
        );
      })}
    </ol>
  );
}
