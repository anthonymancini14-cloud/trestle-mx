"use client";

import { useState, useTransition } from "react";
import { PartStatusBadge, StockBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Mono, Table, Td, Th } from "@/components/ui/primitives";
import { issuePart, setPartEta } from "@/lib/actions";
import { cn, formatDay } from "@/lib/utils";
import type { WorkOrderDetail } from "@/types/domain";

export function PartsTable({
  woId,
  parts,
  canIssue,
  canSetEta = false,
}: {
  woId: string;
  parts: WorkOrderDetail["parts"];
  canIssue: boolean;
  /** Storeroom, planner or admin: set when a part that isn't on site is expected. */
  canSetEta?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Part</Th>
          <Th className="text-right">Qty</Th>
          <Th>Status</Th>
          <Th>On site</Th>
          {canIssue && <Th />}
        </tr>
      </thead>
      <tbody>
        {parts.map((p) => (
          <tr key={p.id}>
            <Td className="min-w-56">
              {p.part ? <Mono className="text-xs">{p.part.part_number}</Mono> : <span className="text-xs text-warn">Non-stock</span>}
              <div className="text-xs text-tx-2">{p.description}</div>
              {p.stock && <div className="font-mono text-[10px] text-tx-3">Bin {p.stock.bin}</div>}
            </Td>
            <Td className="text-right font-mono text-xs">{p.qty_required}</Td>
            <Td>
              <PartStatusBadge status={p.status} />
            </Td>
            <Td>
              {p.status === "issued" ? (
                <span className="text-xs text-tx-3">Used {p.qty_used}</span>
              ) : p.status === "reserved" || p.status === "kitted" ? (
                <span className="text-xs text-tx-2">Held for this job</span>
              ) : (
                <div className="space-y-1">
                  {p.stock && <StockBadge available={p.stock.on_hand - p.stock.reserved} min={p.qty_required} />}
                  <div className={cn("text-xs", p.expected_on ? "text-tx-2" : "text-warn")}>
                    {p.expected_on ? `Expected ${formatDay(p.expected_on)}` : "Not on site, no date yet"}
                  </div>
                  {canSetEta && <EtaForm partId={p.id} current={p.expected_on} />}
                </div>
              )}
            </Td>
            {canIssue && (
              <Td className="text-right">
                {p.status !== "issued" && p.part && (
                  <Button size="sm" disabled={pending} onClick={() => startTransition(async () => void (await issuePart(woId, p.id)))}>
                    Issue
                  </Button>
                )}
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** When the part will be on site. The calendar won't place corrective work before it. */
function EtaForm({ partId, current }: { partId: string; current: string | null }) {
  const [date, setDate] = useState(current ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setPartEta(partId, date || null);
          setError(r.ok ? null : r.error);
        });
      }}
    >
      <input
        type="date"
        aria-label="Expected on site"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="h-8 rounded-[3px] border border-line-strong bg-panel px-1.5 text-xs"
      />
      <Button size="sm" type="submit" disabled={pending || date === (current ?? "")}>
        Set
      </Button>
      {error && <span className="text-[11px] text-bad">{error}</span>}
    </form>
  );
}
