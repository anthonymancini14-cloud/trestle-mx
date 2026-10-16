import { DEMO_FALLBACK_REPLY, DEMO_SCRIPTS, genericDemoPlan, type DemoScript } from "./demo-plans";
import type { JobPlan, PlanningMessage, PlanningStreamEvent } from "./plan-schema";

export interface DemoPlanningInput {
  woNumber: string;
  title: string;
  assetLabel: string | null;
  requiresShutdown: boolean;
  history: PlanningMessage[];
  currentPlan: JobPlan | null;
}

export function demoScriptFor(woNumber: string): DemoScript | null {
  return DEMO_SCRIPTS[woNumber] ?? null;
}

/** Suggested prompts for the chips under the chat, minus ones already used. */
export function demoSuggestions(woNumber: string, history: PlanningMessage[]): string[] {
  const script = demoScriptFor(woNumber);
  if (!script) return [];
  const asked = history.filter((m) => m.role === "user").map((m) => m.content);
  return script.turns.map((t) => t.prompt).filter((p) => !asked.includes(p));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Emit text in word-sized chunks so the demo feels like a live model. */
async function* typeOut(text: string, delayMs: number): AsyncGenerator<PlanningStreamEvent> {
  const words = text.split(/(\s+)/);
  for (let i = 0; i < words.length; i += 3) {
    yield { type: "text", delta: words.slice(i, i + 3).join("") };
    if (delayMs) await sleep(delayMs);
  }
}

/** One scripted Planning Mode turn. Same event protocol as the Claude planner. */
export async function* runDemoPlanningTurn(
  input: DemoPlanningInput,
  { delayMs = 18 }: { delayMs?: number } = {},
): AsyncGenerator<PlanningStreamEvent> {
  const script = demoScriptFor(input.woNumber);
  const lastUser = [...input.history].reverse().find((m) => m.role === "user");
  const isKickoff = !input.history.some((m) => m.role === "assistant");

  if (isKickoff || !input.currentPlan) {
    const plan = script?.plan ?? genericDemoPlan(input.title, input.assetLabel, input.requiresShutdown);
    const intro =
      script?.intro ??
      "Here's a starting plan built from the work order text. The public demo has scripted plans for the work orders already in the Planning queue; for this one it uses a generic template.";
    yield* typeOut(intro, delayMs);
    yield { type: "status", message: "Updating the job plan" };
    if (delayMs) await sleep(300);
    yield { type: "plan", plan };
    yield { type: "done", mode: "demo", model: null };
    return;
  }

  const text = lastUser?.content.toLowerCase() ?? "";
  const turn =
    script?.turns.find((t) => t.prompt === lastUser?.content) ??
    script?.turns.find((t) => t.match.some((k) => text.includes(k)));

  if (!turn) {
    yield* typeOut(DEMO_FALLBACK_REPLY, delayMs);
    yield { type: "done", mode: "demo", model: null };
    return;
  }

  yield* typeOut(turn.reply, delayMs);
  if (turn.revise) {
    yield { type: "status", message: "Updating the job plan" };
    if (delayMs) await sleep(300);
    yield { type: "plan", plan: turn.revise(input.currentPlan) };
  }
  yield { type: "done", mode: "demo", model: null };
}
