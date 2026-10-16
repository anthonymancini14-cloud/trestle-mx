"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { createWorkOrder } from "@/lib/actions";

export function NewWorkOrderForm({
  assets,
  defaultAssetId,
}: {
  assets: { id: string; label: string }[];
  defaultAssetId?: string;
}) {
  const [state, action, pending] = useActionState(createWorkOrder, null);

  return (
    <form action={action} className="space-y-4 px-4 py-4">
      <div>
        <Label htmlFor="title">What&apos;s wrong?</Label>
        <Input id="title" name="title" required placeholder="Pump B inboard bearing running hot" />
      </div>
      <div>
        <Label htmlFor="asset_id">Equipment</Label>
        <Select id="asset_id" name="asset_id" defaultValue={defaultAssetId ?? ""}>
          <option value="">Not sure / no tag</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="description">What did you see, hear or measure?</Label>
        <Textarea
          id="description"
          name="description"
          rows={4}
          required
          placeholder="Readings, sounds, leaks, alarms, when it started. Specifics make a better plan."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="wo_type">Type</Label>
          <Select id="wo_type" name="wo_type" defaultValue="corrective">
            <option value="corrective">Corrective</option>
            <option value="emergency">Emergency</option>
            <option value="predictive">Predictive (condition finding)</option>
            <option value="preventive">Preventive</option>
            <option value="project">Project</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="priority">Priority</Label>
          <Select id="priority" name="priority" defaultValue="3">
            <option value="1">P1 Emergency: safety, environmental or production loss now</option>
            <option value="2">P2 Urgent: within days</option>
            <option value="3">P3 Routine: next schedule</option>
            <option value="4">P4 Deferred: opportunity work</option>
          </Select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-tx-2">
        <input type="checkbox" name="requires_shutdown" className="size-4 accent-[var(--brass)]" />
        Likely needs the equipment out of service
      </label>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Submitting…" : "Create work order"}
      </Button>
    </form>
  );
}
