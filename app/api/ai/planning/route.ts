import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { runClaudePlanningTurn } from "@/lib/anthropic/claude-planner";
import { buildSiteContext, formatSiteContext } from "@/lib/anthropic/context/site-context";
import { hasClaude } from "@/lib/config";
import { runDemoPlanningTurn } from "@/lib/planning/demo-planner";
import { jobPlanSchema, type PlanningStreamEvent } from "@/lib/planning/plan-schema";
import { canPerform } from "@/lib/workflow";

const requestSchema = z.object({
  woId: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(40),
  currentPlan: jobPlanSchema.nullable(),
});

/**
 * Planning Mode turn. Streams newline-delimited JSON events
 * (text deltas, plan updates, status, done) to the client.
 */
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const { profile, repo } = await getViewer();
  const { woId, history, currentPlan } = parsed.data;

  const siteContext = await buildSiteContext(repo, woId);
  if (!siteContext) return Response.json({ error: "Work order not found" }, { status: 404 });
  if (!canPerform("plan", profile.role, siteContext.workOrder)) {
    return Response.json({ error: "Planning Mode is for planners on work orders in Planning." }, { status: 403 });
  }

  const wo = siteContext.workOrder;
  const events: AsyncGenerator<PlanningStreamEvent> = hasClaude()
    ? runClaudePlanningTurn({ siteContext: formatSiteContext(siteContext), history, currentPlan })
    : runDemoPlanningTurn({
        woNumber: wo.wo_number,
        title: wo.title,
        assetLabel: wo.asset?.floc ?? null,
        requiresShutdown: wo.requires_shutdown,
        history,
        currentPlan,
      });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PlanningStreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of events) send(event);
      } catch (error) {
        console.error("Planning Mode turn failed", error);
        send({ type: "error", message: "The planning assistant hit an error. Your plan is unchanged; try again." });
        send({ type: "done", mode: hasClaude() ? "live" : "demo", model: null });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
