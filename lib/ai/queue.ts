import type { AiJob, AiQueueItem, AiQueueState, AiReview, AiRun } from "@/types/domain";

/** The provider name on demo runs that were written by hand, not produced by a model. */
export const SCRIPTED_PROVIDER = "scripted";

/** Where a job stands: still with the model, failed, waiting for a person, or reviewed. */
export function queueState(job: Pick<AiJob, "status">, review: Pick<AiReview, "verdict"> | null): AiQueueState {
  if (job.status !== "done") return job.status;
  return review ? review.verdict : "needs_review";
}

/** The newest row. Runs and reviews are never edited, so the newest one is the one that stands. */
export function newest<T extends { created_at: string; id: string }>(rows: T[]): T | null {
  return rows.reduce<T | null>((best, row) => (!best || row.created_at > best.created_at || (row.created_at === best.created_at && row.id > best.id) ? row : best), null);
}

/** Checks that may point at an invented value, as opposed to consistency notes. */
export const flagCount = (run: Pick<AiRun, "issues"> | null): number => (run?.issues ?? []).filter((i) => i.severity === "flag").length;

export interface QueueSummary {
  needsReview: number;
  /** Waiting for review with at least one flag. */
  flagged: number;
  waiting: number;
  failed: number;
  reviewed: number;
  /** Share of reviewed runs accepted without a change, or null before anything is reviewed. */
  acceptedShare: number | null;
}

/** Counts for the audit queue header. Computed here, never by a model. */
export function summarizeQueue(items: Pick<AiQueueItem, "state" | "run">[]): QueueSummary {
  const count = (...states: AiQueueState[]) => items.filter((i) => states.includes(i.state)).length;
  const reviewed = count("accepted", "corrected", "rejected");
  return {
    needsReview: count("needs_review"),
    flagged: items.filter((i) => i.state === "needs_review" && flagCount(i.run) > 0).length,
    waiting: count("queued", "running"),
    failed: count("failed"),
    reviewed,
    acceptedShare: reviewed ? count("accepted") / reviewed : null,
  };
}
