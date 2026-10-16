"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Panel, PanelHeader, Select, Textarea } from "@/components/ui/primitives";
import {
  authorizeWorkOrder,
  closeWorkOrder,
  rejectWorkOrder,
  scheduleWorkOrder,
  submitCompletion,
  submitForVetting,
  type ActionResult,
} from "@/lib/actions";
import type { WoAction } from "@/lib/workflow";
import type { Profile } from "@/types/domain";

/** The stage-appropriate action for the current role. Server actions re-check every rule. */
export function WoActions({
  woId,
  actions,
  technicians,
  estimatedHours,
  openTasks,
}: {
  woId: string;
  actions: WoAction[];
  technicians: Profile[];
  estimatedHours: number | null;
  openTasks: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [assignee, setAssignee] = useState(technicians[0]?.id ?? "");
  const [hours, setHours] = useState(estimatedHours ? String(estimatedHours) : "");
  const [debrief, setDebrief] = useState("");

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error);
    });

  const visible = actions.filter((a) => a !== "complete_task" && a !== "issue_part");
  if (visible.length === 0) {
    return (
      <Panel>
        <PanelHeader title="Next step" />
        <p className="px-4 py-3 text-sm text-tx-3">
          Nothing for your role at this stage. Switch roles from the top bar to move it along.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="border-brass-dim">
      <PanelHeader eyebrow="Your move" title="Next step" />
      <div className="space-y-4 px-4 py-3">
        {visible.includes("submit_for_vetting") && (
          <div className="space-y-2">
            <p className="text-sm text-tx-2">Send this to the gatekeeper to authorize or reject.</p>
            <Button variant="primary" className="w-full" disabled={pending} onClick={() => run(() => submitForVetting(woId))}>
              Submit for vetting
            </Button>
          </div>
        )}

        {visible.includes("authorize") && (
          <div className="space-y-2">
            <p className="text-sm text-tx-2">Is this real, not a duplicate, and worth a planner&apos;s time?</p>
            <Button variant="primary" className="w-full" disabled={pending} onClick={() => run(() => authorizeWorkOrder(woId))}>
              Authorize for planning
            </Button>
            <Label htmlFor="reject-note" className="pt-2">
              Or reject with a reason
            </Label>
            <Textarea id="reject-note" rows={2} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Duplicate of WO-…, or not a maintenance issue" />
            <Button variant="danger" size="sm" disabled={pending} onClick={() => run(() => rejectWorkOrder(woId, rejectNote))}>
              Reject
            </Button>
          </div>
        )}

        {visible.includes("plan") && (
          <div className="space-y-2">
            <p className="text-sm text-tx-2">Build the job plan with Claude, grounded in standards, site history and stock.</p>
            <Button asChild variant="primary" className="w-full">
              <Link href={`/planning/${woId}`}>
                <Sparkles aria-hidden /> Open Planning Mode
              </Link>
            </Button>
          </div>
        )}

        {visible.includes("schedule") && (
          <div className="space-y-2">
            <div>
              <Label htmlFor="sched-date">Date</Label>
              <Input id="sched-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sched-tech">Lead technician</Label>
              <Select id="sched-tech" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name} ({t.craft})
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="primary" className="w-full" disabled={pending} onClick={() => run(() => scheduleWorkOrder(woId, date, assignee))}>
              Schedule and kit parts
            </Button>
          </div>
        )}

        {visible.includes("submit_completion") && (
          <div className="space-y-2">
            <p className="text-sm text-tx-2">
              {openTasks > 0 ? `${openTasks} step${openTasks === 1 ? "" : "s"} still open.` : "All steps complete."} Submit for supervisor close-out.
            </p>
            <Button variant="primary" size="lg" className="w-full" disabled={pending || openTasks > 0} onClick={() => run(() => submitCompletion(woId))}>
              Work complete
            </Button>
          </div>
        )}

        {visible.includes("close") && (
          <div className="space-y-2">
            <div>
              <Label htmlFor="close-hours">Actual crew-hours</Label>
              <Input id="close-hours" type="number" min={0} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="close-debrief">After-action debrief</Label>
              <Textarea
                id="close-debrief"
                rows={4}
                value={debrief}
                onChange={(e) => setDebrief(e.target.value)}
                placeholder="What was found, what differed from the plan, what the next planner should know."
              />
              <p className="mt-1 text-[11px] text-tx-3">Planning Mode reads this the next time this equipment comes up.</p>
            </div>
            <Button variant="primary" className="w-full" disabled={pending} onClick={() => run(() => closeWorkOrder(woId, Number(hours), debrief))}>
              Close work order
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-[3px] border border-bad/40 bg-bad/10 px-2.5 py-2 text-xs text-bad">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
