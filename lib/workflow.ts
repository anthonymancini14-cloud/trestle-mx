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
  submit_for_vetting: { stage: "identification", roles: ["operator", "technician", "planner", "supervisor", "admin", "gatekeeper"], label: "Submit for vetting" },
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

// ---------------------------------------------------------------- JCNs and WCEs

/**
 * Every WCE runs the full lifecycle on its own (TMX-019). These rules sit on
 * top: who adds a WCE to a job, who defers one, and the -001 close-out order.
 */
export const WCE_RULES = {
  /** Write up another shop's WCE on an open JCN: anyone who can report a discrepancy. */
  add: ["operator", "technician", "planner", "supervisor", "admin", "gatekeeper"],
  /** Close a WCE as deferred and carry the work under a new JCN. */
  defer: ["supervisor", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export const DEFERRABLE_STAGES: readonly WoStage[] = ["scheduling", "execution", "closure"];

export function canAddWce(role: Role, primary: Pick<WorkOrder, "status">): boolean {
  return primary.status === "open" && (WCE_RULES.add as readonly Role[]).includes(role);
}

export function canDefer(role: Role, wo: Pick<WorkOrder, "stage" | "status">): boolean {
  return wo.status === "open" && DEFERRABLE_STAGES.includes(wo.stage) && (WCE_RULES.defer as readonly Role[]).includes(role);
}

/** Why WCE -001 can't close yet (other WCEs on the JCN still open), or null. */
export function primaryCloseBlocker(wo: Pick<WorkOrder, "id" | "wce_seq">, siblings: Pick<WorkOrder, "id" | "wo_number" | "status">[]): string | null {
  if (wo.wce_seq !== 1) return null;
  const open = siblings.filter((s) => s.id !== wo.id && s.status === "open");
  if (open.length === 0) return null;
  return `WCE -001 closes last, with the corrective action summary. Still open: ${open.map((s) => s.wo_number).join(", ")}.`;
}

// ---------------------------------------------------------------- Troubleshooting record

/**
 * Who writes each part of the troubleshooting record (TMX-006, TMX-007, TMX-009).
 * Entries are insert-only; a correction is a new entry pointing at the old one.
 */
export const RECORD_RULES = {
  /** What the operator saw and tried before maintenance arrived. */
  operator_action: ["operator", "supervisor", "admin"],
  /** Each test, measurement or inspection. */
  finding: ["technician", "supervisor", "admin"],
  /** The cause, the findings that prove it, the remedy and the verification. */
  resolution: ["technician", "supervisor", "admin"],
  /** A note added to a closed work order (plus the technician who worked it). */
  addendum: ["supervisor", "planner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type RecordKind = keyof typeof RECORD_RULES;

export function canRecord(
  kind: RecordKind,
  role: Role,
  wo: Pick<WorkOrder, "stage" | "status" | "assigned_to">,
  profileId?: string,
): boolean {
  const allowed = (RECORD_RULES[kind] as readonly Role[]).includes(role);
  switch (kind) {
    case "operator_action":
    case "finding":
      return allowed && wo.status === "open";
    case "resolution":
      return allowed && wo.status === "open" && (wo.stage === "execution" || wo.stage === "closure");
    case "addendum":
      // Closed work is never edited; these roles, and the technician who worked the job, can add to it.
      return wo.status === "closed" && (allowed || (role === "technician" && !!profileId && wo.assigned_to === profileId));
  }
}

// ---------------------------------------------------------------- Document control

/**
 * Who controls documents (TMX-026). Everyone at the site can read every
 * document. A revision is written by one person and approved by another.
 */
export const DOC_RULES = {
  /** Create a document, write a new revision, link it to assets. */
  author: ["planner", "supervisor", "admin"],
  /** Approve or reject a draft revision (never your own). */
  review: ["supervisor", "admin"],
  /** Archive a document as obsolete and name its replacement. */
  obsolete: ["supervisor", "admin"],
  /** Put a document on an open work order. */
  attach: ["planner", "supervisor", "admin", "technician"],
  /** Take one off again, if nobody has opened it from the work order. */
  detach: ["planner", "supervisor", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type DocAction = keyof typeof DOC_RULES;

export function canDoc(action: DocAction, role: Role): boolean {
  return (DOC_RULES[action] as readonly Role[]).includes(role);
}

/** Approve or reject a draft: a reviewer who didn't write it, on an active document. */
export function canReview(role: Role, profileId: string, rev: { status: string; prepared_by: string | null }, doc: { status: string }): boolean {
  return canDoc("review", role) && rev.status === "draft" && rev.prepared_by !== profileId && doc.status === "active";
}

export function canAttachDocument(role: Role, wo: Pick<WorkOrder, "status">): boolean {
  return wo.status === "open" && canDoc("attach", role);
}

/** A document opened from the work order was used, so it stays. */
export function canDetachDocument(role: Role, wo: Pick<WorkOrder, "status">, viewCount: number): boolean {
  return wo.status === "open" && viewCount === 0 && canDoc("detach", role);
}
