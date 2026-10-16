import type { JobPlan } from "@/lib/planning/plan-schema";
import type {
  AreaCode,
  Asset,
  AssetDetail,
  InventoryItem,
  Organization,
  Priority,
  Profile,
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
  listProfiles(): Promise<Profile[]>;
  listAreas(): Promise<AreaCode[]>;

  listWorkOrders(filter?: WorkOrderFilter): Promise<WorkOrderListItem[]>;
  getWorkOrder(id: string): Promise<WorkOrderDetail | null>;

  listAssets(): Promise<Asset[]>;
  getAsset(id: string): Promise<AssetDetail | null>;

  listInventory(): Promise<InventoryItem[]>;

  createWorkOrder(input: NewWorkOrderInput, actorId: string): Promise<string>;
  moveStage(woId: string, to: WoStage, actorId: string, note?: string): Promise<void>;
  rejectWorkOrder(woId: string, actorId: string, note: string): Promise<void>;
  commitPlan(woId: string, plan: JobPlan, actorId: string): Promise<void>;
  scheduleWorkOrder(woId: string, date: string, assigneeId: string, actorId: string): Promise<void>;
  completeTask(taskId: string, actorId: string): Promise<void>;
  issuePart(woPartId: string, actorId: string): Promise<void>;
  closeWorkOrder(woId: string, actualHours: number, debrief: string, actorId: string): Promise<void>;
}
