import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Criticality, Priority, WoPartStatus, WoStage, WoStatus, WoType } from "@/types/domain";
import { STAGE_LABELS } from "@/types/domain";

const STAGE_STYLES: Record<WoStage, string> = {
  identification: "border-steel/50 bg-steel/10 text-tx-2",
  vetting: "border-info/40 bg-info/10 text-info",
  planning: "border-brass/50 bg-brass/10 text-brass-bright",
  scheduling: "border-[#9085e9]/50 bg-[#9085e9]/10 text-[#b9b0f5]",
  execution: "border-warn/50 bg-warn/10 text-warn",
  closure: "border-good/40 bg-good/10 text-good",
};

export function StageBadge({ stage, status }: { stage: WoStage; status: WoStatus }) {
  if (status === "closed") return <Badge className="border-good/40 bg-good/15 text-good">Closed</Badge>;
  if (status === "rejected") return <Badge className="border-bad/40 bg-bad/10 text-bad">Rejected</Badge>;
  return <Badge className={STAGE_STYLES[stage]}>{STAGE_LABELS[stage]}</Badge>;
}

const PRIORITY: Record<Priority, { label: string; cls: string }> = {
  1: { label: "P1 Emergency", cls: "border-bad/60 bg-bad/15 text-bad font-semibold" },
  2: { label: "P2 Urgent", cls: "border-warn/50 bg-warn/10 text-warn" },
  3: { label: "P3 Routine", cls: "border-line-strong bg-panel-2 text-tx-2" },
  4: { label: "P4 Deferred", cls: "border-line bg-transparent text-tx-3" },
};

export function PriorityBadge({ priority, compact }: { priority: Priority; compact?: boolean }) {
  const p = PRIORITY[priority];
  return <Badge className={p.cls}>{compact ? `P${priority}` : p.label}</Badge>;
}

export function CriticalityBadge({ criticality }: { criticality: Criticality }) {
  return (
    <Badge
      title={`Criticality ${criticality}`}
      className={cn(
        "font-mono",
        criticality === "A" && "border-bad/50 text-bad",
        criticality === "B" && "border-warn/50 text-warn",
        criticality === "C" && "border-line-strong text-tx-3",
      )}
    >
      Crit {criticality}
    </Badge>
  );
}

const PART_STATUS: Record<WoPartStatus, string> = {
  planned: "border-line-strong text-tx-2",
  reserved: "border-info/40 bg-info/10 text-info",
  kitted: "border-brass/50 bg-brass/10 text-brass-bright",
  issued: "border-good/40 bg-good/10 text-good",
};

export function PartStatusBadge({ status }: { status: WoPartStatus }) {
  return <Badge className={cn("capitalize", PART_STATUS[status])}>{status}</Badge>;
}

export function TypeLabel({ type }: { type: WoType }) {
  return <span className="text-xs capitalize text-tx-3">{type}</span>;
}

export function StockBadge({ available, min }: { available: number; min: number }) {
  if (available <= 0) return <Badge className="border-bad/50 bg-bad/10 text-bad">Out</Badge>;
  if (available < min) return <Badge className="border-warn/50 bg-warn/10 text-warn">Low · {available}</Badge>;
  return <Badge className="border-good/40 text-good">{available} avail</Badge>;
}
