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
  asset_class: string;
  criticality: Criticality;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  install_date: string | null;
  status: "running" | "standby" | "down" | "retired";
  notes: string | null;
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
  parent: Pick<Asset, "id" | "floc" | "name"> | null;
  children: Pick<Asset, "id" | "floc" | "name" | "status">[];
  history: WorkOrderListItem[];
}

export interface InventoryItem extends InventoryRow {
  part: Part;
}
