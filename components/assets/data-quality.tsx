import { Badge } from "@/components/ui/primitives";
import type { AssetAssessment } from "@/lib/taxonomy/assess";
import { cn } from "@/lib/utils";

/** Labeled data-quality status for one asset against its class. */
export function DataQualityBadge({ assessment, className }: { assessment: AssetAssessment; className?: string }) {
  if (!assessment.classified) {
    return <Badge className={cn("border-bad/50 text-bad", className)}>Unclassified</Badge>;
  }
  if (assessment.complete) {
    return <Badge className={cn("border-good/40 text-good", className)}>Data complete</Badge>;
  }
  return (
    <Badge className={cn("border-warn/50 text-warn", className)} title={assessment.issues.map((i) => i.spec.label).join(", ")}>
      {assessment.requiredFilled}/{assessment.requiredTotal} fields
    </Badge>
  );
}

/** A small labeled stat for register-level data quality. */
export function QualityStat({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-tx-3">{label}</div>
      <div
        className={cn(
          "font-display text-2xl font-semibold tabular-nums",
          tone === "good" && "text-good",
          tone === "warn" && "text-warn",
          tone === "bad" && "text-bad",
        )}
      >
        {value}
      </div>
      {detail && <div className="text-xs text-tx-3">{detail}</div>}
    </div>
  );
}

export function qualityTone(pct: number): "good" | "warn" | "bad" {
  return pct >= 95 ? "good" : pct >= 75 ? "warn" : "bad";
}
