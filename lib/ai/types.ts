import type { z } from "zod";
import type { AiIssue, AiTaskName } from "@/types/domain";

/**
 * The AI task layer. Every job a model does for Trestle.MX is a named task
 * with an output schema, a prompt kept in markdown, and deterministic checks
 * on what comes back. Tasks run on a local, open-weight model by default.
 *
 * Two rules hold for every task:
 *  - A model never computes a number the product shows. It reads, extracts,
 *    classifies and drafts; code and SQL do the arithmetic.
 *  - A model never commits. Its output is a proposal that a person reviews.
 */

/** Rough size class of the model a task needs. T1 fits an 8 GB card; T2 needs about 24 GB; T3 is a hosted frontier model. */
export type ModelTier = "T1" | "T2" | "T3";

export interface ChatRequest {
  system: string;
  user: string;
  /** Ask the server to constrain the reply to this JSON schema, where it can. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens: number;
  temperature: number;
}

export interface ChatResponse {
  text: string;
  /** The model the server says it used. */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** One way of reaching a model. Providers hold no state between calls. */
export interface ChatProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ChatRequest): Promise<ChatResponse>;
}

export interface TaskPrompt {
  system: string;
  user: string;
  /** Identifies the schema and prompt text a run used, so scores can be compared across changes. */
  version: string;
}

/** A worked example for few-shot prompting. */
export interface Shot<I, O> {
  input: I;
  output: O;
}

export interface AiTask<I, O> {
  name: AiTaskName;
  tier: ModelTier;
  outputSchema: z.ZodType<O>;
  maxOutputTokens: number;
  buildPrompt(input: I, shots?: Shot<I, O>[]): Promise<TaskPrompt>;
  /** Deterministic checks of the output against the input. Never calls a model. */
  check(input: I, output: O): AiIssue[];
}

/** What one run of a task produced. Plain data, so it can be stored as it is. */
export interface RunOutcome<O = unknown> {
  provider: string;
  model: string;
  prompt_version: string;
  /** Null when the call failed or the reply did not match the schema. */
  output: O | null;
  issues: AiIssue[];
  /** The model's reply as text, kept for debugging failed runs. */
  raw_output: string | null;
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
}
