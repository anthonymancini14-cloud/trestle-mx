import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bordered panel: the basic surface. */
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-[3px] border border-line bg-panel", className)} {...props} />;
}

export function PanelHeader({
  title,
  eyebrow,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-center justify-between gap-3 border-b border-line px-4 py-2.5", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brass-dim">{eyebrow}</div>}
        <h2 className="truncate font-display text-base font-semibold uppercase tracking-wide text-tx">{title}</h2>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Badge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-[2px] border px-1.5 py-px text-[11px] font-medium leading-4",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("mb-1 block text-xs font-medium text-tx-2", className)} {...props} />;
}

const field =
  "w-full rounded-[3px] border border-line-strong bg-bg px-2.5 text-sm text-tx placeholder:text-tx-3 focus:border-brass focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "py-2 leading-relaxed", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(field, "h-9 pr-8", className)} {...props} />;
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-line bg-panel-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-tx-3",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-b border-line/60 px-3 py-2 align-top", className)} {...props} />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-tx-3">{children}</div>;
}

export function Mono({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("font-mono text-[12.5px] text-brass-bright", className)} {...props} />;
}
