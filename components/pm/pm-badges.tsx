import { Badge } from "@/components/ui/primitives";
import type { DueState } from "@/lib/pm/program";
import { cn } from "@/lib/utils";
import { PM_STRATEGY_LABELS, type PmStrategy } from "@/types/domain";

const DUE: Record<DueState, { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "border-bad/50 bg-bad/10 text-bad" },
  due: { label: "Due", cls: "border-warn/50 bg-warn/10 text-warn" },
  upcoming: { label: "Next 30 days", cls: "border-info/40 text-info" },
  current: { label: "Current", cls: "border-good/40 text-good" },
};

export function DueBadge({ state, days }: { state: DueState; days?: number }) {
  const d = DUE[state];
  return (
    <Badge className={d.cls}>
      {d.label}
      {days !== undefined && state === "overdue" ? ` ${-days} d` : ""}
    </Badge>
  );
}

const STRATEGY: Record<PmStrategy, string> = {
  time_based: "border-line-strong text-tx-2",
  condition_based: "border-info/40 text-info",
  failure_finding: "border-[#9085e9]/50 text-[#b9b0f5]",
};

export function StrategyBadge({ strategy, className }: { strategy: PmStrategy; className?: string }) {
  return <Badge className={cn(STRATEGY[strategy], className)}>{PM_STRATEGY_LABELS[strategy]}</Badge>;
}

export function intervalLabel(days: number): string {
  if (days % 365 === 0) return days === 365 ? "Yearly" : `${days / 365} yr`;
  if (days === 730) return "2 yr";
  if (days % 30 === 0 && days < 365) return days === 30 ? "Monthly" : `${days / 30} mo`;
  if (days === 7) return "Weekly";
  if (days === 180) return "6 mo";
  if (days === 90) return "Quarterly";
  return `${days} d`;
}
