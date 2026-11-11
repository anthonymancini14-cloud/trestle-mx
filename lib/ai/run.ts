import { z } from "zod";
import type { AiTask, ChatProvider, RunOutcome, Shot } from "./types";

/**
 * Pull the JSON object out of a model's reply. Models wrap JSON in code
 * fences or add a sentence before it even when told not to.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [trimmed, fenced?.[1]?.trim()];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape.
    }
  }
  throw new Error("The reply was not JSON.");
}

/** The task's output schema as JSON Schema, for servers that can constrain the reply to it. */
export function outputJsonSchema(task: Pick<AiTask<unknown, unknown>, "name" | "outputSchema">): { name: string; schema: Record<string, unknown> } {
  const { $schema: _draft, ...schema } = z.toJSONSchema(task.outputSchema) as Record<string, unknown>;
  return { name: task.name.replace(/[^a-zA-Z0-9_]/g, "_"), schema };
}

/**
 * Run one task against a model: build the prompt, call the provider, parse
 * the reply, check it against the task's schema, then run the task's own
 * checks. Never throws: a failed call or a reply that doesn't fit comes back
 * as an outcome with `error` set, so it can be stored and looked at.
 */
export async function runTask<I, O>(task: AiTask<I, O>, input: I, provider: ChatProvider, opts: { shots?: Shot<I, O>[] } = {}): Promise<RunOutcome<O>> {
  const prompt = await task.buildPrompt(input, opts.shots);
  const started = Date.now();
  const base = { provider: provider.name, model: provider.model, prompt_version: prompt.version, issues: [], input_tokens: null, output_tokens: null };
  let reply;
  try {
    reply = await provider.complete({
      system: prompt.system,
      user: prompt.user,
      jsonSchema: outputJsonSchema(task),
      maxOutputTokens: task.maxOutputTokens,
      temperature: 0,
    });
  } catch (error) {
    return { ...base, output: null, raw_output: null, latency_ms: Date.now() - started, error: error instanceof Error ? error.message : "The model call failed." };
  }
  const measured = { ...base, model: reply.model, raw_output: reply.text, latency_ms: Date.now() - started, input_tokens: reply.inputTokens, output_tokens: reply.outputTokens };

  let json: unknown;
  try {
    json = extractJson(reply.text);
  } catch {
    return { ...measured, output: null, error: "The model's reply was not JSON." };
  }
  const parsed = task.outputSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ...measured, output: null, error: `The model's reply did not match the output format (${where}).` };
  }
  return { ...measured, output: parsed.data, issues: task.check(input, parsed.data), error: null };
}
