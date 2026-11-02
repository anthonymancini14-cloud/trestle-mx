"use client";

import { useState, useTransition } from "react";
import { CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/primitives";
import { deferPm, generateDuePms } from "@/lib/actions";

/** Planner/admin: create work orders for PMs due in the lead window. */
export function GeneratePmsButton({ dueWithoutWo }: { dueWithoutWo: number }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        size="sm"
        disabled={pending || dueWithoutWo === 0}
        onClick={() =>
          startTransition(async () => {
            const r = await generateDuePms();
            setMessage(r.ok ? `Created ${r.created} PM work order${r.created === 1 ? "" : "s"} in Scheduling.` : r.error);
          })
        }
      >
        <CalendarCheck className="size-4" aria-hidden />
        {pending ? "Generating…" : `Generate ${dueWithoutWo} due PM${dueWithoutWo === 1 ? "" : "s"}`}
      </Button>
      {message && (
        <p role="status" className="text-xs text-tx-2">
          {message}
        </p>
      )}
    </div>
  );
}

/** Supervisor only: move a PM's due date with a reason. Every deferral is logged. */
export function DeferPmForm({ scheduleId, currentDue }: { scheduleId: string; currentDue: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toDate, setToDate] = useState(() => new Date(Date.parse(`${currentDue}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10));
  const [reason, setReason] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-brass hover:text-brass-bright">
        Defer
      </button>
    );
  }
  return (
    <form
      className="w-64 space-y-2 rounded-[3px] border border-line-strong bg-panel-2 p-2 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const r = await deferPm({ scheduleId, toDate, reason });
          if (r.ok) setOpen(false);
          else setError(r.error);
        });
      }}
    >
      <div>
        <Label htmlFor={`to-${scheduleId}`}>New due date</Label>
        <Input id={`to-${scheduleId}`} type="date" value={toDate} min={currentDue} onChange={(e) => setToDate(e.target.value)} required />
      </div>
      <div>
        <Label htmlFor={`why-${scheduleId}`}>Reason (logged and counted)</Label>
        <Textarea id={`why-${scheduleId}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required />
      </div>
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Approve deferral"}
        </Button>
        <Button type="button" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
