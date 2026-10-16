"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Lock, Plus, ShieldAlert, Trash2, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { CRAFTS, planLaborHours, type JobPlan, type JobPlanTask } from "@/lib/planning/plan-schema";
import { cn, currency, formatHours } from "@/lib/utils";

export interface CatalogItem {
  partNumber: string;
  description: string;
  available: number;
  unit: string;
  unitCost: number;
}

/**
 * The live job plan. Claude writes it; the planner edits it directly; edits
 * are sent back with the next message so Claude revises the planner's version.
 */
export function PlanEditor({
  plan,
  onChange,
  catalog,
  changedSeqs,
  busy,
  committing,
  onCommit,
}: {
  plan: JobPlan | null;
  onChange: (plan: JobPlan) => void;
  catalog: CatalogItem[];
  changedSeqs: Set<number>;
  busy: boolean;
  committing: boolean;
  onCommit: () => void;
}) {
  const [addPart, setAddPart] = useState("");

  if (!plan) {
    return (
      <div className="flex h-full flex-col gap-3 rounded-[3px] border border-dashed border-line-strong bg-panel/50 p-6">
        <div className="h-4 w-1/3 animate-pulse rounded bg-panel-3" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-panel-3" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-panel-3" />
        <p className="mt-auto text-center text-sm text-tx-3">{busy ? "Drafting the job plan…" : "No plan yet."}</p>
      </div>
    );
  }

  const update = (patch: Partial<JobPlan>) => onChange({ ...plan, ...patch });
  const updateTask = (seq: number, patch: Partial<JobPlanTask>) =>
    update({ tasks: plan.tasks.map((t) => (t.seq === seq ? { ...t, ...patch } : t)) });
  const crewHours = planLaborHours(plan);
  const stockOf = (pn: string | null) => (pn ? catalog.find((c) => c.partNumber === pn) : undefined);
  const shortParts = plan.parts.filter((p) => {
    const s = stockOf(p.part_number);
    return !s || s.available < p.qty;
  });
  const materialCost = plan.parts.reduce((sum, p) => sum + (stockOf(p.part_number)?.unitCost ?? 0) * p.qty, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[3px] border border-line bg-panel">
      <div className="flex-1 overflow-y-auto">
        {/* Summary */}
        <div className="space-y-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brass-dim">Job plan · draft</span>
            {plan.requires_shutdown && <Badge className="border-warn/50 bg-warn/10 text-warn">Equipment out of service</Badge>}
            {busy && <span className="text-[11px] text-brass">Assistant is revising…</span>}
          </div>
          <label className="block">
            <span className="sr-only">Summary</span>
            <textarea
              value={plan.summary}
              onChange={(e) => update({ summary: e.target.value })}
              rows={2}
              className="w-full resize-none bg-transparent font-display text-lg font-medium leading-snug tracking-wide focus:outline-none"
            />
          </label>
          <div className="rounded-[3px] border border-line bg-panel-2 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-tx-3">Likely cause · hypothesis</div>
            <p className="mt-0.5 text-sm leading-relaxed text-tx-2">{plan.likely_cause}</p>
          </div>
        </div>

        {/* Safety */}
        <PlanSection icon={ShieldAlert} title="Safety" tone="warn">
          <div className="flex flex-wrap gap-1.5">
            {plan.permits.map((p) => (
              <Badge key={p} className="border-warn/40 text-warn">
                {p}
              </Badge>
            ))}
          </div>
          {plan.isolation_points.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-tx-3">
                <Lock className="size-3" aria-hidden /> Proposed isolation points · verify on walkdown
              </div>
              <ul className="divide-y divide-line/60 rounded-[3px] border border-line">
                {plan.isolation_points.map((iso, i) => (
                  <li key={i} className="grid gap-1 px-3 py-1.5 text-xs sm:grid-cols-[minmax(0,14rem)_6rem_1fr]">
                    <span className="font-mono text-brass-bright">{iso.tag}</span>
                    <span className="capitalize text-tx-3">{iso.energy}</span>
                    <span className="text-tx-2">{iso.method}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="mt-3 space-y-1.5">
            {plan.hazards.map((h, i) => (
              <li key={i} className="text-xs">
                <span className="font-medium text-tx">{h.hazard}.</span> <span className="text-tx-2">{h.control}</span>
              </li>
            ))}
          </ul>
        </PlanSection>

        {/* Steps */}
        <PlanSection
          icon={Wrench}
          title="Steps"
          aside={<span className="font-mono text-[11px] text-tx-3">{formatHours(crewHours)} crew · {formatHours(plan.estimated_duration_hours)} elapsed</span>}
        >
          <ol className="space-y-1.5">
            {plan.tasks.map((t) => (
              <li
                key={t.seq}
                className={cn(
                  "group rounded-[3px] border border-line bg-bg/40 px-2.5 py-2 transition-colors",
                  changedSeqs.has(t.seq) && "border-brass/60 bg-brass/5",
                )}
              >
                <div className="flex gap-2">
                  <span className="w-6 shrink-0 pt-1 font-mono text-[11px] text-tx-3">{t.seq}</span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <textarea
                      aria-label={`Step ${t.seq} description`}
                      value={t.description}
                      onChange={(e) => updateTask(t.seq, { description: e.target.value })}
                      rows={Math.max(1, Math.ceil(t.description.length / 70))}
                      className="w-full resize-none bg-transparent text-sm leading-snug focus:outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <select
                        aria-label="Craft"
                        value={t.craft}
                        onChange={(e) => updateTask(t.seq, { craft: e.target.value as JobPlanTask["craft"] })}
                        className="h-7 rounded-[2px] border border-line-strong bg-panel px-1.5 capitalize text-tx-2"
                      >
                        {CRAFTS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <NumberField label="Crew" value={t.crew_size} step={1} min={1} onChange={(v) => updateTask(t.seq, { crew_size: Math.max(1, Math.round(v)) })} />
                      <span className="text-tx-3">×</span>
                      <NumberField label="Hours" value={t.est_hours} step={0.5} min={0} onChange={(v) => updateTask(t.seq, { est_hours: v })} suffix="h" />
                      {changedSeqs.has(t.seq) && <Badge className="border-brass/50 text-brass">new</Badge>}
                      <button
                        type="button"
                        onClick={() => update({ tasks: plan.tasks.filter((x) => x.seq !== t.seq) })}
                        className="ml-auto flex size-7 items-center justify-center text-tx-3 opacity-60 hover:text-bad group-hover:opacity-100"
                        aria-label={`Remove step ${t.seq}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                    {t.safety_note && <p className="text-xs text-warn">⚠ {t.safety_note}</p>}
                    {t.acceptance_criteria && <p className="text-xs text-good">✓ {t.acceptance_criteria}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => {
              const seq = (Math.max(0, ...plan.tasks.map((t) => t.seq)) || 0) + 10;
              update({
                tasks: [...plan.tasks, { seq, description: "New step", craft: "mechanical", crew_size: 1, est_hours: 1, safety_note: null, acceptance_criteria: null }],
              });
            }}
            className="mt-2 inline-flex items-center gap-1 text-xs text-brass hover:text-brass-bright"
          >
            <Plus className="size-3.5" aria-hidden /> Add step
          </button>
        </PlanSection>

        {/* Parts */}
        <PlanSection
          icon={Wrench}
          title="Materials"
          aside={<span className="font-mono text-[11px] text-tx-3">{currency(materialCost)} stocked</span>}
        >
          <ul className="divide-y divide-line/60 rounded-[3px] border border-line">
            {plan.parts.map((p, i) => {
              const stock = stockOf(p.part_number);
              const ok = !!stock && stock.available >= p.qty;
              return (
                <li key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    {p.part_number ? (
                      <span className="font-mono text-xs text-brass-bright">{p.part_number}</span>
                    ) : (
                      <span className="text-[11px] text-warn">Non-stock</span>
                    )}
                    <div className="truncate text-xs text-tx-2">{stock?.description ?? p.description}</div>
                  </div>
                  <NumberField
                    label="Qty"
                    value={p.qty}
                    step={1}
                    min={0}
                    onChange={(v) => update({ parts: plan.parts.map((x, j) => (j === i ? { ...x, qty: v } : x)) })}
                  />
                  <Badge className={ok ? "border-good/40 text-good" : "border-bad/50 bg-bad/10 text-bad"}>
                    {stock ? `${stock.available} avail` : "Order"}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => update({ parts: plan.parts.filter((_, j) => j !== i) })}
                    className="flex size-7 items-center justify-center text-tx-3 hover:text-bad"
                    aria-label="Remove part"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex gap-2">
            <select
              aria-label="Add a catalog part"
              value={addPart}
              onChange={(e) => setAddPart(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-[3px] border border-line-strong bg-bg px-2 text-xs"
            >
              <option value="">Add from storeroom catalog…</option>
              {catalog.map((c) => (
                <option key={c.partNumber} value={c.partNumber}>
                  {c.partNumber} · {c.description} ({c.available} avail)
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!addPart}
              onClick={() => {
                const c = catalog.find((x) => x.partNumber === addPart);
                if (!c) return;
                update({ parts: [...plan.parts, { part_number: c.partNumber, description: c.description, qty: 1 }] });
                setAddPart("");
              }}
            >
              Add
            </Button>
          </div>
          {plan.tools.length > 0 && (
            <div className="mt-3 text-xs">
              <span className="font-semibold uppercase tracking-wider text-tx-3">Special tools </span>
              <span className="text-tx-2">{plan.tools.join(" · ")}</span>
            </div>
          )}
        </PlanSection>

        {/* Open questions + references */}
        <PlanSection icon={AlertTriangle} title="Confirm before commit" tone={plan.open_questions.length ? "warn" : undefined}>
          {plan.open_questions.length === 0 ? (
            <p className="text-xs text-tx-3">No open questions.</p>
          ) : (
            <ul className="space-y-1.5">
              {plan.open_questions.map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label="Mark confirmed"
                    className="mt-1 size-4 shrink-0 accent-[var(--brass)]"
                    onChange={() => update({ open_questions: plan.open_questions.filter((_, j) => j !== i) })}
                  />
                  <span className="text-tx-2">{q}</span>
                </li>
              ))}
            </ul>
          )}
          {plan.references.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-tx-3">Grounded in</div>
              <ul className="space-y-1">
                {plan.references.map((r, i) => (
                  <li key={i} className="text-xs">
                    <span className="text-brass-bright">{r.source}</span> <span className="text-tx-3">— {r.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </PlanSection>
      </div>

      {/* Commit bar */}
      <div className="flex flex-wrap items-center gap-3 border-t border-line-strong bg-panel-2 px-4 py-2.5">
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-tx-2">
          <span>
            <span className="font-mono text-tx">{plan.tasks.length}</span> steps
          </span>
          <span>
            <span className="font-mono text-tx">{formatHours(crewHours)}</span> crew
          </span>
          <span className={shortParts.length ? "text-warn" : undefined}>
            <span className="font-mono">{plan.parts.length - shortParts.length}</span>/{plan.parts.length} parts reservable
          </span>
        </div>
        <Button variant="primary" className="ml-auto" disabled={busy || committing || plan.tasks.length === 0} onClick={onCommit}>
          {committing ? "Committing…" : "Commit plan"} <ArrowRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function PlanSection({
  icon: Icon,
  title,
  aside,
  tone,
  children,
}: {
  icon: typeof Wrench;
  title: string;
  aside?: React.ReactNode;
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line px-4 py-3">
      <header className="mb-2 flex items-center gap-2">
        <Icon className={cn("size-4", tone === "warn" ? "text-warn" : "text-brass-dim")} aria-hidden />
        <h3 className="font-display text-sm font-semibold uppercase tracking-wider">{title}</h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </header>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  suffix?: string;
}) {
  return (
    <label className="inline-flex items-center gap-1 text-tx-3">
      <span className="sr-only">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, n));
        }}
        className="h-7 w-14 rounded-[2px] border border-line-strong bg-panel px-1.5 text-right font-mono text-xs text-tx focus:border-brass focus:outline-none"
      />
      {suffix}
    </label>
  );
}
