import { checkWorklog, type WorklogRecord } from "@/lib/ai/tasks/worklog-schema";
import type { WorklogEvalRow } from "@/lib/ai/eval/worklog-score";
import { SCRIPTED_PROVIDER } from "@/lib/ai/queue";
import type { AiJob, AiReview, AiRun, AiVerdict, Profile, Site } from "@/types/domain";
import { seedId } from "./ids";

/**
 * Work-log entries for the demo audit queue. Every entry is invented, written
 * the way a technician or operator writes one, against assets at the two demo
 * sites.
 *
 * `answer` is the correct record: only what the text says. `scripted` is the
 * output the demo shows instead, where it differs: hand-written to look like
 * the mistakes a small model makes (an invented tag, a part that was only
 * ordered, a lockout nobody mentioned, a mistyped reading), so the checks and
 * the review have something to catch. These are scripted outputs, not
 * recorded runs of a real model, and the screen says so.
 */
interface WorklogSeed {
  site: "CFD" | "BRP";
  trade: string;
  quality: "terse" | "adequate" | "good" | "excellent";
  record_type: "request" | "completion";
  daysAgo: number;
  /** First name of whoever put it in the queue. */
  by: string;
  text: string;
  answer: WorklogRecord;
  scripted?: Partial<WorklogRecord>;
  review?: { verdict: AiVerdict; by: string; note?: string };
}

const EMPTY: WorklogRecord = {
  asset_tag: null,
  asset_type: null,
  symptom: null,
  failure_mode: null,
  cause: null,
  action: null,
  parts: [],
  readings: [],
  loto_applied: null,
  follow_up_needed: false,
  follow_up_note: null,
  status: "complete",
};

const WORKLOG_SEEDS: WorklogSeed[] = [
  {
    site: "CFD",
    trade: "hvac",
    quality: "good",
    record_type: "completion",
    daysAgo: 6,
    by: "Owen",
    text: "CRAH-02 high supply air temp alarm. Found return filters loaded, dp 1.4 inwc as found. Swapped 6 filters 24x24x4, dp 0.5 inwc as left. Unit back in auto. Recommend moving filter PM to quarterly.",
    answer: {
      ...EMPTY,
      asset_tag: "CRAH-02",
      asset_type: "crah",
      symptom: "high supply air temp alarm",
      failure_mode: "filter_restriction",
      cause: "return filters loaded",
      action: "swapped filters, unit back in auto",
      parts: [{ name: "filter 24x24x4", qty: 6 }],
      readings: [
        { name: "filter dp", value: 1.4, unit: "inwc", state: "as_found" },
        { name: "filter dp", value: 0.5, unit: "inwc", state: "as_left" },
      ],
      follow_up_needed: true,
      follow_up_note: "move filter PM to quarterly",
    },
    review: { verdict: "accepted", by: "Owen" },
  },
  {
    site: "CFD",
    trade: "electrician",
    quality: "good",
    record_type: "completion",
    daysAgo: 5,
    by: "Owen",
    text: "UPS-A1 battery alarm. Jar 14 in string 2 measured 11.2 V, rest of the string 13.5 V. Replacement jar ordered, not on site. String left in service. Swap jar 14 when the part arrives.",
    answer: {
      ...EMPTY,
      asset_tag: "UPS-A1",
      asset_type: "ups",
      symptom: "battery alarm",
      failure_mode: "battery_degradation",
      action: "measured jar voltages, string left in service",
      readings: [
        { name: "jar 14 voltage", value: 11.2, unit: "V", state: "single" },
        { name: "string jar voltage", value: 13.5, unit: "V", state: "single" },
      ],
      follow_up_needed: true,
      follow_up_note: "swap jar 14 when the part arrives",
      status: "partial",
    },
    // The jar was ordered, not installed. No check can see that; the reviewer did.
    scripted: { parts: [{ name: "replacement jar", qty: 1 }] },
    review: { verdict: "corrected", by: "Owen", note: "The jar was ordered, not installed." },
  },
  {
    site: "CFD",
    trade: "operator",
    quality: "terse",
    record_type: "request",
    daysAgo: 2,
    by: "Owen",
    text: "east chiller making a grinding noise on startup, cleared after about a minute",
    answer: {
      ...EMPTY,
      asset_type: "chiller",
      symptom: "grinding noise on startup, cleared after about a minute",
      status: "request",
    },
    // An informal reference turned into a tag that isn't in the text.
    scripted: { asset_tag: "CH-02" },
  },
  {
    site: "CFD",
    trade: "mechanical",
    quality: "excellent",
    record_type: "completion",
    daysAgo: 2,
    by: "Hana",
    text: "CDU-01 secondary loop low flow alarm. LOTO applied at PDU-A1 breaker 14. Found pump 2 mechanical seal leaking and reservoir level low. Replaced seal kit, topped up 4 gal PG25 coolant. As found flow 38 gpm, as left 52 gpm, spec 50 gpm min. Leak check 30 min, dry. Cause: seal face worn.",
    answer: {
      ...EMPTY,
      asset_tag: "CDU-01",
      asset_type: "other",
      symptom: "secondary loop low flow alarm",
      failure_mode: "seal_leak",
      cause: "seal face worn",
      action: "replaced pump 2 mechanical seal, topped up coolant, leak checked",
      parts: [
        { name: "seal kit", qty: 1 },
        { name: "PG25 coolant", qty: 4 },
      ],
      readings: [
        { name: "flow", value: 38, unit: "gpm", state: "as_found" },
        { name: "flow", value: 52, unit: "gpm", state: "as_left" },
        { name: "flow", value: 50, unit: "gpm", state: "spec" },
      ],
      loto_applied: true,
    },
  },
  {
    site: "CFD",
    trade: "electrician",
    quality: "adequate",
    record_type: "completion",
    daysAgo: 9,
    by: "Owen",
    text: "G-02 monthly run complete. Started on first crank, no leaks, block heater ok.",
    answer: { ...EMPTY, asset_tag: "G-02", asset_type: "genset", action: "monthly run" },
    review: { verdict: "accepted", by: "Hana" },
  },
  {
    site: "CFD",
    trade: "hvac",
    quality: "adequate",
    record_type: "completion",
    daysAgo: 1,
    by: "Owen",
    text: "CRAH-03 fan 2 tripped on overload twice this shift. Reset both times, runs about 20 min then trips again. Did not open the unit. Needs an electrician to megger the motor.",
    answer: {
      ...EMPTY,
      asset_tag: "CRAH-03",
      asset_type: "crah",
      symptom: "fan 2 tripped on overload twice",
      failure_mode: "electrical_trip",
      action: "reset twice",
      follow_up_needed: true,
      follow_up_note: "electrician to megger the motor",
      status: "partial",
    },
    // A lockout nobody mentioned.
    scripted: { loto_applied: true },
  },
  {
    site: "BRP",
    trade: "millwright",
    quality: "excellent",
    record_type: "completion",
    daysAgo: 3,
    by: "Marcus",
    text: "HS pump P-201A high vibration on outboard bearing. As found 0.42 in/s, alarm at 0.30 in/s. Locked out at MCC-702. Found outboard bearing worn, replaced bearing 6313 and realigned, soft foot corrected at foot 3. As left 0.08 in/s. Cause: misalignment after the last coupling change.",
    answer: {
      ...EMPTY,
      asset_tag: "P-201A",
      asset_type: "pump",
      symptom: "high vibration on outboard bearing",
      failure_mode: "bearing_wear",
      cause: "misalignment after the last coupling change",
      action: "replaced outboard bearing, realigned, corrected soft foot",
      parts: [{ name: "bearing 6313", qty: 1 }],
      readings: [
        { name: "vibration", value: 0.42, unit: "in/s", state: "as_found" },
        { name: "vibration alarm", value: 0.3, unit: "in/s", state: "spec" },
        { name: "vibration", value: 0.08, unit: "in/s", state: "as_left" },
      ],
      loto_applied: true,
    },
    // 0.08 copied as 0.8: a number that isn't in the text.
    scripted: {
      readings: [
        { name: "vibration", value: 0.42, unit: "in/s", state: "as_found" },
        { name: "vibration alarm", value: 0.3, unit: "in/s", state: "spec" },
        { name: "vibration", value: 0.8, unit: "in/s", state: "as_left" },
      ],
    },
  },
  {
    site: "BRP",
    trade: "millwright",
    quality: "terse",
    record_type: "completion",
    daysAgo: 8,
    by: "Marcus",
    text: "BFW pump P-502 packing leaking. adjusted gland, leak stopped.",
    answer: { ...EMPTY, asset_tag: "P-502", asset_type: "pump", symptom: "packing leaking", failure_mode: "seal_leak", action: "adjusted gland" },
    review: { verdict: "accepted", by: "Lena" },
  },
  {
    site: "BRP",
    trade: "instrument",
    quality: "good",
    record_type: "completion",
    daysAgo: 2,
    by: "Marcus",
    text: "V-205 discharge valve would not close fully from the control room. Stroked locally ok. Actuator air supply regulator found set at 45 psi, spec 80 psi. Reset to 80 psi, valve strokes full travel. No parts used.",
    answer: {
      ...EMPTY,
      asset_tag: "V-205",
      asset_type: "valve",
      symptom: "would not close fully from the control room",
      failure_mode: "other",
      cause: "actuator air supply regulator set below spec",
      action: "reset regulator to 80 psi",
      readings: [
        { name: "air supply pressure", value: 45, unit: "psi", state: "as_found" },
        { name: "air supply pressure", value: 80, unit: "psi", state: "spec" },
        { name: "air supply pressure", value: 80, unit: "psi", state: "as_left" },
      ],
    },
  },
  {
    site: "BRP",
    trade: "electrician",
    quality: "good",
    record_type: "completion",
    daysAgo: 1,
    by: "Lena",
    text: "MCC-702 bucket 4B reported hot by operator. IR scan of all three phases 41 C, 40 C, 41 C, ambient 29 C. Connections checked tight. No fault found.",
    answer: {
      ...EMPTY,
      asset_tag: "MCC-702",
      asset_type: "breaker_mcc",
      symptom: "bucket 4B reported hot",
      failure_mode: "no_fault_found",
      action: "IR scan, checked connections",
      readings: [
        { name: "phase temperature", value: 41, unit: "C", state: "single" },
        { name: "phase temperature", value: 40, unit: "C", state: "single" },
        { name: "phase temperature", value: 41, unit: "C", state: "single" },
        { name: "ambient temperature", value: 29, unit: "C", state: "single" },
      ],
      status: "no_fault_found",
    },
  },
  {
    site: "BRP",
    trade: "operator",
    quality: "terse",
    record_type: "request",
    daysAgo: 0.5,
    by: "Marcus",
    text: "Compressor C-801 short cycling, loads and unloads every 2 minutes.",
    answer: {
      ...EMPTY,
      asset_tag: "C-801",
      asset_type: "other",
      symptom: "short cycling, loads and unloads every 2 minutes",
      status: "request",
    },
  },
];

/** The demo entries as eval rows: text and the correct record. A smoke set for the eval script, not the eval set. */
export const WORKLOG_SAMPLES: WorklogEvalRow[] = WORKLOG_SEEDS.map((seed, i) => ({
  id: `S${String(i + 1).padStart(3, "0")}`,
  site: seed.site,
  trade: seed.trade,
  record_type: seed.record_type,
  quality: seed.quality,
  split: "dev",
  text: seed.text,
  answer: seed.answer,
}));

const DAY_MS = 86_400_000;

/** Jobs, scripted runs and reviews for the demo store. Issues come from running the real checks on each scripted output. */
export function buildWorklogRows(args: { now: Date; sites: Site[]; profiles: Profile[] }): { aiJobs: AiJob[]; aiRuns: AiRun[]; aiReviews: AiReview[] } {
  const { now, sites, profiles } = args;
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const person = (first: string) => {
    const p = profiles.find((x) => x.full_name.split(" ")[0] === first);
    if (!p) throw new Error(`No demo profile ${first}`);
    return p.id;
  };
  const rows = { aiJobs: [] as AiJob[], aiRuns: [] as AiRun[], aiReviews: [] as AiReview[] };

  WORKLOG_SEEDS.forEach((seed, i) => {
    const site = sites.find((s) => s.code === seed.site)!;
    const jobId = seedId("aiJob", i + 1);
    const runId = seedId("aiRun", i + 1);
    const created = ago(seed.daysAgo);
    const output: WorklogRecord = { ...seed.answer, ...seed.scripted };
    rows.aiJobs.push({
      id: jobId,
      site_id: site.id,
      task: "worklog.extract",
      source: "manual",
      wo_id: null,
      input: { text: seed.text },
      status: "done",
      attempts: 1,
      error: null,
      created_by: person(seed.by),
      created_at: created,
      finished_at: created,
    });
    rows.aiRuns.push({
      id: runId,
      job_id: jobId,
      provider: SCRIPTED_PROVIDER,
      model: "scripted demo output",
      prompt_version: "demo",
      output,
      issues: checkWorklog({ text: seed.text }, output),
      raw_output: null,
      latency_ms: null,
      created_at: created,
    });
    if (seed.review) {
      rows.aiReviews.push({
        id: seedId("aiReview", rows.aiReviews.length + 1),
        run_id: runId,
        verdict: seed.review.verdict,
        corrected_output: seed.review.verdict === "corrected" ? seed.answer : null,
        note: seed.review.note ?? null,
        reviewed_by: person(seed.review.by),
        // Reviewed a few hours after it came in.
        created_at: ago(Math.max(seed.daysAgo - 0.2, 0)),
      });
    }
  });
  return rows;
}
