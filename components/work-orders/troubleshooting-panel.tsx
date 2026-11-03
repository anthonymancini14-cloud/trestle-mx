"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, ClipboardCheck, FlaskConical, MessageSquarePlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, Panel, PanelHeader, Select, Textarea } from "@/components/ui/primitives";
import { addAddendum, addFinding, addOperatorAction, recordResolution, type ActionResult } from "@/lib/actions";
import { cn, formatDateTime } from "@/lib/utils";
import { OPERATOR_REVIEW_LABELS, OPERATOR_REVIEWS, type FindingResult, type OperatorReview, type TroubleshootingRecord } from "@/types/domain";

type Code = { code: string; name: string };
type Form = "action" | "finding" | "resolution" | "addendum" | null;

const RESULT_STYLE: Record<FindingResult, string> = {
  pass: "border-good/50 text-good",
  fail: "border-warn/60 text-warn",
  info: "border-line-strong text-tx-3",
};

/**
 * The troubleshooting record for one WCE: what the operator saw and tried, each
 * test the tradesman made, and the proven cause. Entries are never edited; a
 * correction is a new entry that points at the one it corrects.
 */
export function TroubleshootingPanel({
  woId,
  record,
  modes,
  mechanisms,
  causes,
  can,
  evidence,
}: {
  woId: string;
  record: TroubleshootingRecord;
  /** Failure modes from the asset's class. */
  modes: Code[];
  mechanisms: Code[];
  causes: Code[];
  can: { action: boolean; finding: boolean; resolution: boolean; addendum: boolean };
  /** Evidence to close: null when it doesn't apply; otherwise what's missing (or "" when met). */
  evidence: string | null;
}) {
  const [form, setForm] = useState<Form>(null);
  const [corrects, setCorrects] = useState<string | null>(null);
  const findingNo = new Map(record.findings.map((f, i) => [f.id, i + 1]));
  const corrected = new Set([...record.actions, ...record.findings].map((e) => e.corrects_id).filter(Boolean) as string[]);
  const current = record.resolutions[0] ?? null;
  const name = (list: Code[], code: string | null) => (code ? `${code} ${list.find((c) => c.code === code)?.name ?? ""}`.trim() : null);

  type Entry = { kind: "action"; at: string; e: TroubleshootingRecord["actions"][number] } | { kind: "finding"; at: string; e: TroubleshootingRecord["findings"][number] };
  const timeline: Entry[] = [
    ...record.actions.map((e) => ({ kind: "action" as const, at: e.created_at, e })),
    ...record.findings.map((e) => ({ kind: "finding" as const, at: e.created_at, e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const open = (f: Form, correctsId: string | null = null) => {
    setForm(f);
    setCorrects(correctsId);
  };

  return (
    <Panel>
      <PanelHeader
        eyebrow="Troubleshooting record"
        title="From symptom to proven cause"
        actions={
          evidence === null ? null : evidence === "" ? (
            <Badge className="border-good/50 text-good">Evidence to close: met</Badge>
          ) : (
            <Badge className="border-warn/60 text-warn">Evidence to close: needed</Badge>
          )
        }
      />
      {evidence && <p className="border-b border-line bg-warn/5 px-4 py-2 text-xs text-warn">{evidence}</p>}

      {timeline.length === 0 && !current ? (
        <p className="px-4 py-4 text-sm text-tx-3">Nothing recorded yet. Operators record what they saw and tried; technicians log each test as they go.</p>
      ) : (
        <ol className="divide-y divide-line/60">
          {timeline.map((t) => {
            const isCorrected = corrected.has(t.e.id);
            return (
              <li key={t.e.id} className={cn("grid grid-cols-[1.75rem_1fr] gap-2 px-4 py-2.5 text-sm", isCorrected && "opacity-55")}>
                {t.kind === "action" ? <UserRound className="mt-0.5 size-4 text-info" aria-label="Operator action" /> : <FlaskConical className="mt-0.5 size-4 text-brass" aria-label="Finding" />}
                <div className="min-w-0 space-y-0.5">
                  {t.kind === "action" ? (
                    <>
                      <p className={cn(isCorrected && "line-through")}>
                        <span className="text-tx-3">Saw: </span>
                        {t.e.conditions} <span className="text-tx-3">Did: </span>
                        {t.e.action}
                      </p>
                      <p className="text-tx-2">
                        <span className="text-tx-3">Result: </span>
                        {t.e.result}
                        {t.e.ran_minutes !== null && <span className="text-tx-3"> (ran {t.e.ran_minutes} min)</span>}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className={cn("flex flex-wrap items-center gap-x-2", isCorrected && "line-through")}>
                        <span className="font-mono text-xs text-brass-bright">F{findingNo.get(t.e.id)}</span>
                        <span>{t.e.test}</span>
                        {t.e.value !== null && (
                          <span className="font-mono text-xs">
                            {t.e.value} {t.e.unit}
                          </span>
                        )}
                        <Badge className={cn("uppercase", RESULT_STYLE[t.e.result])}>{t.e.result}</Badge>
                      </p>
                      {(t.e.spec || t.e.note) && (
                        <p className="text-xs text-tx-2">
                          {t.e.spec && <span className="text-tx-3">Spec: {t.e.spec}. </span>}
                          {t.e.note}
                        </p>
                      )}
                    </>
                  )}
                  <p className="flex flex-wrap gap-x-2 text-[11px] text-tx-3">
                    <span>
                      {t.e.author_name ?? "—"} · {formatDateTime(t.e.created_at)}
                    </span>
                    {t.e.corrects_id && <span className="text-info">Corrects an earlier entry</span>}
                    {isCorrected && <span>Corrected below</span>}
                    {!isCorrected && ((t.kind === "action" && can.action) || (t.kind === "finding" && can.finding)) && (
                      <button type="button" className="text-brass hover:text-brass-bright" onClick={() => open(t.kind, t.e.id)}>
                        Correct
                      </button>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
          {current && (
            <li className="space-y-1.5 bg-brass/[0.06] px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <CheckCircle2 className="size-4 text-good" aria-hidden />
                <span className="font-semibold">Resolution</span>
                {current.no_fault_found ? (
                  <Badge className="border-line-strong text-tx-2">No fault found</Badge>
                ) : (
                  <span className="font-mono text-xs text-tx-2">
                    {[name(modes, current.failure_mode), name(mechanisms, current.mechanism), name(causes, current.cause)].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              <p>
                <span className="text-tx-3">Cause: </span>
                {current.cause_narrative}
                {current.finding_ids.length > 0 && (
                  <span className="text-tx-3"> Supported by {current.finding_ids.map((id) => `F${findingNo.get(id) ?? "?"}`).join(", ")}.</span>
                )}
              </p>
              {current.remedy && (
                <p>
                  <span className="text-tx-3">Remedy: </span>
                  {current.remedy}
                </p>
              )}
              {current.verification && (
                <p>
                  <span className="text-tx-3">Verification: </span>
                  {current.verification}{" "}
                  {current.verification_passed !== null && (
                    <Badge className={current.verification_passed ? "border-good/50 text-good" : "border-bad/50 text-bad"}>{current.verification_passed ? "Pass" : "Fail"}</Badge>
                  )}
                </p>
              )}
              <p>
                <span className="text-tx-3">Operator action review: </span>
                {OPERATOR_REVIEW_LABELS[current.operator_review]}
                {current.operator_review_note && `. ${current.operator_review_note}`}
              </p>
              <p className="text-[11px] text-tx-3">
                {current.author_name ?? "—"} · {formatDateTime(current.created_at)}
                {record.resolutions.length > 1 && ` · replaces ${record.resolutions.length - 1} earlier resolution${record.resolutions.length > 2 ? "s" : ""}`}
              </p>
            </li>
          )}
        </ol>
      )}

      {(can.action || can.finding || can.resolution) && (
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
          {can.action && (
            <Button size="sm" variant={form === "action" ? "primary" : "secondary"} onClick={() => open("action")}>
              <UserRound aria-hidden /> Record operator action
            </Button>
          )}
          {can.finding && (
            <Button size="sm" variant={form === "finding" ? "primary" : "secondary"} onClick={() => open("finding")}>
              <FlaskConical aria-hidden /> Log a finding
            </Button>
          )}
          {can.resolution && (
            <Button size="sm" variant={form === "resolution" ? "primary" : "secondary"} onClick={() => open("resolution")}>
              <ClipboardCheck aria-hidden /> {current ? "Revise the resolution" : "Record the resolution"}
            </Button>
          )}
        </div>
      )}

      {form === "action" && <ActionForm woId={woId} correctsId={corrects} onDone={() => open(null)} />}
      {form === "finding" && <FindingForm woId={woId} correctsId={corrects} onDone={() => open(null)} />}
      {form === "resolution" && (
        <ResolutionForm
          woId={woId}
          findings={record.findings.filter((f) => !corrected.has(f.id)).map((f) => ({ id: f.id, label: `F${findingNo.get(f.id)} ${f.test}`, result: f.result }))}
          modes={modes}
          mechanisms={mechanisms}
          causes={causes}
          hasOperatorActions={record.actions.length > 0}
          onDone={() => open(null)}
        />
      )}

      {(record.addenda.length > 0 || can.addendum) && (
        <div className="border-t border-line">
          <div className="px-4 pt-2.5 text-[11px] uppercase tracking-wider text-brass-dim">Addenda</div>
          <p className="px-4 text-xs text-tx-3">The closed record above is never edited. Later information is added here, signed and dated.</p>
          <ol className="divide-y divide-line/60">
            {record.addenda.map((a) => (
              <li key={a.id} className="px-4 py-2 text-sm">
                <p className="whitespace-pre-line">{a.body}</p>
                <p className="text-[11px] text-tx-3">
                  {a.author_name ?? "—"} · {formatDateTime(a.created_at)}
                </p>
              </li>
            ))}
          </ol>
          {can.addendum &&
            (form === "addendum" ? (
              <AddendumForm woId={woId} onDone={() => open(null)} />
            ) : (
              <div className="px-4 py-2.5">
                <Button size="sm" onClick={() => open("addendum")}>
                  <MessageSquarePlus aria-hidden /> Add an addendum
                </Button>
              </div>
            ))}
        </div>
      )}
    </Panel>
  );
}

function useSave(onDone: () => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) onDone();
      else setError(r.error);
    });
  return { pending, error, save };
}

function FormShell({ title, note, children, pending, error, onCancel, onSubmit }: { title: string; note?: string; children: React.ReactNode; pending: boolean; error: string | null; onCancel: () => void; onSubmit: () => void }) {
  return (
    <form
      className="space-y-3 border-t border-line bg-panel-2 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div>
        <div className="text-sm font-semibold">{title}</div>
        {note && <p className="text-xs text-tx-3">{note}</p>}
      </div>
      {children}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ActionForm({ woId, correctsId, onDone }: { woId: string; correctsId: string | null; onDone: () => void }) {
  const [conditions, setConditions] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [ran, setRan] = useState("");
  const { pending, error, save } = useSave(onDone);
  return (
    <FormShell
      title={correctsId ? "Correct an operator action" : "Record an operator action"}
      note="What you saw and what you tried before maintenance arrived. Once saved it can't be edited; a correction is a new entry."
      pending={pending}
      error={error}
      onCancel={onDone}
      onSubmit={() => save(() => addOperatorAction(woId, { conditions, action, result, ranMinutes: ran ? Number(ran) : null, correctsId }))}
    >
      <div>
        <Label htmlFor="oa-cond">What was it doing?</Label>
        <Textarea id="oa-cond" rows={2} value={conditions} onChange={(e) => setConditions(e.target.value)} placeholder="Running state, alarms, readings" />
      </div>
      <div>
        <Label htmlFor="oa-action">What did you do?</Label>
        <Input id="oa-action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Reset the trip, switched to standby, cleaned the strainer…" className="h-11" />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <div>
          <Label htmlFor="oa-result">What happened?</Label>
          <Input id="oa-result" value={result} onChange={(e) => setResult(e.target.value)} placeholder="Cleared / came back / no effect" className="h-11" />
        </div>
        <div>
          <Label htmlFor="oa-ran">Ran for (min)</Label>
          <Input id="oa-ran" type="number" min={0} value={ran} onChange={(e) => setRan(e.target.value)} className="h-11" />
        </div>
      </div>
    </FormShell>
  );
}

function FindingForm({ woId, correctsId, onDone }: { woId: string; correctsId: string | null; onDone: () => void }) {
  const [test, setTest] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [spec, setSpec] = useState("");
  const [result, setResult] = useState<FindingResult>("fail");
  const [note, setNote] = useState("");
  const { pending, error, save } = useSave(onDone);
  return (
    <FormShell
      title={correctsId ? "Correct a finding" : "Log a finding"}
      note="One test, measurement or inspection per entry, in the order you did them."
      pending={pending}
      error={error}
      onCancel={onDone}
      onSubmit={() => save(() => addFinding(woId, { test, value: value === "" ? null : Number(value), unit, spec, result, note, correctsId }))}
    >
      <div>
        <Label htmlFor="f-test">Test or inspection</Label>
        <Input id="f-test" value={test} onChange={(e) => setTest(e.target.value)} placeholder="Motor insulation resistance at 1,000 V" className="h-11" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="f-value">Reading</Label>
          <Input id="f-value" type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="h-11" />
        </div>
        <div>
          <Label htmlFor="f-unit">Unit</Label>
          <Input id="f-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="MΩ, in/s, °F" className="h-11" />
        </div>
        <div>
          <Label htmlFor="f-result">Result</Label>
          <Select id="f-result" value={result} onChange={(e) => setResult(e.target.value as FindingResult)} className="h-11">
            <option value="fail">Fail</option>
            <option value="pass">Pass</option>
            <option value="info">Information</option>
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="f-spec">Spec or baseline</Label>
        <Input id="f-spec" value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="100 MΩ minimum; baseline 0.10 in/s" className="h-11" />
      </div>
      <div>
        <Label htmlFor="f-note">What it rules in or out</Label>
        <Input id="f-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Rules out the motor windings" className="h-11" />
      </div>
      <p className="text-[11px] text-tx-3">Photos on findings are designed, not built yet.</p>
    </FormShell>
  );
}

function ResolutionForm({
  woId,
  findings,
  modes,
  mechanisms,
  causes,
  hasOperatorActions,
  onDone,
}: {
  woId: string;
  findings: { id: string; label: string; result: FindingResult }[];
  modes: Code[];
  mechanisms: Code[];
  causes: Code[];
  hasOperatorActions: boolean;
  onDone: () => void;
}) {
  const [nff, setNff] = useState(false);
  const [mode, setMode] = useState("");
  const [mechanism, setMechanism] = useState("");
  const [cause, setCause] = useState("");
  const [linked, setLinked] = useState<string[]>(findings.filter((f) => f.result === "fail").map((f) => f.id));
  const [narrative, setNarrative] = useState("");
  const [remedy, setRemedy] = useState("");
  const [verification, setVerification] = useState("");
  const [passed, setPassed] = useState<"" | "pass" | "fail">("");
  const [review, setReview] = useState<OperatorReview>(hasOperatorActions ? "helped" : "none_taken");
  const [reviewNote, setReviewNote] = useState("");
  const { pending, error, save } = useSave(onDone);
  const codeSelect = (id: string, label: string, list: Code[], value: string, set: (v: string) => void) => (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e) => set(e.target.value)} className="h-11" disabled={nff}>
        <option value="">Pick…</option>
        {list.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} {c.name}
          </option>
        ))}
      </Select>
    </div>
  );
  return (
    <FormShell
      title="Resolution"
      note="The cause, the findings that prove it, the fix, and the test that proves the fix. A new resolution replaces the current one; the old one stays on record."
      pending={pending}
      error={error}
      onCancel={onDone}
      onSubmit={() =>
        save(() =>
          recordResolution(woId, {
            noFaultFound: nff,
            failureMode: mode || null,
            mechanism: mechanism || null,
            cause: cause || null,
            findingIds: linked,
            causeNarrative: narrative,
            remedy,
            verification: verification || null,
            verificationPassed: passed === "" ? null : passed === "pass",
            operatorReview: review,
            operatorReviewNote: reviewNote || null,
          }),
        )
      }
    >
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={nff} onChange={(e) => setNff(e.target.checked)} className="size-4 accent-[var(--brass)]" /> No fault found
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        {codeSelect("r-mode", "Failure mode", modes, mode, setMode)}
        {codeSelect("r-mech", "Mechanism", mechanisms, mechanism, setMechanism)}
        {codeSelect("r-cause", "Cause", causes, cause, setCause)}
      </div>
      <div>
        <Label htmlFor="r-why">{nff ? "What was checked and why no fault was found" : "Cause"}</Label>
        <Textarea id="r-why" rows={2} value={narrative} onChange={(e) => setNarrative(e.target.value)} placeholder="The bearing wore because of misalignment from cracked base grout." />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs text-tx-2">Findings that support the cause</legend>
        {findings.length === 0 && <p className="text-xs text-warn">No findings logged yet. Log the tests first, or record no fault found.</p>}
        {findings.map((f) => (
          <label key={f.id} className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={linked.includes(f.id)}
              onChange={(e) => setLinked((p) => (e.target.checked ? [...p, f.id] : p.filter((x) => x !== f.id)))}
              className="size-4 accent-[var(--brass)]"
            />
            {f.label}
          </label>
        ))}
      </fieldset>
      {!nff && (
        <>
          <div>
            <Label htmlFor="r-remedy">Remedy</Label>
            <Input id="r-remedy" value={remedy} onChange={(e) => setRemedy(e.target.value)} placeholder="Replaced the inboard bearing, regrouted, realigned to 0.002 in" className="h-11" />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div>
              <Label htmlFor="r-verify">Verification after the repair, with the reading</Label>
              <Input id="r-verify" value={verification} onChange={(e) => setVerification(e.target.value)} placeholder="Ran 4 h: 39 A, 0.08 in/s" className="h-11" />
            </div>
            <div>
              <Label htmlFor="r-pass">Result</Label>
              <Select id="r-pass" value={passed} onChange={(e) => setPassed(e.target.value as "" | "pass" | "fail")} className="h-11">
                <option value="">Pick…</option>
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
              </Select>
            </div>
          </div>
        </>
      )}
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <div>
          <Label htmlFor="r-review">Operator action</Label>
          <Select id="r-review" value={review} onChange={(e) => setReview(e.target.value as OperatorReview)} className="h-11">
            {OPERATOR_REVIEWS.map((r) => (
              <option key={r} value={r}>
                {OPERATOR_REVIEW_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="r-review-note">Why (feeds operator procedures)</Label>
          <Input id="r-review-note" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Switching to standby was right; the reset ran a failing bearing" className="h-11" />
        </div>
      </div>
    </FormShell>
  );
}

function AddendumForm({ woId, onDone }: { woId: string; onDone: () => void }) {
  const [body, setBody] = useState("");
  const { pending, error, save } = useSave(onDone);
  return (
    <FormShell title="Add an addendum" note="Signed and dated under the closed record." pending={pending} error={error} onCancel={onDone} onSubmit={() => save(() => addAddendum(woId, body))}>
      <Textarea aria-label="Addendum" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Follow-up readings, a late finding, what the next crew should know" />
    </FormShell>
  );
}
