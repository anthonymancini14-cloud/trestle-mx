/**
 * Troubleshooting record rules (TMX-006 to TMX-008). Pure functions shared by
 * the server actions, the demo store and the UI.
 */
import { daysBetween } from "@/lib/pm/program";
import type { Resolution, ResolutionHistoryItem, WorkOrder, WoType } from "@/types/domain";

/** Work types that must prove a cause before WCE -001 closes. */
export const EVIDENCE_TYPES: readonly WoType[] = ["corrective", "emergency"];

/** Default repeat-failure window when a class doesn't set one (TMX-008). */
export const DEFAULT_REPEAT_WINDOW_DAYS = 90;

/** The resolution in force: the newest one (later ones supersede earlier ones). */
export function currentResolution<T extends Pick<Resolution, "created_at">>(resolutions: T[]): T | null {
  return [...resolutions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

/**
 * Evidence to close (TMX-006): a corrective JCN's WCE -001 can't close without
 * a cause backed by at least one linked finding, or an explicit "no fault found".
 * Support WCEs and PM work don't carry a cause. Returns why it can't close, or null.
 */
export function evidenceBlocker(
  wo: Pick<WorkOrder, "wce_seq" | "wo_type">,
  resolutions: Pick<Resolution, "created_at" | "no_fault_found" | "finding_ids" | "failure_mode" | "cause">[],
): string | null {
  if (wo.wce_seq !== 1 || !EVIDENCE_TYPES.includes(wo.wo_type)) return null;
  const r = currentResolution(resolutions);
  if (!r) return "Record the resolution first: the cause, the findings that prove it, and the test that proves the fix (or no fault found).";
  if (r.no_fault_found) return null;
  if (!r.failure_mode && !r.cause) return "The resolution needs a coded failure mode or cause.";
  if (r.finding_ids.length === 0) return "Link at least one finding that supports the cause, or record no fault found.";
  return null;
}

/** Problems with a resolution before it is saved. Empty when it is fine. */
export function resolutionProblems(input: {
  no_fault_found: boolean;
  failure_mode: string | null;
  cause: string | null;
  finding_ids: string[];
  cause_narrative: string;
  remedy: string;
  verification: string | null;
  verification_passed: boolean | null;
}): string[] {
  const out: string[] = [];
  if (input.cause_narrative.trim().length < 10) out.push("Describe the cause (or why no fault was found).");
  if (input.no_fault_found) return out;
  if (!input.failure_mode) out.push("Pick the failure mode.");
  if (!input.cause) out.push("Pick the cause.");
  if (input.finding_ids.length === 0) out.push("Link the findings that support the cause.");
  if (input.remedy.trim().length < 5) out.push("Say what was done to fix it.");
  if (!input.verification || input.verification.trim().length < 5) out.push("Record the test after the repair, with its reading.");
  if (input.verification_passed === null) out.push("Say whether the verification passed.");
  return out;
}

export interface RepeatCheck {
  windowDays: number;
  /** Closed corrective work on the same asset within the window before this one was written up. */
  prior: ResolutionHistoryItem[];
  /** Prior work that ended in the same failure mode as this job's resolution: a confirmed repeat. */
  sameMode: ResolutionHistoryItem[];
}

/**
 * Repeat failures (TMX-008): has this asset had corrective work close within the
 * window before this discrepancy was written up? Shown to the gatekeeper and
 * planner as a possible repeat; once this job's cause is coded, prior work with
 * the same failure mode makes it a confirmed repeat. A null window (run-to-failure
 * classes) turns the check off.
 */
export function repeatCheck(
  wo: Pick<WorkOrder, "id" | "asset_id" | "created_at" | "wo_type">,
  history: ResolutionHistoryItem[],
  windowDays: number | null,
  own: Pick<Resolution, "failure_mode"> | null,
): RepeatCheck | null {
  // Planned work (PMs, projects) isn't a failure, so it can't repeat one.
  if (windowDays === null || !wo.asset_id || !EVIDENCE_TYPES.includes(wo.wo_type)) return null;
  const opened = wo.created_at.slice(0, 10);
  const prior = latestPerWo(history).filter(
    (r) =>
      r.wo.asset_id === wo.asset_id &&
      r.wo.id !== wo.id &&
      r.wo.status === "closed" &&
      r.wo.closed_at !== null &&
      r.wo.closed_at <= wo.created_at &&
      EVIDENCE_TYPES.includes(r.wo.wo_type) &&
      daysBetween(r.wo.closed_at.slice(0, 10), opened) <= windowDays,
  );
  if (prior.length === 0) return null;
  const sameMode = own?.failure_mode ? prior.filter((r) => r.failure_mode === own.failure_mode) : [];
  return { windowDays, prior: prior.sort((a, b) => b.wo.closed_at!.localeCompare(a.wo.closed_at!)), sameMode };
}

/** Confirmed repeats across a site: a resolution whose asset and failure mode closed before within the window. */
export function repeatFailures(history: ResolutionHistoryItem[], windowFor: (assetId: string) => number | null): { item: ResolutionHistoryItem; prior: ResolutionHistoryItem }[] {
  const latest = latestPerWo(history).filter((r) => r.failure_mode && r.wo.asset_id && EVIDENCE_TYPES.includes(r.wo.wo_type));
  const out: { item: ResolutionHistoryItem; prior: ResolutionHistoryItem }[] = [];
  for (const item of latest) {
    const window = windowFor(item.wo.asset_id!);
    if (window === null) continue;
    const prior = latest
      .filter(
        (p) =>
          p.wo.id !== item.wo.id &&
          p.wo.asset_id === item.wo.asset_id &&
          p.failure_mode === item.failure_mode &&
          p.wo.closed_at !== null &&
          p.wo.closed_at <= item.wo.created_at &&
          daysBetween(p.wo.closed_at.slice(0, 10), item.wo.created_at.slice(0, 10)) <= window,
      )
      .sort((a, b) => b.wo.closed_at!.localeCompare(a.wo.closed_at!))[0];
    if (prior) out.push({ item, prior });
  }
  return out;
}

/** The newest resolution of each work order. */
function latestPerWo<T extends ResolutionHistoryItem>(items: T[]): T[] {
  const byWo = new Map<string, T>();
  for (const r of items) {
    const prev = byWo.get(r.wo.id);
    if (!prev || r.created_at > prev.created_at) byWo.set(r.wo.id, r);
  }
  return [...byWo.values()];
}
