"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/primitives";
import { updateAssetLifecycle } from "@/lib/actions";

/** Edit what an asset would cost to replace, how long it should last and when its warranty ends. */
export function LifecycleForm({ assetId, value, life, warranty }: { assetId: string; value: number | null; life: number | null; warranty: string | null }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(value === null ? "" : String(value));
  const [l, setL] = useState(life === null ? "" : String(life));
  const [w, setW] = useState(warranty ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" className="text-xs text-brass hover:text-brass-bright" onClick={() => setOpen(true)}>
        Edit value, life and warranty
      </button>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateAssetLifecycle(assetId, { replacement_value: v === "" ? null : Number(v), expected_life_years: l === "" ? null : Number(l), warranty_until: w === "" ? null : w });
          setError(res.ok ? null : res.error);
          if (res.ok) setOpen(false);
        });
      }}
    >
      <div>
        <Label htmlFor="life-value">Replacement value, $</Label>
        <Input id="life-value" type="number" min={0} step={100} value={v} onChange={(e) => setV(e.target.value)} className="font-mono" />
      </div>
      <div>
        <Label htmlFor="life-years">Expected life, years</Label>
        <Input id="life-years" type="number" min={1} step={1} value={l} onChange={(e) => setL(e.target.value)} className="font-mono" />
      </div>
      <div>
        <Label htmlFor="life-warranty">Warranty ends</Label>
        <Input id="life-warranty" type="date" value={w} onChange={(e) => setW(e.target.value)} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
