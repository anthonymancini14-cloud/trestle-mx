import { cn } from "@/lib/utils";

/** One figure with its label and a line saying what it covers. */
export function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "warn" | "bad" | "good" }) {
  return (
    <div className="bg-panel px-4 py-2.5">
      <dt className="text-[11px] uppercase tracking-wider text-tx-3">{label}</dt>
      <dd className={cn("font-mono text-lg leading-tight", tone === "bad" && "text-bad", tone === "good" && "text-good")}>{value}</dd>
      <dd className={cn("text-xs", tone === "warn" ? "text-warn" : "text-tx-3")}>{note}</dd>
    </div>
  );
}

/** A row of figures separated by hairlines. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-2 gap-px border-b border-line bg-line", className)}>{children}</dl>;
}
