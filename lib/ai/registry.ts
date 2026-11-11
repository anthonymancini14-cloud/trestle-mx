import type { AiTaskName } from "@/types/domain";
import { worklogExtractTask } from "./tasks/worklog-extract";
import type { AiTask } from "./types";

/**
 * Every AI task the product runs, by name. Adding a use case means adding a
 * task here with its schema, prompt and checks; the queue, the run log and
 * the audit screen already handle it.
 *
 * Planning Mode is not in this registry yet. It streams and edits a plan
 * through a tool, so it keeps its own runner in lib/anthropic and stays on
 * Claude by default.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each task has its own input and output types; callers narrow by name.
export const AI_TASK_REGISTRY: Record<AiTaskName, AiTask<any, any>> = {
  "worklog.extract": worklogExtractTask,
};

export function getTask(name: string): AiTask<unknown, unknown> | null {
  return name in AI_TASK_REGISTRY ? (AI_TASK_REGISTRY[name as AiTaskName] as AiTask<unknown, unknown>) : null;
}
