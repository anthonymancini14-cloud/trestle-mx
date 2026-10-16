import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { PLANNING_MODEL } from "@/lib/config";
import { jobPlanSchema, type JobPlan, type PlanningMessage, type PlanningStreamEvent } from "@/lib/planning/plan-schema";
import { formatStaticContext, loadStaticContext } from "./context/loader";
import { KICKOFF_MESSAGE, PLANNING_SYSTEM_PROMPT, planContextMessage } from "./planning-prompt";

// The JSON Schema draft marker is not part of the tool input schema.
const { $schema: _draft, ...planJsonSchema } = z.toJSONSchema(jobPlanSchema);

const UPDATE_PLAN_TOOL: Anthropic.Tool = {
  name: "update_job_plan",
  description:
    "Replace the draft job plan shown to the planner. Always send the complete plan, not a diff. Call this whenever the plan changes.",
  input_schema: planJsonSchema as Anthropic.Tool.InputSchema,
};

/**
 * Runs one Planning Mode turn against Claude and yields stream events.
 *
 * Each turn is stateless on the server: the client sends the text history and
 * the current plan (including the planner's manual edits). Layers 1 and 2 go in
 * a cached system block, so repeat turns on any work order reuse the cache.
 */
export async function* runClaudePlanningTurn(input: {
  siteContext: string;
  history: PlanningMessage[];
  currentPlan: JobPlan | null;
}): AsyncGenerator<PlanningStreamEvent> {
  const client = new Anthropic();
  const staticContext = formatStaticContext(await loadStaticContext());

  const history = input.history.length ? input.history : [{ role: "user" as const, content: KICKOFF_MESSAGE }];
  const [first, ...rest] = history;
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${planContextMessage(input.siteContext, input.currentPlan ? JSON.stringify(input.currentPlan, null, 2) : null)}\n\n${first.content}`,
    },
    ...rest.map((m) => ({ role: m.role, content: m.content })),
  ];

  const stream = client.messages.stream({
    model: PLANNING_MODEL,
    max_tokens: 8000,
    system: [
      { type: "text", text: PLANNING_SYSTEM_PROMPT },
      {
        type: "text",
        text: `Reference context for planning (layers 1 and 2):\n\n${staticContext}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [UPDATE_PLAN_TOOL],
    messages,
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield { type: "text", delta: event.delta.text };
    }
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      yield { type: "status", message: "Updating the job plan" };
    }
  }

  const final = await stream.finalMessage();
  for (const block of final.content) {
    if (block.type === "tool_use" && block.name === UPDATE_PLAN_TOOL.name) {
      const parsed = jobPlanSchema.safeParse(block.input);
      if (parsed.success) {
        yield { type: "plan", plan: parsed.data };
      } else {
        yield { type: "error", message: "The proposed plan did not match the plan format, so it was not applied." };
      }
    }
  }
  yield { type: "done", mode: "live", model: PLANNING_MODEL };
}
