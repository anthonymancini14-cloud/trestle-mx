import type { AiJob } from "@/types/domain";
import { getTask } from "./registry";
import { runTask } from "./run";
import type { ChatProvider, RunOutcome } from "./types";

/**
 * The queue a worker pulls from. In live mode this is two database functions
 * (`claim_ai_job`, `complete_ai_job`) that only the service role may call, so
 * the machine running the model needs an outbound connection to the database
 * and nothing else.
 */
export interface JobQueue {
  /** Take the oldest waiting job, or null when there is none. */
  claim(): Promise<Pick<AiJob, "id" | "task" | "input"> | null>;
  /** Store the run and mark the job done or failed. */
  complete(jobId: string, outcome: RunOutcome): Promise<void>;
}

/** Run one job from the queue. Returns what happened, so a loop knows whether to wait. */
export async function processNextJob(queue: JobQueue, provider: ChatProvider): Promise<"idle" | "done" | "failed"> {
  const job = await queue.claim();
  if (!job) return "idle";
  const task = getTask(job.task);
  const outcome: RunOutcome = task
    ? await runTask(task, job.input, provider)
    : {
        provider: provider.name,
        model: provider.model,
        prompt_version: "unknown",
        output: null,
        issues: [],
        raw_output: null,
        latency_ms: 0,
        input_tokens: null,
        output_tokens: null,
        error: `This worker does not know the task "${job.task}".`,
      };
  await queue.complete(job.id, outcome);
  return outcome.error === null ? "done" : "failed";
}
