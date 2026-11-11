import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { AI_STATE_LABELS, type AiQueueState } from "@/types/domain";

const STATE_STYLES: Record<AiQueueState, string> = {
  queued: "border-line-strong text-tx-2",
  running: "border-info/40 bg-info/10 text-info",
  failed: "border-bad/40 bg-bad/10 text-bad",
  needs_review: "border-brass/50 bg-brass/10 text-brass-bright",
  accepted: "border-good/40 bg-good/10 text-good",
  corrected: "border-warn/50 bg-warn/10 text-warn",
  rejected: "border-line bg-transparent text-tx-3",
};

export function AiStateBadge({ state }: { state: AiQueueState }) {
  return <Badge className={STATE_STYLES[state]}>{AI_STATE_LABELS[state]}</Badge>;
}

/** How many checks flagged a value that may have been invented. */
export function FlagBadge({ count }: { count: number }) {
  if (count === 0) return <span className="text-xs text-tx-3">None</span>;
  return (
    <Badge className="border-bad/50 bg-bad/10 text-bad">
      <AlertTriangle className="size-3" aria-hidden /> {count} flag{count === 1 ? "" : "s"}
    </Badge>
  );
}
