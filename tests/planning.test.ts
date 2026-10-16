import { beforeEach, describe, expect, it } from "vitest";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { personId } from "@/lib/demo/seed";
import { runDemoPlanningTurn } from "@/lib/planning/demo-planner";
import { DEMO_SCRIPTS } from "@/lib/planning/demo-plans";
import type { JobPlan, PlanningStreamEvent } from "@/lib/planning/plan-schema";

async function collect(gen: AsyncGenerator<PlanningStreamEvent>) {
  const events: PlanningStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const base = { woNumber: "WO-26-1031", title: "P-201B bearing", assetLabel: "BRP-HSP-P-201B", requiresShutdown: true };

describe("demo planner", () => {
  it("drafts a plan on kickoff and finishes", async () => {
    const events = await collect(runDemoPlanningTurn({ ...base, history: [], currentPlan: null }, { delayMs: 0 }));
    const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
    expect(text).toContain("WO-26-1009");
    expect(events.find((e) => e.type === "plan")).toBeTruthy();
    expect(events.at(-1)).toEqual({ type: "done", mode: "demo", model: null });
  });

  it("revises the planner's current plan, keeping manual edits", async () => {
    const edited: JobPlan = { ...DEMO_SCRIPTS["WO-26-1031"].plan, summary: "Planner's own wording" };
    const events = await collect(
      runDemoPlanningTurn(
        {
          ...base,
          history: [
            { role: "user", content: "Draft it" },
            { role: "assistant", content: "Draft done" },
            { role: "user", content: "The seal is weeping too. Should we replace it while we're in there?" },
          ],
          currentPlan: edited,
        },
        { delayMs: 0 },
      ),
    );
    const plan = events.find((e): e is Extract<PlanningStreamEvent, { type: "plan" }> => e.type === "plan")!.plan;
    expect(plan.summary).toBe("Planner's own wording");
    expect(plan.tasks.some((t) => t.seq === 55)).toBe(true);
    expect(plan.parts.some((p) => p.part_number === "MX-SEAL-3375C")).toBe(true);
  });

  it("does not change the plan for free text it cannot handle", async () => {
    const plan = DEMO_SCRIPTS["WO-26-1031"].plan;
    const events = await collect(
      runDemoPlanningTurn(
        { ...base, history: [{ role: "assistant", content: "x" }, { role: "user", content: "What's the weather?" }], currentPlan: plan },
        { delayMs: 0 },
      ),
    );
    expect(events.some((e) => e.type === "plan")).toBe(false);
  });
});

describe("committing a plan (demo repository)", () => {
  beforeEach(() => resetDemoStore());

  it("writes steps and parts, reserves stock and moves to Scheduling", async () => {
    const repo = new DemoRepository();
    const wo = (await repo.listWorkOrders({ stage: "planning" })).find((w) => w.wo_number === "WO-26-1031")!;
    const before = (await repo.listInventory()).find((i) => i.part.part_number === "MX-BRG-22220")!;

    await repo.commitPlan(wo.id, DEMO_SCRIPTS["WO-26-1031"].plan, personId("Marcus"));

    const after = await repo.getWorkOrder(wo.id);
    expect(after?.stage).toBe("scheduling");
    expect(after?.tasks).toHaveLength(DEMO_SCRIPTS["WO-26-1031"].plan.tasks.length);
    expect(after?.parts.every((p) => p.status === "reserved")).toBe(true);
    expect(after?.estimated_hours).toBe(28.5);
    expect(after?.events[0].event_type).toBe("plan_committed");

    const stock = (await repo.listInventory()).find((i) => i.part.part_number === "MX-BRG-22220")!;
    expect(stock.reserved).toBe(before.reserved + 1);
  });

  it("leaves short parts as planned instead of over-reserving", async () => {
    const repo = new DemoRepository();
    const wo = (await repo.listWorkOrders({ stage: "planning" })).find((w) => w.wo_number === "WO-26-1035")!;
    await repo.commitPlan(wo.id, DEMO_SCRIPTS["WO-26-1035"].plan, personId("Marcus"));
    const after = await repo.getWorkOrder(wo.id);
    expect(after?.parts[0].status).toBe("planned"); // zero high-temp seals in stock
  });
});
