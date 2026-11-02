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

/** Site settings that change who may act. `schedulerRoles` comes from the site (TMX-015). */
export interface WorkflowOptions {
  schedulerRoles?: readonly Role[];
}

/** Roles allowed to take an action, after site settings. Admin can always schedule. */
export function rolesFor(action: WoAction, opts: WorkflowOptions = {}): readonly Role[] {
  if (action === "schedule" && opts.schedulerRoles) return ["admin", ...opts.schedulerRoles.filter((r) => r !== "admin")];
  return ACTION_RULES[action].roles;
}

export function canPerform(action: WoAction, role: Role, wo: Pick<WorkOrder, "stage" | "status">, opts: WorkflowOptions = {}): boolean {
  const rule = ACTION_RULES[action];
  return wo.status === "open" && wo.stage === rule.stage && rolesFor(action, opts).includes(role);
}

export function nextStage(stage: WoStage): WoStage | null {
  const i = WO_STAGES.indexOf(stage);
  return i >= 0 && i < WO_STAGES.length - 1 ? WO_STAGES[i + 1] : null;
}

/** Actions available to a role on a work order, in display order. */
export function availableActions(role: Role, wo: Pick<WorkOrder, "stage" | "status">, opts: WorkflowOptions = {}): WoAction[] {
  return (Object.keys(ACTION_RULES) as WoAction[]).filter((a) => canPerform(a, role, wo, opts));
}

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export function assertCan(action: WoAction, role: Role, wo: Pick<WorkOrder, "stage" | "status">, opts: WorkflowOptions = {}): void {
  if (!canPerform(action, role, wo, opts)) {
    const rule = ACTION_RULES[action];
    throw new WorkflowError(
      `${rule.label} needs a ${rolesFor(action, opts).join(" or ")} on an open work order in ${rule.stage}; this one is ${wo.status} in ${wo.stage}.`,
    );
  }
}

// ---------------------------------------------------------------- PM program

/** PM program actions, outside the work order lifecycle. */
export const PM_RULES = {
  /** Create work orders for due PMs. */
  generate: ["planner", "admin"],
  /** Move a PM's due date. Every deferral needs a supervisor (decision TMX-013). */
  defer: ["supervisor"],
} as const satisfies Record<string, readonly Role[]>;

export function canPm(action: keyof typeof PM_RULES, role: Role): boolean {
  return (PM_RULES[action] as readonly Role[]).includes(role);
}

// ---------------------------------------------------------------- Scheduling calendar

/**
 * Calendar actions. Who schedules is a site setting (TMX-015): an admin always
 * can, plus the roles in `site.scheduler_roles`. Only an admin changes that list.
 */
export function canScheduleAt(role: Role, opts: WorkflowOptions): boolean {
  return role === "admin" || (opts.schedulerRoles ?? ["supervisor"]).includes(role);
}

/** Moving a scheduled job to another day: open, in Execution, with a date. */
export function canReschedule(role: Role, wo: Pick<WorkOrder, "stage" | "status" | "scheduled_date">, opts: WorkflowOptions): boolean {
  return canScheduleAt(role, opts) && wo.status === "open" && wo.stage === "execution" && wo.scheduled_date !== null;
}
