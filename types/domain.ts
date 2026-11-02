/**
 * Domain types for Trestle.MX.
 *
 * These mirror the Supabase schema in `supabase/migrations`. The demo data
 * layer and the Supabase data layer both return these shapes, so UI code never
 * cares which backend is active.
 */

export const ROLES = [
  "admin",
  "supervisor",
  "planner",
  "gatekeeper",
  "technician",
  "storeroom",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  planner: "Planner",
  gatekeeper: "Gatekeeper",
  technician: "Technician",
  storeroom: "Storeroom",
};

/** The six-stage work order lifecycle. */
export const WO_STAGES = [
  "identification",
  "vetting",
  "planning",
  "scheduling",
  "execution",
  "closure",
] as const;
export type WoStage = (typeof WO_STAGES)[number];

export const STAGE_LABELS: Record<WoStage, string> = {
  identification: "Identification",
  vetting: "Vetting",
  planning: "Planning",
  scheduling: "Scheduling",
  execution: "Execution",
  closure: "Closure",
};

export type WoStatus = "open" | "closed" | "rejected";
export type WoType = "corrective" | "preventive" | "predictive" | "emergency" | "project";
export type Priority = 1 | 2 | 3 | 4;
export type Criticality = "A" | "B" | "C";
export type Craft = "mechanical" | "electrical" | "instrumentation" | "operations" | "contractor";

/** Industry vertical. Set per site; asset classes declare which verticals use them. */
export const VERTICALS = ["industrial_utility", "data_center"] as const;
export type Vertical = (typeof VERTICALS)[number];

export const VERTICAL_LABELS: Record<Vertical, string> = {
  industrial_utility: "Industrial & utility",
  data_center: "Data center",
};

export interface Organization {
  id: string;
  name: string;
}

export interface Site {
  id: string;
  org_id: string;
  code: string;
  name: string;
  timezone: string;
  vertical: Vertical;
  /** Roles that may schedule and move work on the calendar at this site. Admin always can (TMX-015). */
  scheduler_roles: Role[];
}

export interface AreaCode {
  id: string;
  site_id: string;
  code: string;
  name: string;
}

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  craft: Craft | null;
  is_active: boolean;
}

export interface Asset {
  id: string;
  site_id: string;
  area_id: string;
  parent_id: string | null;
  floc: string;
  name: string;
  /** The controlled asset class from the org's class library. Null means unclassified. */
  class_id: string | null;
  /** Class-specific nameplate data, keyed by the class's attribute keys. */
  attributes: AssetAttributes;
  criticality: Criticality;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  status: "running" | "standby" | "down" | "retired";
  notes: string | null;
}

export type AttributeValue = string | number | boolean;
export type AssetAttributes = Record<string, AttributeValue>;

export type AttributeType = "text" | "number" | "enum" | "boolean";

/** One field an asset class requires or allows. */
export interface AttributeSpec {
  key: string;
  label: string;
  type: AttributeType;
  unit?: string;
  /** Allowed values when type is "enum". */
  options?: readonly string[];
  required: boolean;
}

export const CLASS_CATEGORIES = [
  "Rotating",
  "Electrical power",
  "Static and pressure",
  "Valves",
  "Instrumentation and controls",
  "HVAC and cooling",
  "Fire protection",
  "IT space and cabling",
] as const;
export type ClassCategory = (typeof CLASS_CATEGORIES)[number];

/**
 * A failure mode in ISO 14224 terms: the observed way the equipment stops
 * doing its job. Mechanisms (wear, fatigue, corrosion) and causes are coded
 * separately when a work order is resolved.
 */
export interface FailureMode {
  id: string;
  class_id: string;
  code: string;
  name: string;
  description: string;
  /** How the failure mode is found before or when it happens. */
  detection: string;
}

export interface AssetClass {
  id: string;
  org_id: string;
  code: string;
  name: string;
  category: ClassCategory;
  verticals: Vertical[];
  description: string;
  attributes: AttributeSpec[];
  is_active: boolean;
  /** Criticalities at which this class is run to failure: no PM, and no coverage warning. */
  run_to_failure: Criticality[];
  /** Days within which the same failure mode on the same asset counts as a repeat failure; null is off. */
  repeat_window_days: number | null;
}

export const PM_STRATEGIES = ["time_based", "condition_based", "failure_finding"] as const;
export type PmStrategy = (typeof PM_STRATEGIES)[number];

export const PM_STRATEGY_LABELS: Record<PmStrategy, string> = {
  time_based: "Time-based",
  condition_based: "Condition-based",
  failure_finding: "Failure-finding",
};

/** A PM task in the class library: what to do, how often, for whom, and which failure modes it addresses. */
export interface PmTask {
  id: string;
  class_id: string;
  code: string;
  title: string;
  strategy: PmStrategy;
  craft: Craft;
  crew_size: number;
  est_hours: number;
  interval_days: number;
  interval_days_crit_a: number | null;
  criticalities: Criticality[];
  failure_mode_codes: string[];
  requires_shutdown: boolean;
  acceptance_criteria: string | null;
  /** True for tasks from the starter library that the customer has not tuned yet. */
  is_starter_default: boolean;
}

/** A part each site must hold for its crit A assets of a class (optionally one model). */
export interface ClassSpare {
  id: string;
  class_id: string;
  part_id: string;
  qty: number;
  model: string | null;
}

export interface AssetClassWithModes extends AssetClass {
  failure_modes: FailureMode[];
  pm_tasks: PmTask[];
  spares: ClassSpare[];
}

/** One PM task scheduled on one asset: the maintenance index row. */
export interface PmSchedule {
  id: string;
  site_id: string;
  asset_id: string;
  pm_task_id: string;
  interval_days: number;
  last_done_on: string | null;
  next_due_on: string;
  is_active: boolean;
}

export interface PmDeferral {
  id: string;
  schedule_id: string;
  from_due_on: string;
  to_due_on: string;
  reason: string;
  approved_by: string | null;
  created_at: string;
}

export interface PmScheduleRow extends PmSchedule {
  asset: Pick<Asset, "id" | "floc" | "name" | "criticality">;
  task: PmTask;
  open_wo: Pick<WorkOrder, "id" | "wo_number" | "stage"> | null;
  deferrals: (PmDeferral & { approver_name: string | null })[];
}

export interface WorkOrder {
  id: string;
  site_id: string;
  wo_number: string;
  title: string;
  description: string;
  asset_id: string | null;
  wo_type: WoType;
  priority: Priority;
  stage: WoStage;
  status: WoStatus;
  requires_shutdown: boolean;
  reported_by: string | null;
  planner_id: string | null;
  assigned_to: string | null;
  scheduled_date: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  plan_summary: string | null;
  debrief: string | null;
  /** Set when the work order was generated from a PM schedule. */
  pm_schedule_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface WoTask {
  id: string;
  wo_id: string;
  seq: number;
  description: string;
  craft: Craft;
  crew_size: number;
  est_hours: number;
  safety_note: string | null;
  acceptance_criteria: string | null;
  is_complete: boolean;
}

export type WoEventType =
  | "created"
  | "stage_change"
  | "rejected"
  | "plan_committed"
  | "scheduled"
  | "task_completed"
  | "part_issued"
  | "closed"
  | "rescheduled"
  | "note";

export interface WoEvent {
  id: string;
  wo_id: string;
  event_type: WoEventType;
  from_stage: WoStage | null;
  to_stage: WoStage | null;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

/**
 * Cable stock in the storeroom: what it is, its dimensions and how each end
 * is terminated, so a technician can pick the exact replacement.
 */
export interface CableSpec {
  kind: "cable";
  media: "Fiber" | "Copper data" | "Power";
  /** e.g. "OS2 single-mode trunk", "Cat6A S/FTP patch cord", "208 V 3-phase power whip". */
  cable_type: string;
  /** Fiber count or conductor count. */
  count: number;
  /** Conductor gauge for copper and power (e.g. "26 AWG"), or fiber type (e.g. "OS2 9/125"). */
  gauge: string;
  /** Length in meters; null for bulk reels sold by the meter. */
  length_m: number | null;
  outer_diameter_mm: number;
  /** Jacket or listing, e.g. "OFNP plenum", "CMP plenum", "LSZH". */
  jacket: string;
  termination_a: string;
  termination_b: string;
  /** Fiber polarity method, e.g. "Type B". */
  polarity?: string;
  color?: string;
}

export type PartSpecs = CableSpec;

export interface Part {
  id: string;
  org_id: string;
  part_number: string;
  description: string;
  manufacturer: string | null;
  mfr_part_number: string | null;
  category: string;
  unit: string;
  unit_cost: number;
  /** Structured specification for parts that need one (cables). */
  specs: PartSpecs | null;
}

export interface InventoryRow {
  id: string;
  site_id: string;
  part_id: string;
  bin: string;
  on_hand: number;
  reserved: number;
  min_qty: number;
  max_qty: number;
}

export type WoPartStatus = "planned" | "reserved" | "kitted" | "issued";

export interface WoPart {
  id: string;
  wo_id: string;
  part_id: string | null;
  description: string;
  qty_required: number;
  qty_used: number;
  status: WoPartStatus;
}

/** Joined shapes used by the UI. */
export interface WorkOrderListItem extends WorkOrder {
  asset: Pick<Asset, "id" | "floc" | "name" | "criticality"> | null;
  assignee_name: string | null;
}

export interface WorkOrderDetail extends WorkOrderListItem {
  tasks: WoTask[];
  parts: (WoPart & { part: Part | null; stock: InventoryRow | null })[];
  events: (WoEvent & { actor_name: string | null })[];
}

export interface AssetDetail extends Asset {
  area: AreaCode;
  asset_class: AssetClassWithModes | null;
  parent: Pick<Asset, "id" | "floc" | "name"> | null;
  children: Pick<Asset, "id" | "floc" | "name" | "status">[];
  history: WorkOrderListItem[];
  /** For a cable: the tray sections it runs through, end A to end B. */
  route: RouteStep[];
  /** For a pathway: the cables routed through it. */
  carried_cables: Pick<Asset, "id" | "floc" | "name" | "status" | "attributes">[];
}

/**
 * One section of a cable's route: the cable runs through this pathway asset
 * (a cable tray section) in this order, from end A to end B.
 */
export interface CableRouteSegment {
  id: string;
  cable_id: string;
  seq: number;
  pathway_id: string;
  note: string | null;
}

export type RouteStep = Pick<CableRouteSegment, "seq" | "note"> & {
  pathway: Pick<Asset, "id" | "floc" | "name" | "attributes">;
};

export interface InventoryItem extends InventoryRow {
  part: Part;
}

// ---------------------------------------------------------------- Scheduling

export const CRAFTS: readonly Craft[] = ["mechanical", "electrical", "instrumentation", "operations", "contractor"];

export const CRAFT_LABELS: Record<Craft, string> = {
  mechanical: "Mechanical",
  electrical: "Electrical",
  instrumentation: "Instrumentation",
  operations: "Operations",
  contractor: "Contractor",
};

/** A technician's regular shift at a site: hours per shift and the weekdays worked (0 = Sunday). */
export interface CrewShift {
  id: string;
  site_id: string;
  profile_id: string;
  shift_hours: number;
  work_days: number[];
}

/** Time a technician is away. `hours_per_day` null means the whole shift. Inclusive dates. */
export interface TimeOff {
  id: string;
  site_id: string;
  profile_id: string;
  starts_on: string;
  ends_on: string;
  hours_per_day: number | null;
  reason: string;
  created_by: string | null;
  created_at: string;
}

/** A technician on the site roster, with the shift and time off that set their capacity (TMX-016). */
export interface CrewMember extends Profile {
  shift: CrewShift | null;
  time_off: TimeOff[];
}

/** An open work order as the scheduling calendar needs it. */
export interface CalendarWorkOrder
  extends Pick<
    WorkOrder,
    | "id"
    | "wo_number"
    | "title"
    | "stage"
    | "priority"
    | "wo_type"
    | "requires_shutdown"
    | "scheduled_date"
    | "assigned_to"
    | "estimated_hours"
    | "pm_schedule_id"
    | "created_at"
  > {
  asset: Pick<Asset, "id" | "floc" | "name" | "criticality"> | null;
  assignee: Pick<Profile, "id" | "full_name" | "craft"> | null;
  /** Crew-hours by craft from the job plan (est hours × crew size). Empty until the job is planned. */
  craft_hours: Partial<Record<Craft, number>>;
}
