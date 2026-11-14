"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Stat, StatGrid } from "@/components/costs/stat";
import { EmptyState, Input, Label, Panel, PanelHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { logLabor } from "@/lib/actions";
import { formatMoney, formatRate, type WoCost } from "@/lib/cost";
import { cn, formatDate } from "@/lib/utils";
import { CRAFT_LABELS, CRAFTS, type Craft, type WoLabor } from "@/types/domain";

interface Person {
  id: string;
  full_name: string;
  craft: Craft | null;
}

const NOT_ON_ROSTER = "none";

/**
 * Hours on the work order and what the job has cost so far. The totals are
 * worked out on the server (lib/cost.ts); this only shows them and takes new
 * entries.
 */
export function LaborPanel({
  woId,
  labor,
  cost,
  estimatedHours,
  legacyHours,
  canLog,
  ownOnly,
  self,
  people,
  today,
  earliest,
}: {
  woId: string;
  labor: (WoLabor & { person_name: string | null })[];
  cost: WoCost;
  estimatedHours: number | null;
  /** Hours recorded at close-out before labor was itemized. Shown when there are no entries. */
  legacyHours: number | null;
  canLog: boolean;
  /** A technician logs their own hours only. */
  ownOnly: boolean;
  self: Person;
  people: Person[];
  today: string;
  earliest: string;
}) {
  const [personId, setPersonId] = useState(ownOnly || people.some((p) => p.id === self.id) ? self.id : (people[0]?.id ?? NOT_ON_ROSTER));
  const craftOf = (id: string): Craft => people.find((p) => p.id === id)?.craft ?? (id === self.id ? self.craft : null) ?? (id === NOT_ON_ROSTER ? "contractor" : "mechanical");
  const [craft, setCraft] = useState<Craft>(craftOf(personId));
  const [hours, setHours] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await logLabor(woId, { profile_id: personId === NOT_ON_ROSTER ? null : personId, craft, hours: Number(hours), work_date: date, note });
      setError(res.ok ? null : res.error);
      if (res.ok) {
        setHours("");
        setNote("");
      }
    });

  const over = estimatedHours !== null && cost.laborHours > estimatedHours;

  return (
    <Panel>
      <PanelHeader eyebrow="Labor and cost" title="Hours and cost" actions={<span className="font-mono text-sm text-brass-bright">{formatMoney(cost.total)}</span>} />
      <StatGrid className="sm:grid-cols-4">
        <Stat label="Hours logged" value={`${cost.laborHours} h`} note={estimatedHours !== null ? `of ${estimatedHours} h estimated` : "No estimate"} tone={over ? "warn" : undefined} />
        <Stat label="Labor" value={formatMoney(cost.laborCost)} note={cost.unratedHours ? `${cost.unratedHours} h have no rate` : "At each craft's rate"} tone={cost.unratedHours ? "warn" : undefined} />
        <Stat label="Parts" value={formatMoney(cost.partsCost)} note={cost.unpricedParts ? `${cost.unpricedParts} issued with no price` : "Issued parts"} tone={cost.unpricedParts ? "warn" : undefined} />
        <Stat label="Total" value={formatMoney(cost.total)} note={cost.unratedHours || cost.unpricedParts ? "Understated: see the gaps" : "Labor plus parts"} />
      </StatGrid>

      {labor.length === 0 ? (
        <EmptyState>
          {legacyHours !== null
            ? `${legacyHours} h were recorded at close-out, before hours were logged by person. There is no cost for them.`
            : "No hours logged yet."}
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-28">Date</Th>
              <Th>Who</Th>
              <Th className="w-36">Craft</Th>
              <Th className="w-20 text-right">Hours</Th>
              <Th className="w-24 text-right">Rate</Th>
              <Th className="w-24 text-right">Cost</Th>
            </tr>
          </thead>
          <tbody>
            {labor.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap text-xs text-tx-2">{formatDate(l.work_date)}</Td>
                <Td>
                  {l.person_name ?? <span className="text-tx-3">Crew not on the roster</span>}
                  {l.note && <div className="text-xs text-tx-3">{l.note}</div>}
                </Td>
                <Td className="text-xs text-tx-2">{CRAFT_LABELS[l.craft]}</Td>
                <Td className={cn("text-right font-mono text-xs", l.hours < 0 && "text-warn")}>{l.hours}</Td>
                <Td className="text-right font-mono text-xs text-tx-2">{l.hourly_rate === null ? <span className="text-warn">No rate</span> : formatRate(l.hourly_rate)}</Td>
                <Td className="text-right font-mono text-xs">{l.hourly_rate === null ? "—" : formatMoney(l.hours * l.hourly_rate)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {canLog && (
        <form
          className="grid gap-3 border-t border-line px-4 py-3 sm:grid-cols-[1fr_1fr_5.5rem_9.5rem]"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <Label htmlFor="labor-person">Who</Label>
            {ownOnly ? (
              <p id="labor-person" className="flex h-9 items-center text-sm">
                {self.full_name}
              </p>
            ) : (
              <Select
                id="labor-person"
                value={personId}
                onChange={(e) => {
                  setPersonId(e.target.value);
                  setCraft(craftOf(e.target.value));
                }}
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
                <option value={NOT_ON_ROSTER}>Crew not on the roster</option>
              </Select>
            )}
          </div>
          <div>
            <Label htmlFor="labor-craft">Craft</Label>
            <Select id="labor-craft" value={craft} onChange={(e) => setCraft(e.target.value as Craft)}>
              {CRAFTS.map((c) => (
                <option key={c} value={c}>
                  {CRAFT_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="labor-hours">Hours</Label>
            <Input id="labor-hours" type="number" step={0.25} min={-24} max={24} value={hours} onChange={(e) => setHours(e.target.value)} className="font-mono" />
          </div>
          <div>
            <Label htmlFor="labor-date">Work date</Label>
            <Input id="labor-date" type="date" min={earliest} max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="labor-note">Note</Label>
            <Input id="labor-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional. Required for a correction (negative hours)." />
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="primary" className="w-full" disabled={pending || !hours || Number(hours) === 0}>
              {pending ? "Logging…" : "Log hours"}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-bad sm:col-span-4">
              {error}
            </p>
          )}
        </form>
      )}
    </Panel>
  );
}
