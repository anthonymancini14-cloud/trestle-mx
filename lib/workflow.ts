/**
 * Work order lifecycle rules: which role may take which action at which stage.
 * Pure functions, shared by server actions (enforcement) and UI (which buttons
 * to show). RLS enforces site scoping in the database; this enforces process.
 */
import type { Role, WoStage, WorkOrder } from "@/types/domain";
import { WO_STAGES } from "@/types/domain";

export type WoAction =
  | "submit_for_vetting"
  | "authorize"
  | "reject"
  | "plan"
  | "schedule"
  | "complete_task"
  | "issue_part"
  | "submit_completion"
  | "close";

interface ActionRule {
  stage: WoStage;
  roles: readonly Role[];
  label: string;
}

export const ACTION_RULES: Record<WoAction, ActionRule> = {
  submit_for_vetting: { stage: "identification", roles: ["technician", "planner", "supervisor", "admin", "gatekeeper"], label: "Submit for vetting" },
  authorize: { stage: "vetting", roles: ["gatekeeper", "admin"], label: "Authorize" },
  reject: { stage: "vetting", roles: ["gatekeeper", "admin"], label: "Reject" },
  plan: { stage: "planning", roles: ["planner", "admin"], label: "Open Planning Mode" },
  schedule: { stage: "scheduling", roles: ["supervisor", "admin"], label: "Schedule" },
  complete_task: { stage: "execution", roles: ["technician", "supervisor", "admin"], label: "Complete task" },
  issue_part: { stage: "execution", roles: ["storeroom", "technician", "admin"], label: "Issue part" },
  submit_completion: { stage: "execution", roles: ["technician", "supervisor", "admin"], label: "Submit completion" },
  close: { stage: "closure", roles: ["supervisor", "admin"], label: "Close with debrief" },
};

export function canPerform(action: WoAction, role: Role, wo: Pick<WorkOrder, "stage" | "status">): boolean {
  const rule = ACTION_RULES[action];
  return wo.status === "open" && wo.stage === rule.stage && rule.roles.includes(role);
}

export function nextStage(stage: WoStage): WoStage | null {
  const i = WO_STAGES.indexOf(stage);
  return i >= 0 && i < WO_STAGES.length - 1 ? WO_STAGES[i + 1] : null;
}

/** Actions available to a role on a work order, in display order. */
export function availableActions(role: Role, wo: Pick<WorkOrder, "stage" | "status">): WoAction[] {
  return (Object.keys(ACTION_RULES) as WoAction[]).filter((a) => canPerform(a, role, wo));
}

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export function assertCan(action: WoAction, role: Role, wo: Pick<WorkOrder, "stage" | "status">): void {
  if (!canPerform(action, role, wo)) {
    const rule = ACTION_RULES[action];
    throw new WorkflowError(
      `${rule.label} needs a ${rule.roles.join(" or ")} on an open work order in ${rule.stage}; this one is ${wo.status} in ${wo.stage}.`,
    );
  }
}
