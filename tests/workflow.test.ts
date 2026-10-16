import { describe, expect, it } from "vitest";
import { assertCan, availableActions, canPerform, nextStage, WorkflowError } from "@/lib/workflow";

const open = (stage: Parameters<typeof canPerform>[2]["stage"]) => ({ stage, status: "open" as const });

describe("work order lifecycle rules", () => {
  it("lets only gatekeepers and admins authorize in vetting", () => {
    expect(canPerform("authorize", "gatekeeper", open("vetting"))).toBe(true);
    expect(canPerform("authorize", "admin", open("vetting"))).toBe(true);
    expect(canPerform("authorize", "planner", open("vetting"))).toBe(false);
    expect(canPerform("authorize", "gatekeeper", open("planning"))).toBe(false);
  });

  it("opens Planning Mode only for planners on work orders in planning", () => {
    expect(canPerform("plan", "planner", open("planning"))).toBe(true);
    expect(canPerform("plan", "technician", open("planning"))).toBe(false);
    expect(canPerform("plan", "planner", open("scheduling"))).toBe(false);
  });

  it("blocks every action on closed or rejected work", () => {
    expect(availableActions("admin", { stage: "closure", status: "closed" })).toEqual([]);
    expect(availableActions("gatekeeper", { stage: "vetting", status: "rejected" })).toEqual([]);
  });

  it("gives technicians execution actions but storeroom only part issue", () => {
    expect(availableActions("technician", open("execution"))).toEqual(["complete_task", "issue_part", "submit_completion"]);
    expect(availableActions("storeroom", open("execution"))).toEqual(["issue_part"]);
  });

  it("walks the six stages in order", () => {
    expect(nextStage("identification")).toBe("vetting");
    expect(nextStage("execution")).toBe("closure");
    expect(nextStage("closure")).toBeNull();
  });

  it("explains a refusal", () => {
    expect(() => assertCan("close", "technician", open("closure"))).toThrow(WorkflowError);
    expect(() => assertCan("close", "technician", open("closure"))).toThrow(/supervisor or admin/);
  });
});
