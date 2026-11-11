import { normalizeTag, type WorklogRecord } from "../tasks/worklog-schema";

/**
 * Scoring for work-log extraction against a key.
 *
 *  - asset tag and enum fields: exact match
 *  - free-text fields: token-level F1 (a soft signal; wording differs)
 *  - readings and parts: F1 over matched items, numbers compared exactly
 *  - hallucinations: every value the model gave where the key has none
 *
 * A row the model failed on (no output) scores zero on every field.
 */

/** One row of an eval set, in the shape of `eval_set_v0.1.jsonl`. Only `id`, `text` and `answer` are required. */
export interface WorklogEvalRow {
  id: string;
  text: string;
  answer: WorklogRecord;
  site?: string;
  trade?: string;
  record_type?: string;
  quality?: string;
  split?: string;
}

const EXACT_FIELDS = ["asset_tag", "asset_type", "failure_mode", "loto_applied", "follow_up_needed", "status"] as const;
const TEXT_FIELDS = ["symptom", "cause", "action", "follow_up_note"] as const;
const LIST_FIELDS = ["parts", "readings"] as const;
export const SCORED_FIELDS = [...EXACT_FIELDS, ...TEXT_FIELDS, ...LIST_FIELDS] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9.]+/g) ?? [];

/** Token-level F1 between two strings. Two empty values agree; one empty value does not. */
export function tokenF1(pred: string | null, key: string | null): number {
  if (pred === null && key === null) return 1;
  if (pred === null || key === null) return 0;
  const p = tokens(pred);
  const k = tokens(key);
  if (p.length === 0 || k.length === 0) return p.length === k.length ? 1 : 0;
  const remaining = new Map<string, number>();
  for (const t of k) remaining.set(t, (remaining.get(t) ?? 0) + 1);
  let overlap = 0;
  for (const t of p) {
    const left = remaining.get(t) ?? 0;
    if (left > 0) {
      overlap += 1;
      remaining.set(t, left - 1);
    }
  }
  if (overlap === 0) return 0;
  const precision = overlap / p.length;
  const recall = overlap / k.length;
  return (2 * precision * recall) / (precision + recall);
}

/** F1 over two lists, pairing each predicted item with at most one key item. Two empty lists agree. */
function listF1<T>(pred: T[], key: T[], same: (a: T, b: T) => boolean): { f1: number; extra: number } {
  if (pred.length === 0 && key.length === 0) return { f1: 1, extra: 0 };
  const unmatched = [...key];
  let hits = 0;
  for (const p of pred) {
    const i = unmatched.findIndex((k) => same(p, k));
    if (i >= 0) {
      hits += 1;
      unmatched.splice(i, 1);
    }
  }
  const extra = pred.length - hits;
  if (hits === 0) return { f1: 0, extra };
  const precision = hits / pred.length;
  const recall = hits / key.length;
  return { f1: (2 * precision * recall) / (precision + recall), extra };
}

const unitOf = (u: string | null) => (u ?? "").toLowerCase().replace(/\s/g, "");
const sameReading = (a: WorklogRecord["readings"][number], b: WorklogRecord["readings"][number]) =>
  a.value === b.value && a.state === b.state && unitOf(a.unit) === unitOf(b.unit);
const samePart = (a: WorklogRecord["parts"][number], b: WorklogRecord["parts"][number]) => a.qty === b.qty && tokenF1(a.name, b.name) >= 0.5;

export interface RowScore {
  id: string;
  failed: boolean;
  fields: Record<ScoredField, number>;
  /** Mean of the field scores. */
  score: number;
  /** Values given where the key has none: a field that should be empty, or an extra part or reading. */
  hallucinations: number;
}

export function scoreRow(id: string, pred: WorklogRecord | null, key: WorklogRecord): RowScore {
  if (pred === null) {
    const zero = Object.fromEntries(SCORED_FIELDS.map((f) => [f, 0])) as Record<ScoredField, number>;
    return { id, failed: true, fields: zero, score: 0, hallucinations: 0 };
  }
  const fields = {} as Record<ScoredField, number>;
  let hallucinations = 0;

  for (const f of EXACT_FIELDS) {
    const same = f === "asset_tag" && pred.asset_tag !== null && key.asset_tag !== null ? normalizeTag(pred.asset_tag) === normalizeTag(key.asset_tag) : pred[f] === key[f];
    fields[f] = same ? 1 : 0;
  }
  for (const f of TEXT_FIELDS) fields[f] = tokenF1(pred[f], key[f]);
  for (const f of ["asset_tag", "asset_type", "failure_mode", "loto_applied", ...TEXT_FIELDS] as const) {
    if (key[f] === null && pred[f] !== null) hallucinations += 1;
  }

  const parts = listF1(pred.parts, key.parts, samePart);
  const readings = listF1(pred.readings, key.readings, sameReading);
  fields.parts = parts.f1;
  fields.readings = readings.f1;
  hallucinations += parts.extra + readings.extra;

  const score = SCORED_FIELDS.reduce((sum, f) => sum + fields[f], 0) / SCORED_FIELDS.length;
  return { id, failed: false, fields, score, hallucinations };
}

export interface GroupScore {
  rows: number;
  score: number;
  hallucinationRate: number;
}

export interface EvalReport {
  rows: number;
  failed: number;
  /** Mean row score, 0 to 1. */
  score: number;
  fields: Record<ScoredField, number>;
  /** Share of rows with at least one hallucination. */
  hallucinationRate: number;
  hallucinations: number;
  by: Record<"quality" | "site" | "trade", Record<string, GroupScore>>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarize(rows: WorklogEvalRow[], scores: RowScore[]): EvalReport {
  const byId = new Map(scores.map((s) => [s.id, s]));
  const scored = rows.flatMap((row) => {
    const s = byId.get(row.id);
    return s ? [{ row, s }] : [];
  });
  const group = (key: "quality" | "site" | "trade") => {
    const out: Record<string, GroupScore> = {};
    for (const value of new Set(scored.map((x) => x.row[key] ?? "unlabeled"))) {
      const members = scored.filter((x) => (x.row[key] ?? "unlabeled") === value).map((x) => x.s);
      out[value] = { rows: members.length, score: mean(members.map((m) => m.score)), hallucinationRate: mean(members.map((m) => (m.hallucinations > 0 ? 1 : 0))) };
    }
    return out;
  };
  const all = scored.map((x) => x.s);
  return {
    rows: all.length,
    failed: all.filter((s) => s.failed).length,
    score: mean(all.map((s) => s.score)),
    fields: Object.fromEntries(SCORED_FIELDS.map((f) => [f, mean(all.map((s) => s.fields[f]))])) as Record<ScoredField, number>,
    hallucinationRate: mean(all.map((s) => (s.hallucinations > 0 ? 1 : 0))),
    hallucinations: all.reduce((sum, s) => sum + s.hallucinations, 0),
    by: { quality: group("quality"), site: group("site"), trade: group("trade") },
  };
}
