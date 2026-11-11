import { z } from "zod";
import type { AiIssue } from "@/types/domain";

/**
 * The work-log record: what one free-text maintenance log entry turns into.
 * Pure data and checks, safe to import anywhere (the task that runs a model
 * is in worklog-extract.ts). Schema v0.2, the same one the extraction eval set is keyed to.
 * The rule that makes it honest: the record only contains what the text says.
 */
export const WORKLOG_SCHEMA_VERSION = "v0.2";

export const ASSET_TYPES = ["pump", "motor", "gearbox", "fan", "crah", "chiller", "ups", "pdu_rpp", "genset", "transmitter", "breaker_mcc", "valve", "other"] as const;

export const WORKLOG_FAILURE_MODES = [
  "bearing_wear",
  "misalignment",
  "seal_leak",
  "overheating",
  "electrical_trip",
  "insulation_degradation",
  "loose_connection",
  "calibration_drift",
  "refrigerant_leak",
  "battery_degradation",
  "fan_failure",
  "filter_restriction",
  "low_fluid",
  "sensor_fault",
  "no_fault_found",
  "other",
] as const;

export const READING_STATES = ["as_found", "as_left", "single", "spec"] as const;
export const WORKLOG_STATUSES = ["request", "complete", "partial", "no_fault_found"] as const;

export const worklogSchema = z.object({
  asset_tag: z.string().nullable(),
  asset_type: z.enum(ASSET_TYPES).nullable(),
  symptom: z.string().nullable(),
  failure_mode: z.enum(WORKLOG_FAILURE_MODES).nullable(),
  cause: z.string().nullable(),
  action: z.string().nullable(),
  parts: z.array(z.object({ name: z.string(), qty: z.number().nullable() })),
  readings: z.array(z.object({ name: z.string(), value: z.number(), unit: z.string().nullable(), state: z.enum(READING_STATES) })),
  loto_applied: z.boolean().nullable(),
  follow_up_needed: z.boolean(),
  follow_up_note: z.string().nullable(),
  status: z.enum(WORKLOG_STATUSES),
});

export type WorklogRecord = z.infer<typeof worklogSchema>;
export interface WorklogInput {
  text: string;
}

export const WORKLOG_FIELD_LABELS: Record<keyof WorklogRecord, string> = {
  asset_tag: "Asset tag",
  asset_type: "Asset type",
  symptom: "Symptom",
  failure_mode: "Failure mode",
  cause: "Cause",
  action: "Action",
  parts: "Parts used",
  readings: "Readings",
  loto_applied: "Lockout applied",
  follow_up_needed: "Follow-up needed",
  follow_up_note: "Follow-up note",
  status: "Status",
};

/** Snake-case enum value as words: `breaker_mcc` reads "breaker mcc". */
export const enumLabel = (value: string): string => value.replace(/_/g, " ");

// ---------------------------------------------------------------- checks

/** A tag compared the way the schema allows: case and spacing only. */
export const normalizeTag = (tag: string): string => tag.toUpperCase().replace(/[\s\-_]/g, "");

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** Every number written in the text, as digits (commas allowed) or as a word up to twelve. */
export function numbersIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?|\.\d+/g)) {
    const n = Number(match[0].replace(/,/g, ""));
    if (Number.isFinite(n)) found.add(n);
  }
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (word in NUMBER_WORDS) found.add(NUMBER_WORDS[word]);
  }
  return found;
}

const LOCKOUT_WORDING = /\b(loto|lock(?:ed|s)?[\s-]?out|lockout|tag(?:ged)?[\s-]?out|locked\s+(?:and|&)\s+tagged|locks?\s+(?:on|applied|hung|installed))\b/i;

/**
 * What can be checked without a model: values that must appear in the text
 * and fields that must agree with each other. A flag means the value may have
 * been invented; a note is a consistency hint. Passing every check does not
 * make a record right, which is why each one is still reviewed.
 */
export function checkWorklog(input: WorklogInput, out: WorklogRecord): AiIssue[] {
  const issues: AiIssue[] = [];
  const text = input.text;
  const numbers = numbersIn(text);

  if (out.asset_tag !== null) {
    const tag = normalizeTag(out.asset_tag);
    if (!/[A-Z]/.test(tag) || !/\d/.test(tag)) {
      issues.push({ field: "asset_tag", severity: "flag", message: `"${out.asset_tag}" is not a tag-like ID. An informal reference should be left empty.` });
    } else if (!normalizeTag(text).includes(tag)) {
      issues.push({ field: "asset_tag", severity: "flag", message: `"${out.asset_tag}" does not appear in the text.` });
    }
  }

  out.readings.forEach((reading, i) => {
    if (!numbers.has(Math.abs(reading.value))) {
      issues.push({ field: `readings.${i}`, severity: "flag", message: `The value ${reading.value} for "${reading.name}" does not appear in the text.` });
    }
  });

  out.parts.forEach((part, i) => {
    // A quantity of 1 can come from a singular noun; anything else has to be written.
    if (part.qty !== null && part.qty !== 1 && !numbers.has(part.qty)) {
      issues.push({ field: `parts.${i}`, severity: "flag", message: `The quantity ${part.qty} for "${part.name}" does not appear in the text.` });
    }
  });

  if (out.loto_applied === true && !LOCKOUT_WORDING.test(text)) {
    issues.push({ field: "loto_applied", severity: "flag", message: "Marked as locked out, but the text does not mention a lockout." });
  }
  if (out.loto_applied === false && !LOCKOUT_WORDING.test(text)) {
    issues.push({ field: "loto_applied", severity: "note", message: "\"No\" means the text says lockout was not applied. If lockout is not mentioned, leave it empty." });
  }

  if (out.status === "request" && out.action !== null) {
    issues.push({ field: "status", severity: "note", message: "A request has no action yet, but an action was recorded." });
  }
  if (out.follow_up_note !== null && !out.follow_up_needed) {
    issues.push({ field: "follow_up_needed", severity: "note", message: "There is a follow-up note, but follow-up is marked as not needed." });
  }
  if ((out.status === "no_fault_found") !== (out.failure_mode === "no_fault_found")) {
    issues.push({ field: "failure_mode", severity: "note", message: "Status and failure mode disagree about whether a fault was found." });
  }
  return issues;
}
