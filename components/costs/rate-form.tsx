"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/primitives";
import { setLaborRate } from "@/lib/actions";
import { CRAFT_LABELS, CRAFTS, type Craft } from "@/types/domain";

/** Set a craft's hourly rate from a date. Hours already logged keep the rate they were entered at. */
export function RateForm({ today }: { today: string }) {
  const [craft, setCraft] = useState<Craft>("mechanical");
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="grid gap-3 border-t border-line px-4 py-3 sm:grid-cols-[1fr_8rem_10rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await setLaborRate({ craft, hourly_rate: Number(rate), effective_from: from });
          setError(res.ok ? null : res.error);
          if (res.ok) setRate("");
        });
      }}
    >
      <div>
        <Label htmlFor="rate-craft">Craft</Label>
        <Select id="rate-craft" value={craft} onChange={(e) => setCraft(e.target.value as Craft)}>
          {CRAFTS.map((c) => (
            <option key={c} value={c}>
              {CRAFT_LABELS[c]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="rate-amount">Rate, $ per hour</Label>
        <Input id="rate-amount" type="number" min={0} step={0.5} value={rate} onChange={(e) => setRate(e.target.value)} className="font-mono" />
      </div>
      <div>
        <Label htmlFor="rate-from">From</Label>
        <Input id="rate-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="flex items-end">
        <Button type="submit" variant="primary" disabled={pending || !rate}>
          Set rate
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-bad sm:col-span-4">
          {error}
        </p>
      )}
    </form>
  );
}
