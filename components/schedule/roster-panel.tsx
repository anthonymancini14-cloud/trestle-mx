"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/primitives";
import { addTimeOff, setSchedulerRoles, updateShift } from "@/lib/actions";
import { cn, formatDay } from "@/lib/utils";
import { CRAFT_LABELS, ROLE_LABELS, ROLES, type CrewMember, type Role } from "@/types/domain";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Display order Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** The technician roster that sets calendar capacity: shifts and time off (TMX-016). */
export function RosterPanel({ crew, canEdit, today }: { crew: CrewMember[]; canEdit: boolean; today: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [addingOff, setAddingOff] = useState(false);
  const weekly = crew.reduce((s, m) => s + (m.shift ? m.shift.shift_hours * m.shift.work_days.length : 0), 0);

  return (
    <section aria-label="Crew roster" className="rounded-[3px] border border-line bg-panel">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-4 py-2.5">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-brass-dim">Capacity</div>
          <h2 className="font-display text-lg font-semibold uppercase tracking-wide">Crew roster</h2>
          <p className="text-xs text-tx-3">
            {crew.length} technicians · {weekly} h a week before time off. Each tech&apos;s shift and time off set the hours available per craft.
          </p>
        </div>
        {canEdit && !addingOff && (
          <Button size="sm" onClick={() => setAddingOff(true)}>
            Add time off
          </Button>
        )}
      </header>
      {addingOff && <TimeOffForm crew={crew} today={today} onClose={() => setAddingOff(false)} />}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-tx-3">
              <th className="border-b border-line bg-panel-2 px-3 py-2 font-semibold">Technician</th>
              <th className="border-b border-line bg-panel-2 px-3 py-2 font-semibold">Craft</th>
              <th className="border-b border-line bg-panel-2 px-3 py-2 font-semibold">Shift</th>
              <th className="border-b border-line bg-panel-2 px-3 py-2 font-semibold">Time off (upcoming)</th>
              {canEdit && <th className="border-b border-line bg-panel-2 px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {crew.map((m) => {
              const upcoming = m.time_off.filter((t) => t.ends_on >= today);
              return (
                <tr key={m.id} className="align-top">
                  <td className="border-b border-line/60 px-3 py-2">{m.full_name}</td>
                  <td className="border-b border-line/60 px-3 py-2 text-tx-2">{m.craft ? CRAFT_LABELS[m.craft] : "—"}</td>
                  <td className="border-b border-line/60 px-3 py-2">
                    {editing === m.id ? (
                      <ShiftForm member={m} onClose={() => setEditing(null)} />
                    ) : m.shift ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{m.shift.shift_hours} h</span>
                        <span className="flex gap-0.5" aria-label={`Works ${m.shift.work_days.map((d) => DAYS[d]).join(", ")}`}>
                          {WEEK.map((d) => (
                            <span
                              key={d}
                              className={cn(
                                "w-7 rounded-[2px] border text-center text-[10px]",
                                m.shift!.work_days.includes(d) ? "border-brass-dim bg-brass/10 text-brass-bright" : "border-line text-tx-3",
                              )}
                            >
                              {DAYS[d].slice(0, 2)}
                            </span>
                          ))}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-warn">No shift set; counts as zero hours</span>
                    )}
                  </td>
                  <td className="border-b border-line/60 px-3 py-2 text-xs text-tx-2">
                    {upcoming.length === 0
                      ? "—"
                      : upcoming.map((t) => (
                          <div key={t.id}>
                            {formatDay(t.starts_on)}
                            {t.ends_on !== t.starts_on && `–${formatDay(t.ends_on)}`} · {t.reason}
                            {t.hours_per_day !== null && ` (${t.hours_per_day} h/day)`}
                          </div>
                        ))}
                  </td>
                  {canEdit && (
                    <td className="border-b border-line/60 px-3 py-2 text-right">
                      {editing !== m.id && (
                        <button type="button" className="text-xs text-brass hover:text-brass-bright" onClick={() => setEditing(m.id)}>
                          Edit shift
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ShiftForm({ member, onClose }: { member: CrewMember; onClose: () => void }) {
  const [hours, setHours] = useState(String(member.shift?.shift_hours ?? 8));
  const [days, setDays] = useState<number[]>(member.shift?.work_days ?? [1, 2, 3, 4, 5]);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateShift({ profileId: member.id, shiftHours: Number(hours), workDays: days });
          if (r.ok) onClose();
          else setError(r.error);
        });
      }}
    >
      <div className="space-y-0.5">
        <Label htmlFor={`h-${member.id}`}>Hours</Label>
        <Input id={`h-${member.id}`} type="number" min={1} max={16} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} className="h-9 w-20" />
      </div>
      <fieldset className="flex gap-0.5">
        <legend className="sr-only">Work days</legend>
        {WEEK.map((d) => (
          <label
            key={d}
            className={cn(
              "flex h-9 w-9 cursor-pointer items-center justify-center rounded-[2px] border text-[11px]",
              days.includes(d) ? "border-brass bg-brass/15 text-brass-bright" : "border-line text-tx-3",
            )}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={days.includes(d)}
              onChange={(e) => setDays((p) => (e.target.checked ? [...p, d] : p.filter((x) => x !== d)))}
            />
            {DAYS[d].slice(0, 2)}
          </label>
        ))}
      </fieldset>
      <Button size="sm" variant="primary" type="submit" disabled={busy}>
        Save
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={onClose}>
        Cancel
      </Button>
      {error && <p className="w-full text-xs text-bad">{error}</p>}
    </form>
  );
}

function TimeOffForm({ crew, today, onClose }: { crew: CrewMember[]; today: string; onClose: () => void }) {
  const rostered = crew.filter((m) => m.shift);
  const [profileId, setProfileId] = useState(rostered[0]?.id ?? "");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [whole, setWhole] = useState(true);
  const [hours, setHours] = useState("4");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="grid gap-2 border-b border-line bg-panel-2 px-4 py-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addTimeOff({ profileId, startsOn, endsOn, hoursPerDay: whole ? null : Number(hours), reason });
          if (r.ok) onClose();
          else setError(r.error);
        });
      }}
    >
      <div className="space-y-0.5">
        <Label htmlFor="off-who">Technician</Label>
        <Select id="off-who" value={profileId} onChange={(e) => setProfileId(e.target.value)} className="h-10">
          {rostered.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-0.5">
        <Label htmlFor="off-from">From</Label>
        <Input id="off-from" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="h-10" />
      </div>
      <div className="space-y-0.5">
        <Label htmlFor="off-to">To</Label>
        <Input id="off-to" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="h-10" />
      </div>
      <div className="space-y-0.5">
        <Label htmlFor="off-hours">Hours away</Label>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-tx-2">
            <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Whole shift
          </label>
          {!whole && (
            <Input id="off-hours" type="number" min={0.5} max={16} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} className="h-10 w-20" />
          )}
        </div>
      </div>
      <div className="space-y-0.5">
        <Label htmlFor="off-reason">Reason</Label>
        <Input id="off-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vacation, training…" className="h-10" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-bad sm:col-span-2 lg:col-span-6">{error}</p>}
    </form>
  );
}

/** Admin only: which roles may schedule at this site. Admin always can (TMX-015). */
export function SchedulerRolesForm({ current, siteName }: { current: Role[]; siteName: string }) {
  const [roles, setRoles] = useState<Role[]>(current);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const choices = ROLES.filter((r) => r !== "admin");
  return (
    <form
      className="rounded-[3px] border border-line bg-panel px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setSchedulerRoles(roles);
          setNote(r.ok ? "Saved." : r.error);
        });
      }}
    >
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend className="mb-1 text-sm">
          <span className="text-[11px] uppercase tracking-wider text-brass-dim">Admin setting · </span>
          Who can schedule at {siteName}
        </legend>
        <span className="text-xs text-tx-3">Admin (always)</span>
        {choices.map((r) => (
          <label key={r} className="flex min-h-11 items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={roles.includes(r)}
              onChange={(e) => setRoles((p) => (e.target.checked ? [...p, r] : p.filter((x) => x !== r)))}
            />
            {ROLE_LABELS[r]}
          </label>
        ))}
        <Button size="sm" variant="primary" type="submit" disabled={busy}>
          Save
        </Button>
        {note && (
          <span role="status" className="text-xs text-tx-2">
            {note}
          </span>
        )}
      </fieldset>
    </form>
  );
}
