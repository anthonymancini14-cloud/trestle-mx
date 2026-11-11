"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { reviewAiRun } from "@/lib/actions";
import { ASSET_TYPES, enumLabel, READING_STATES, WORKLOG_FAILURE_MODES, WORKLOG_STATUSES, type WorklogRecord } from "@/lib/ai/tasks/worklog-schema";

type Draft = Omit<WorklogRecord, "parts" | "readings"> & {
  parts: { name: string; qty: string }[];
  readings: { name: string; value: string; unit: string; state: WorklogRecord["readings"][number]["state"] }[];
};

const toDraft = (r: WorklogRecord): Draft => ({
  ...r,
  parts: r.parts.map((p) => ({ name: p.name, qty: p.qty === null ? "" : String(p.qty) })),
  readings: r.readings.map((x) => ({ name: x.name, value: String(x.value), unit: x.unit ?? "", state: x.state })),
});

const blankToNull = (s: string | null) => (s === null || s.trim() === "" ? null : s.trim());

/** The draft as a record, or the reason it can't be one yet. */
function fromDraft(d: Draft): WorklogRecord | string {
  const parts = [];
  for (const p of d.parts) {
    if (!p.name.trim()) return "Name each part, or remove the empty row.";
    const qty = p.qty.trim() === "" ? null : Number(p.qty);
    if (qty !== null && !Number.isFinite(qty)) return `The quantity for ${p.name} is not a number.`;
    parts.push({ name: p.name.trim(), qty });
  }
  const readings = [];
  for (const r of d.readings) {
    if (!r.name.trim()) return "Name each reading, or remove the empty row.";
    const value = Number(r.value);
    if (r.value.trim() === "" || !Number.isFinite(value)) return `The value for ${r.name} is not a number.`;
    readings.push({ name: r.name.trim(), value, unit: blankToNull(r.unit), state: r.state });
  }
  return {
    ...d,
    asset_tag: blankToNull(d.asset_tag),
    symptom: blankToNull(d.symptom),
    cause: blankToNull(d.cause),
    action: blankToNull(d.action),
    follow_up_note: blankToNull(d.follow_up_note),
    parts,
    readings,
  };
}

function EnumSelect<T extends string>({ id, value, options, empty, onChange }: { id: string; value: T | null; options: readonly T[]; empty?: string; onChange: (v: T | null) => void }) {
  return (
    <Select id={id} value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as T | null)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {enumLabel(o)}
        </option>
      ))}
    </Select>
  );
}

/**
 * Review a finished run: accept it as it is, correct it field by field, or
 * reject it with a reason. Nothing a model returned counts until this is done.
 */
export function ReviewPanel({ jobId, record, reviewed }: { jobId: string; record: WorklogRecord; reviewed: boolean }) {
  const [mode, setMode] = useState<"idle" | "correct" | "reject">("idle");
  const [draft, setDraft] = useState<Draft>(() => toDraft(record));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (verdict: "accepted" | "corrected" | "rejected", corrected?: WorklogRecord) =>
    start(async () => {
      const res = await reviewAiRun({ jobId, verdict, corrected, note });
      setError(res.ok ? null : res.error);
      if (res.ok) {
        setMode("idle");
        setNote("");
      }
    });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const text = (key: "asset_tag" | "symptom" | "cause" | "action" | "follow_up_note") => ({
    id: `fix-${key}`,
    value: draft[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value),
  });

  const errorLine = error && (
    <p role="alert" className="text-sm text-bad">
      {error}
    </p>
  );

  if (mode === "idle") {
    return (
      <div className="space-y-2 px-4 py-3">
        {errorLine}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" disabled={pending} onClick={() => send("accepted")}>
            <Check aria-hidden /> {reviewed ? "Accept the model's record" : "Accept as is"}
          </Button>
          <Button type="button" disabled={pending} onClick={() => setMode("correct")}>
            <Pencil aria-hidden /> Correct
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setMode("reject")}>
            <X aria-hidden /> Reject
          </Button>
        </div>
        <p className="text-xs text-tx-3">
          {reviewed ? "A new review replaces the current one. Both stay on record." : "Compare each field with the text. Accept only what the entry actually says."}
        </p>
      </div>
    );
  }

  if (mode === "reject") {
    return (
      <div className="space-y-2 px-4 py-3">
        <Label htmlFor="reject-note">Why it&apos;s rejected</Label>
        <Textarea id="reject-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not a maintenance entry; two jobs in one entry; unreadable…" />
        {errorLine}
        <div className="flex gap-2">
          <Button type="button" variant="danger" disabled={pending} onClick={() => send("rejected")}>
            <X aria-hidden /> Reject
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setMode("idle")}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-3 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fixed = fromDraft(draft);
        if (typeof fixed === "string") setError(fixed);
        else send("corrected", fixed);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="fix-asset_tag">Asset tag</Label>
          <Input {...text("asset_tag")} placeholder="Empty if the text has no tag" className="font-mono" />
        </div>
        <div>
          <Label htmlFor="fix-asset_type">Asset type</Label>
          <EnumSelect id="fix-asset_type" value={draft.asset_type} options={ASSET_TYPES} empty="Not in the text" onChange={(v) => set("asset_type", v)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="fix-symptom">Symptom</Label>
          <Input {...text("symptom")} />
        </div>
        <div>
          <Label htmlFor="fix-failure_mode">Failure mode</Label>
          <EnumSelect id="fix-failure_mode" value={draft.failure_mode} options={WORKLOG_FAILURE_MODES} empty="Not in the text" onChange={(v) => set("failure_mode", v)} />
        </div>
        <div>
          <Label htmlFor="fix-status">Status</Label>
          <EnumSelect id="fix-status" value={draft.status} options={WORKLOG_STATUSES} onChange={(v) => v && set("status", v)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="fix-cause">Cause</Label>
          <Input {...text("cause")} placeholder="Only if the text states it" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="fix-action">Action</Label>
          <Input {...text("action")} />
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium text-tx-2">Parts used</legend>
        {draft.parts.map((p, i) => (
          <div key={i} className="flex gap-2">
            <Input aria-label={`Part ${i + 1} quantity`} value={p.qty} onChange={(e) => set("parts", draft.parts.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} placeholder="Qty" inputMode="decimal" className="w-20 font-mono" />
            <Input aria-label={`Part ${i + 1} name`} value={p.name} onChange={(e) => set("parts", draft.parts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Part" />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove part ${i + 1}`} onClick={() => set("parts", draft.parts.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={() => set("parts", [...draft.parts, { name: "", qty: "" }])}>
          <Plus aria-hidden /> Add part
        </Button>
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium text-tx-2">Readings</legend>
        {draft.readings.map((r, i) => {
          const patch = (change: Partial<Draft["readings"][number]>) => set("readings", draft.readings.map((x, j) => (j === i ? { ...x, ...change } : x)));
          return (
            <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
              <Input aria-label={`Reading ${i + 1} name`} value={r.name} onChange={(e) => patch({ name: e.target.value })} placeholder="What was measured" className="min-w-40" />
              <Input aria-label={`Reading ${i + 1} value`} value={r.value} onChange={(e) => patch({ value: e.target.value })} placeholder="Value" inputMode="decimal" className="w-24 font-mono" />
              <Input aria-label={`Reading ${i + 1} unit`} value={r.unit} onChange={(e) => patch({ unit: e.target.value })} placeholder="Unit" className="w-20 font-mono" />
              <Select aria-label={`Reading ${i + 1} state`} value={r.state} onChange={(e) => patch({ state: e.target.value as Draft["readings"][number]["state"] })} className="w-32">
                {READING_STATES.map((s) => (
                  <option key={s} value={s}>
                    {enumLabel(s)}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove reading ${i + 1}`} onClick={() => set("readings", draft.readings.filter((_, j) => j !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          );
        })}
        <Button type="button" variant="ghost" size="sm" onClick={() => set("readings", [...draft.readings, { name: "", value: "", unit: "", state: "single" }])}>
          <Plus aria-hidden /> Add reading
        </Button>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="fix-loto">Lockout applied</Label>
          <Select id="fix-loto" value={draft.loto_applied === null ? "" : draft.loto_applied ? "yes" : "no"} onChange={(e) => set("loto_applied", e.target.value === "" ? null : e.target.value === "yes")}>
            <option value="">Not mentioned</option>
            <option value="yes">Yes, the text says so</option>
            <option value="no">No, the text says it was not</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="fix-follow">Follow-up needed</Label>
          <Select id="fix-follow" value={draft.follow_up_needed ? "yes" : "no"} onChange={(e) => set("follow_up_needed", e.target.value === "yes")}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="fix-follow_up_note">Follow-up note</Label>
          <Input {...text("follow_up_note")} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="fix-note">What was wrong (optional)</Label>
          <Input id="fix-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="The jar was ordered, not installed" />
        </div>
      </div>

      {errorLine}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          <Check aria-hidden /> Save correction
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setDraft(toDraft(record));
            setError(null);
            setMode("idle");
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
