"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { addWce } from "@/lib/actions";

/** Write up another shop's WCE on this JCN. It gets the next number and runs its own lifecycle. */
export function AddWceForm({ jcn }: { jcn: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addWce.bind(null, jcn), null);
  if (!open) {
    return (
      <div className="border-t border-line px-4 py-2.5">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-9 items-center gap-1 text-sm text-brass hover:text-brass-bright">
          <Plus className="size-4" aria-hidden /> Add a WCE for another shop
        </button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3 border-t border-line bg-panel-2 px-4 py-3">
      <p className="text-xs text-tx-3">
        Another shop&apos;s work on this discrepancy (scaffold, electrical isolation, controls). It gets the next WCE number on JCN {jcn} and goes
        through vetting, planning and scheduling on its own.
      </p>
      <div>
        <Label htmlFor="wce-title">Work for this shop</Label>
        <Input id="wce-title" name="title" required placeholder="Erect scaffold for gearbox access" />
      </div>
      <div>
        <Label htmlFor="wce-desc">Details</Label>
        <Textarea id="wce-desc" name="description" rows={3} required placeholder="What this shop needs to do, and when it has to happen relative to the main job." />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="wce-type">Type</Label>
          <Select id="wce-type" name="wo_type" defaultValue="corrective">
            <option value="corrective">Corrective</option>
            <option value="predictive">Predictive</option>
            <option value="project">Project</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="wce-priority">Priority</Label>
          <Select id="wce-priority" name="priority" defaultValue="3">
            <option value="1">P1 Emergency</option>
            <option value="2">P2 Urgent</option>
            <option value="3">P3 Routine</option>
            <option value="4">P4 Deferred</option>
          </Select>
        </div>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm">
          <input type="checkbox" name="requires_shutdown" className="size-4 accent-[var(--brass)]" /> Needs a shutdown
        </label>
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Adding…" : "Add WCE"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
