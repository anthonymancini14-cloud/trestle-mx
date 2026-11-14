"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { setAssetStatus } from "@/lib/actions";
import type { AssetStatus } from "@/types/domain";

interface Move {
  to: AssetStatus;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

const MOVES: Record<AssetStatus, Move[]> = {
  running: [
    { to: "down", label: "Mark down", danger: true },
    { to: "standby", label: "To standby" },
  ],
  standby: [
    { to: "down", label: "Mark down", danger: true },
    { to: "running", label: "Running" },
  ],
  down: [
    { to: "running", label: "Back in service", primary: true },
    { to: "standby", label: "Back, on standby" },
  ],
  retired: [{ to: "standby", label: "Back in the register" }],
};

/**
 * Record that equipment went down or came back. On a work order page the
 * change is tied to that work order, which is what makes the downtime count
 * as planned (preventive, project) or not.
 */
export function AssetStatusControl({ assetId, status, woId, canRetire }: { assetId: string; status: AssetStatus; woId: string | null; canRetire: boolean }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Only an admin retires an asset or brings a retired one back.
  const moves: Move[] = status === "retired" ? (canRetire ? MOVES.retired : []) : [...MOVES[status], ...(canRetire ? [{ to: "retired" as const, label: "Retire" }] : [])];
  if (moves.length === 0) return null;

  const go = (to: AssetStatus) =>
    start(async () => {
      const res = await setAssetStatus(assetId, { status: to, wo_id: woId, note });
      setError(res.ok ? null : res.error);
      if (res.ok) setNote("");
    });

  return (
    <div className="space-y-2">
      <Input aria-label="Note on the status change" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
      <div className="flex flex-wrap gap-2">
        {moves.map((m) => (
          <Button key={m.to} type="button" size="sm" variant={m.primary ? "primary" : m.danger ? "danger" : "ghost"} disabled={pending} onClick={() => go(m.to)}>
            {m.label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
