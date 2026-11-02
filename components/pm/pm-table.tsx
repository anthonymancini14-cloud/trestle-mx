"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react";
import { DueBadge, intervalLabel, StrategyBadge } from "@/components/pm/pm-badges";
import { DeferPmForm } from "@/components/pm/pm-controls";
import { CriticalityBadge, StageBadge } from "@/components/status";
import { EmptyState, Input, Mono, Select, Table, Td, Th } from "@/components/ui/primitives";
import type { DueState } from "@/lib/pm/program";
import { cn, formatDay } from "@/lib/utils";
import { PM_STRATEGIES, PM_STRATEGY_LABELS, STAGE_LABELS, WO_STAGES, type Criticality, type PmScheduleRow } from "@/types/domain";

export type PmTableRow = PmScheduleRow & { state: DueState; days: number };

type SortKey = "asset" | "crit" | "task" | "modes" | "interval" | "last" | "next" | "wo";
type Dir = "asc" | "desc";

const CRIT_ORDER: Record<Criticality, number> = { A: 0, B: 1, C: 2 };

const SORTERS: Record<SortKey, (a: PmTableRow, b: PmTableRow) => number> = {
  asset: (a, b) => a.asset.floc.localeCompare(b.asset.floc),
  crit: (a, b) => CRIT_ORDER[a.asset.criticality] - CRIT_ORDER[b.asset.criticality],
  task: (a, b) => a.task.code.localeCompare(b.task.code),
  modes: (a, b) => a.task.failure_mode_codes.join(" ").localeCompare(b.task.failure_mode_codes.join(" ")),
  interval: (a, b) => a.interval_days - b.interval_days,
  last: (a, b) => (a.last_done_on ?? "").localeCompare(b.last_done_on ?? ""),
  next: (a, b) => a.next_due_on.localeCompare(b.next_due_on),
  wo: (a, b) => (a.open_wo?.wo_number ?? "~").localeCompare(b.open_wo?.wo_number ?? "~"),
};

interface Filters {
  q: string;
  crit: "" | Criticality;
  strategy: string;
  craft: string;
  mode: string;
  wo: string;
}
const NO_FILTERS: Filters = { q: "", crit: "", strategy: "", craft: "", mode: "", wo: "" };

/**
 * The PM schedule table. Every column sorts; the filter bar narrows by asset,
 * criticality, strategy, craft, failure mode and work order status. Rows come
 * from the server already scoped to the site and the due-state tab.
 */
export function PmTable({
  rows,
  modeNames,
  canDefer,
}: {
  rows: PmTableRow[];
  /** Failure mode code → name, from the class library. */
  modeNames: Record<string, string>;
  canDefer: boolean;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "next", dir: "asc" });
  const [f, setF] = useState<Filters>(NO_FILTERS);

  const options = useMemo(() => {
    const crafts = new Set<string>();
    const modes = new Set<string>();
    for (const r of rows) {
      crafts.add(r.task.craft);
      r.task.failure_mode_codes.forEach((m) => modes.add(m));
    }
    return { crafts: [...crafts].sort(), modes: [...modes].sort() };
  }, [rows]);

  const visible = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const out = rows.filter(
      (r) =>
        (!q || `${r.asset.floc} ${r.asset.name} ${r.task.code} ${r.task.title}`.toLowerCase().includes(q)) &&
        (!f.crit || r.asset.criticality === f.crit) &&
        (!f.strategy || r.task.strategy === f.strategy) &&
        (!f.craft || r.task.craft === f.craft) &&
        (!f.mode || r.task.failure_mode_codes.includes(f.mode)) &&
        (!f.wo || (f.wo === "none" ? !r.open_wo : f.wo === "any" ? !!r.open_wo : r.open_wo?.stage === f.wo)),
    );
    const cmp = SORTERS[sort.key];
    // Ties fall back to the due date, then the asset, so the order is stable.
    return out.sort((a, b) => (sort.dir === "asc" ? 1 : -1) * cmp(a, b) || SORTERS.next(a, b) || SORTERS.asset(a, b));
  }, [rows, f, sort]);

  const active = Object.values(f).some(Boolean);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }));
  const header = (key: SortKey, label: string, className?: string) => (
    <Th className={className} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="inline-flex items-center gap-1 whitespace-nowrap uppercase tracking-wider hover:text-tx-2"
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }))}
      >
        {label}
        {sort.key !== key ? (
          <ArrowUpDown className="size-3 opacity-50" aria-hidden />
        ) : sort.dir === "asc" ? (
          <ArrowUp className="size-3" aria-hidden />
        ) : (
          <ArrowDown className="size-3" aria-hidden />
        )}
      </button>
    </Th>
  );

  return (
    <>
      <div role="search" aria-label="Filter the PM table" className="flex flex-wrap items-end gap-2 border-b border-line px-3 py-2.5">
        <Input
          aria-label="Search asset or PM task"
          placeholder="Search asset, tag or task"
          value={f.q}
          onChange={(e) => set("q", e.target.value)}
          className="h-9 w-full sm:w-56"
        />
        <Select aria-label="Criticality" value={f.crit} onChange={(e) => set("crit", e.target.value as Filters["crit"])} className="w-auto">
          <option value="">All criticality</option>
          <option value="A">Crit A</option>
          <option value="B">Crit B</option>
          <option value="C">Crit C</option>
        </Select>
        <Select aria-label="Strategy" value={f.strategy} onChange={(e) => set("strategy", e.target.value)} className="w-auto">
          <option value="">All strategies</option>
          {PM_STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {PM_STRATEGY_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Craft" value={f.craft} onChange={(e) => set("craft", e.target.value)} className="w-auto capitalize">
          <option value="">All crafts</option>
          {options.crafts.map((c) => (
            <option key={c} value={c}>
              {c[0].toUpperCase() + c.slice(1)}
            </option>
          ))}
        </Select>
        <Select aria-label="Failure mode" value={f.mode} onChange={(e) => set("mode", e.target.value)} className="w-auto max-w-56">
          <option value="">All failure modes</option>
          {options.modes.map((m) => (
            <option key={m} value={m}>
              {m} · {modeNames[m] ?? m}
            </option>
          ))}
        </Select>
        <Select aria-label="Work order" value={f.wo} onChange={(e) => set("wo", e.target.value)} className="w-auto">
          <option value="">Any work order status</option>
          <option value="none">No open work order</option>
          <option value="any">Has an open work order</option>
          {WO_STAGES.filter((s) => s !== "closure" && s !== "identification").map((s) => (
            <option key={s} value={s}>
              Work order in {STAGE_LABELS[s]}
            </option>
          ))}
        </Select>
        {active && (
          <button type="button" onClick={() => setF(NO_FILTERS)} className="inline-flex h-9 items-center gap-1 px-2 text-xs text-brass hover:text-brass-bright">
            <X className="size-3" aria-hidden /> Clear
          </button>
        )}
        <span className="ml-auto self-center font-mono text-xs text-tx-3" role="status">
          {visible.length} of {rows.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState>{rows.length === 0 ? "Nothing here. Every PM in this view is current." : "No PMs match these filters."}</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              {header("asset", "Asset")}
              {header("task", "PM task")}
              {header("modes", "Failure modes", "hidden 2xl:table-cell")}
              {header("interval", "Interval")}
              {header("last", "Last done", "hidden xl:table-cell")}
              {header("next", "Next due")}
              {header("wo", "Work order")}
              {canDefer && <Th className="w-24" />}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="hover:bg-panel-2">
                <Td>
                  <Link href={`/assets/${r.asset.id}`} className="block">
                    <Mono className="text-xs">{r.asset.floc}</Mono>
                    <div className="flex items-center gap-1.5 text-xs text-tx-2">
                      <span className="truncate">{r.asset.name}</span> <CriticalityBadge criticality={r.asset.criticality} />
                    </div>
                  </Link>
                </Td>
                <Td className="min-w-56">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Mono className="text-[11px] text-tx-3">{r.task.code}</Mono>
                    <StrategyBadge strategy={r.task.strategy} />
                    <ModeCodes codes={r.task.failure_mode_codes} names={modeNames} className="2xl:hidden" />
                  </div>
                  <div className="text-sm">{r.task.title}</div>
                  {r.deferrals[0] && (
                    <div className="mt-0.5 text-xs text-warn" title={r.deferrals[0].reason}>
                      Deferred {r.deferrals.length}× · {r.deferrals[0].approver_name ?? "supervisor"}: {r.deferrals[0].reason}
                    </div>
                  )}
                </Td>
                <Td className="hidden 2xl:table-cell">
                  <ModeCodes codes={r.task.failure_mode_codes} names={modeNames} long />
                </Td>
                <Td className="whitespace-nowrap text-xs">{intervalLabel(r.interval_days)}</Td>
                <Td className="hidden whitespace-nowrap text-xs text-tx-3 xl:table-cell">{formatDay(r.last_done_on)}</Td>
                <Td className="whitespace-nowrap">
                  <div className="text-xs">{formatDay(r.next_due_on)}</div>
                  <DueBadge state={r.state} days={r.days} />
                </Td>
                <Td>
                  {r.open_wo ? (
                    <Link href={`/work-orders/${r.open_wo.id}`} className="flex flex-col gap-0.5">
                      <Mono className="whitespace-nowrap text-xs">{r.open_wo.wo_number}</Mono>
                      <StageBadge stage={r.open_wo.stage} status="open" />
                    </Link>
                  ) : (
                    <span className="text-xs text-tx-3">—</span>
                  )}
                </Td>
                {canDefer && (
                  <Td className="text-right">
                    <DeferPmForm scheduleId={r.id} currentDue={r.next_due_on} />
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

/** Failure mode codes with their names on hover (or written out when there is room). */
function ModeCodes({ codes, names, long, className }: { codes: string[]; names: Record<string, string>; long?: boolean; className?: string }) {
  return (
    <span className={cn("flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px] text-tx-3", className)}>
      {codes.map((c) => (
        <abbr key={c} title={names[c] ?? c} className="cursor-help no-underline">
          {c}
          {long && names[c] && <span className="font-sans text-tx-2"> {names[c]}</span>}
        </abbr>
      ))}
    </span>
  );
}
