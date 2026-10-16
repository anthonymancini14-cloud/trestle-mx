"use client";

import { useTransition } from "react";
import { PartStatusBadge, StockBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Mono, Table, Td, Th } from "@/components/ui/primitives";
import { issuePart } from "@/lib/actions";
import type { WorkOrderDetail } from "@/types/domain";

export function PartsTable({
  woId,
  parts,
  canIssue,
}: {
  woId: string;
  parts: WorkOrderDetail["parts"];
  canIssue: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Part</Th>
          <Th className="text-right">Qty</Th>
          <Th>Status</Th>
          <Th>Stock</Th>
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
              ) : p.stock ? (
                <StockBadge available={p.stock.on_hand - p.stock.reserved} min={p.qty_required} />
              ) : (
                <span className="text-xs text-warn">Order</span>
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
