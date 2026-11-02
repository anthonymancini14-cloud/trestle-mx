import type { JobPlan } from "@/lib/planning/plan-schema";
import type {
  AreaCode,
  Asset,
  AssetClassWithModes,
  AssetDetail,
  FailureCode,
  Finding,
  OperatorAction,
  Resolution,
  ResolutionHistoryItem,
  TroubleshootingRecord,
  CalendarWorkOrder,
  CrewMember,
  InventoryItem,
  Organization,
  PmScheduleRow,
  Priority,
  Profile,
  Role,
  Site,
  WoStage,
  WoType,
  WorkOrderDetail,
  WorkOrderListItem,
} from "@/types/domain";

export interface WorkOrderFilter {
  stage?: WoStage;
  status?: "open" | "closed" | "rejected";
  assetId?: string;
}

export type NewOperatorAction = Pick<OperatorAction, "conditions" | "action" | "result" | "ran_minutes" | "corrects_id">;
export type NewFinding = Pick<Finding, "test" | "value" | "unit" | "spec" | "result" | "note" | "corrects_id">;
export type NewResolution = Omit<Resolution, "id" | "wo_id" | "supersedes_id" | "created_by" | "created_at">;

export interface NewTimeOffInput {
  profile_id: string;
  starts_on: string;
  ends_on: string;
  /** Null for the whole shift. */
  hours_per_day: number | null;
  reason: string;
}

export interface NewWorkOrderInput {
  title: string;
  description: string;
  asset_id: string | null;
  wo_type: WoType;
  priority: Priority;
  requires_shutdown: boolean;
}

/**
 * Everything the app reads or writes goes through this interface. Two
 * implementations: an in-memory demo store (no setup, used for the public
 * demo) and Supabase (multi-tenant, RLS-enforced). Role checks happen in the
 * server actions before a mutation is called.
 */
export interface Repository {
  readonly mode: "demo" | "live";

  getSite(): Promise<{ site: Site; org: Organization }>;
  /** Sites this user can switch to. */
  listSites(): Promise<Site[]>;
  listProfiles(): Promise<Profile[]>;
  listAreas(): Promise<AreaCode[]>;

  listWorkOrders(filter?: WorkOrderFilter): Promise<WorkOrderListItem[]>;
  getWorkOrder(id: string): Promise<WorkOrderDetail | null>;

  listAssets(): Promise<Asset[]>;
  getAsset(id: string): Promise<AssetDetail | null>;

  /** The organization's asset class library, each class with its failure modes. */
  listAssetClasses(): Promise<AssetClassWithModes[]>;

  listInventory(): Promise<InventoryItem[]>;

  /** The site's PM program: every PM task scheduled on every asset, with its open work order and deferrals. */
  listPmSchedules(filter?: { assetId?: string }): Promise<PmScheduleRow[]>;
  /** Create work orders for PMs due within the lead window (straight to Scheduling). Returns how many were created. */
  generateDuePms(asOf: string, actorId: string): Promise<number>;
  /** Move a PM's due date with a reason. Supervisors only (checked in the server action and, live, in the database). */
  deferPm(scheduleId: string, toDate: string, reason: string, actorId: string): Promise<void>;

  /** Technicians on the site roster with their shift and time off (calendar capacity). */
  listCrew(): Promise<CrewMember[]>;
  /** Open work orders (Identification to Execution) with their crew-hours by craft. */
  listCalendarWork(): Promise<CalendarWorkOrder[]>;
  /** Move a scheduled job to another day. Logged as a reschedule on the work order. */
  rescheduleWorkOrder(woId: string, date: string, actorId: string, reason?: string): Promise<void>;
  /** Admin only: which roles may schedule at this site. */
  setSchedulerRoles(roles: Role[], actorId: string): Promise<void>;
  addTimeOff(input: NewTimeOffInput, actorId: string): Promise<void>;
  updateShift(profileId: string, shiftHours: number, workDays: number[], actorId: string): Promise<void>;

  /** A WCE's troubleshooting record: operator actions, findings, resolutions (newest first) and addenda. */
  getTroubleshooting(woId: string): Promise<TroubleshootingRecord>;
  /** Failure mechanisms and causes (failure modes come from the asset class). */
  listFailureCodes(): Promise<FailureCode[]>;
  /** Every resolution at the site with its work order, for history and repeat-failure checks. */
  listResolutions(filter?: { assetId?: string }): Promise<ResolutionHistoryItem[]>;
  addOperatorAction(woId: string, input: NewOperatorAction, actorId: string): Promise<void>;
  addFinding(woId: string, input: NewFinding, actorId: string): Promise<void>;
  /** Record (or supersede) the resolution. Linked findings must be on the same work order. */
  recordResolution(woId: string, input: NewResolution, actorId: string): Promise<void>;
  /** A note on a closed work order, which is never edited. */
  addAddendum(woId: string, body: string, actorId: string): Promise<void>;

  /** Report a new discrepancy: a new JCN with its WCE -001. Returns the work order id. */
  createWorkOrder(input: NewWorkOrderInput, actorId: string): Promise<string>;
  /** Every WCE on a JCN, -001 first. */
  listJcn(jcn: string): Promise<WorkOrderListItem[]>;
  /** Another shop's WCE on an open JCN (next -NNN). Starts in Identification. */
  addWce(jcn: string, input: NewWorkOrderInput, actorId: string): Promise<string>;
  /**
   * Close a WCE that can't be finished as deferred: the work is written up under
   * a new JCN (its -001 starts in Vetting) and this WCE is signed off "Corrective
   * action deferred, see JCN …". Returns the new work order's id.
   */
  deferWorkOrder(woId: string, reason: string, actorId: string): Promise<string>;
  /** When a part that isn't on site is expected (storeroom or planner). */
  setPartEta(woPartId: string, date: string | null, actorId: string): Promise<void>;
  moveStage(woId: string, to: WoStage, actorId: string, note?: string): Promise<void>;
  rejectWorkOrder(woId: string, actorId: string, note: string): Promise<void>;
  commitPlan(woId: string, plan: JobPlan, actorId: string): Promise<void>;
  scheduleWorkOrder(woId: string, date: string, assigneeId: string, actorId: string): Promise<void>;
  completeTask(taskId: string, actorId: string): Promise<void>;
  issuePart(woPartId: string, actorId: string): Promise<void>;
  closeWorkOrder(woId: string, actualHours: number, debrief: string, actorId: string): Promise<void>;
}
