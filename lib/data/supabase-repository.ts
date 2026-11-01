import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobPlan } from "@/lib/planning/plan-schema";
import type { NewWorkOrderInput, Repository, WorkOrderFilter } from "./repository";
import type {
  AreaCode,
  Asset,
  AssetClassWithModes,
  AssetDetail,
  InventoryItem,
  InventoryRow,
  Organization,
  Part,
  Profile,
  Site,
  WoEvent,
  WoPart,
  WoStage,
  WoTask,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderListItem,
} from "@/types/domain";

/**
 * Supabase-backed repository. Every query runs under the signed-in user's JWT,
 * so row-level security (site_access) scopes all reads and writes. Multi-row
 * writes that must be atomic (committing a plan, issuing stock) go through
 * Postgres functions defined in the migrations.
 */

const WO_LIST_SELECT =
  "*, asset:assets(id, floc, name, criticality), assignee:profiles!work_orders_assigned_to_fkey(full_name)";

type WoRow = WorkOrder & {
  asset: WorkOrderListItem["asset"];
  assignee: { full_name: string } | null;
};

function toListItem(row: WoRow): WorkOrderListItem {
  const { assignee, ...rest } = row;
  return { ...rest, assignee_name: assignee?.full_name ?? null };
}

type Result<T> = { data: T | null; error: { message: string } | null };

function unwrap<T>(result: Result<T>): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("No data returned");
  return result.data;
}

export class SupabaseRepository implements Repository {
  readonly mode = "live" as const;

  constructor(
    private readonly db: SupabaseClient,
    private readonly siteId: string,
  ) {}

  async getSite() {
    const site = unwrap<Site>(await this.db.from("sites").select("*").eq("id", this.siteId).single());
    const org = unwrap<Organization>(await this.db.from("organizations").select("*").eq("id", site.org_id).single());
    return { site, org };
  }

  async listSites() {
    // RLS limits sites to the ones in this user's site_access rows.
    return unwrap<Site[]>(await this.db.from("sites").select("*").order("name"));
  }

  async listProfiles() {
    // Profiles visible to this user are limited by RLS to people sharing a site.
    return unwrap<Profile[]>(await this.db.from("profiles").select("*").eq("is_active", true).order("full_name"));
  }

  async listAreas() {
    return unwrap<AreaCode[]>(await this.db.from("area_codes").select("*").eq("site_id", this.siteId).order("code"));
  }

  async listWorkOrders(filter: WorkOrderFilter = {}) {
    let query = this.db.from("work_orders").select(WO_LIST_SELECT).eq("site_id", this.siteId);
    if (filter.stage) query = query.eq("stage", filter.stage);
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.assetId) query = query.eq("asset_id", filter.assetId);
    const rows = unwrap<WoRow[]>(await query.order("priority").order("created_at", { ascending: false }));
    return rows.map(toListItem);
  }

  async getWorkOrder(id: string): Promise<WorkOrderDetail | null> {
    const { data, error } = await this.db.from("work_orders").select(WO_LIST_SELECT).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const [tasks, parts, events] = await Promise.all([
      this.db.from("wo_tasks").select("*").eq("wo_id", id).order("seq"),
      this.db.from("wo_parts").select("*, part:parts_catalog(*)").eq("wo_id", id),
      this.db
        .from("wo_events")
        .select("*, actor:profiles(full_name)")
        .eq("wo_id", id)
        .order("created_at", { ascending: false }),
    ]);
    const partRows = unwrap<(WoPart & { part: Part | null })[]>(parts);
    const partIds = partRows.map((p) => p.part_id).filter((x): x is string => !!x);
    const stock = partIds.length
      ? unwrap<InventoryRow[]>(
          await this.db.from("inventory").select("*").eq("site_id", this.siteId).in("part_id", partIds),
        )
      : [];
    return {
      ...toListItem(data as WoRow),
      tasks: unwrap<WoTask[]>(tasks),
      parts: partRows.map((p) => ({ ...p, stock: stock.find((s) => s.part_id === p.part_id) ?? null })),
      events: unwrap<(WoEvent & { actor: { full_name: string } | null })[]>(events).map(({ actor, ...e }) => ({
        ...e,
        actor_name: actor?.full_name ?? null,
      })),
    };
  }

  async listAssets() {
    return unwrap<Asset[]>(await this.db.from("assets").select("*").eq("site_id", this.siteId).order("floc"));
  }

  async getAsset(id: string): Promise<AssetDetail | null> {
    const { data, error } = await this.db.from("assets").select("*, area:area_codes(*)").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const asset = data as Asset & { area: AreaCode };
    const [parent, children, history, assetClass, route, carried] = await Promise.all([
      asset.parent_id
        ? this.db.from("assets").select("id, floc, name").eq("id", asset.parent_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      this.db.from("assets").select("id, floc, name, status").eq("parent_id", id).order("floc"),
      this.listWorkOrders({ assetId: id }),
      asset.class_id
        ? this.db.from("asset_classes").select("*, failure_modes:asset_class_failure_modes(*)").eq("id", asset.class_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      this.db
        .from("cable_routes")
        .select("seq, note, pathway:assets!cable_routes_pathway_id_fkey(id, floc, name, attributes)")
        .eq("cable_id", id)
        .order("seq"),
      this.db
        .from("cable_routes")
        .select("cable:assets!cable_routes_cable_id_fkey(id, floc, name, status, attributes)")
        .eq("pathway_id", id),
    ]);
    return {
      ...asset,
      asset_class: assetClass.data ? sortModes(assetClass.data as AssetClassWithModes) : null,
      // Without generated types, supabase-js types to-one embeds as arrays; they are objects at runtime.
      route: unwrap<AssetDetail["route"]>(route as unknown as Result<AssetDetail["route"]>),
      carried_cables: unwrap<{ cable: AssetDetail["carried_cables"][number] }[]>(
        carried as unknown as Result<{ cable: AssetDetail["carried_cables"][number] }[]>,
      )
        .map((r) => r.cable)
        .sort((a, b) => a.floc.localeCompare(b.floc)),
      parent: (parent.data as AssetDetail["parent"]) ?? null,
      children: unwrap<AssetDetail["children"]>(children),
      history,
    };
  }

  async listAssetClasses() {
    const { org } = await this.getSite();
    const rows = unwrap<AssetClassWithModes[]>(
      await this.db
        .from("asset_classes")
        .select("*, failure_modes:asset_class_failure_modes(*)")
        .eq("org_id", org.id)
        .eq("is_active", true)
        .order("category")
        .order("name"),
    );
    return rows.map(sortModes);
  }

  async listInventory() {
    const rows = unwrap<InventoryItem[]>(
      await this.db.from("inventory").select("*, part:parts_catalog(*)").eq("site_id", this.siteId),
    );
    return rows.sort((a, b) => a.part.part_number.localeCompare(b.part.part_number));
  }

  async createWorkOrder(input: NewWorkOrderInput, actorId: string) {
    const row = unwrap<{ id: string }>(
      await this.db
        .from("work_orders")
        .insert({ ...input, site_id: this.siteId, reported_by: actorId })
        .select("id")
        .single(),
    );
    await this.logEvent(row.id, { event_type: "created", from_stage: null, to_stage: "identification", note: null }, actorId);
    return row.id;
  }

  async moveStage(woId: string, to: WoStage, actorId: string, note?: string) {
    const from = await this.currentStage(woId);
    unwrapVoid(await this.db.from("work_orders").update({ stage: to }).eq("id", woId));
    await this.logEvent(woId, { event_type: "stage_change", from_stage: from, to_stage: to, note: note ?? null }, actorId);
  }

  async rejectWorkOrder(woId: string, actorId: string, note: string) {
    const from = await this.currentStage(woId);
    unwrapVoid(await this.db.from("work_orders").update({ status: "rejected" }).eq("id", woId));
    await this.logEvent(woId, { event_type: "rejected", from_stage: from, to_stage: null, note }, actorId);
  }

  async commitPlan(woId: string, plan: JobPlan, _actorId: string) {
    // Atomic: replaces tasks and parts, reserves stock, logs the event, advances the stage.
    unwrapVoid(await this.db.rpc("commit_work_order_plan", { p_wo_id: woId, p_plan: plan }));
  }

  async scheduleWorkOrder(woId: string, date: string, assigneeId: string, actorId: string) {
    unwrapVoid(
      await this.db
        .from("work_orders")
        .update({ scheduled_date: date, assigned_to: assigneeId, stage: "execution" })
        .eq("id", woId),
    );
    unwrapVoid(await this.db.from("wo_parts").update({ status: "kitted" }).eq("wo_id", woId).eq("status", "reserved"));
    await this.logEvent(woId, { event_type: "scheduled", from_stage: "scheduling", to_stage: "execution", note: date }, actorId);
  }

  async completeTask(taskId: string, actorId: string) {
    const task = unwrap<WoTask>(
      await this.db.from("wo_tasks").update({ is_complete: true }).eq("id", taskId).select("*").single(),
    );
    await this.logEvent(
      task.wo_id,
      { event_type: "task_completed", from_stage: null, to_stage: null, note: `Step ${task.seq}: ${task.description}` },
      actorId,
    );
  }

  async issuePart(woPartId: string, _actorId: string) {
    unwrapVoid(await this.db.rpc("issue_work_order_part", { p_wo_part_id: woPartId }));
  }

  async closeWorkOrder(woId: string, actualHours: number, debrief: string, actorId: string) {
    unwrapVoid(
      await this.db
        .from("work_orders")
        .update({ status: "closed", actual_hours: actualHours, debrief, closed_at: new Date().toISOString() })
        .eq("id", woId),
    );
    await this.logEvent(woId, { event_type: "closed", from_stage: "closure", to_stage: null, note: debrief }, actorId);
  }

  private async currentStage(woId: string): Promise<WoStage> {
    return unwrap<{ stage: WoStage }>(await this.db.from("work_orders").select("stage").eq("id", woId).single()).stage;
  }

  private async logEvent(
    woId: string,
    event: Pick<WoEvent, "event_type" | "from_stage" | "to_stage" | "note">,
    actorId: string,
  ) {
    unwrapVoid(await this.db.from("wo_events").insert({ ...event, wo_id: woId, actor_id: actorId }));
  }
}

function unwrapVoid(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

function sortModes(c: AssetClassWithModes): AssetClassWithModes {
  return { ...c, failure_modes: [...(c.failure_modes ?? [])].sort((a, b) => a.code.localeCompare(b.code)) };
}
