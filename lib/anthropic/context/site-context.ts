import "server-only";
import type { Repository } from "@/lib/data/repository";
import { formatAttribute } from "@/lib/taxonomy/assess";
import type {
  Asset,
  AssetClassWithModes,
  InventoryItem,
  Profile,
  WorkOrderDetail,
  WorkOrderListItem,
} from "@/types/domain";

/**
 * Layer 3: site-specific context assembled from the database for one work
 * order — the asset, its class and known failure modes, its train, the
 * asset's work history with debriefs, stock on hand, and available crafts.
 */
export interface SiteContext {
  workOrder: WorkOrderDetail;
  asset: Asset | null;
  assetClass: AssetClassWithModes | null;
  related: Asset[];
  /** Class names by id, for labelling related equipment. */
  classNames: Map<string, string>;
  history: (WorkOrderListItem & { debrief: string | null })[];
  inventory: InventoryItem[];
  crew: Profile[];
  siteName: string;
}

export async function buildSiteContext(repo: Repository, woId: string): Promise<SiteContext | null> {
  const workOrder = await repo.getWorkOrder(woId);
  if (!workOrder) return null;

  const [assets, classes, inventory, profiles, { site }] = await Promise.all([
    repo.listAssets(),
    repo.listAssetClasses(),
    repo.listInventory(),
    repo.listProfiles(),
    repo.getSite(),
  ]);

  const asset = assets.find((a) => a.id === workOrder.asset_id) ?? null;
  const assetClass = asset ? classes.find((c) => c.id === asset.class_id) ?? null : null;
  // The asset's train: parent, children and siblings (for duty/standby pairs, same class in the same area).
  const related = asset
    ? assets.filter(
        (a) =>
          a.id !== asset.id &&
          (a.id === asset.parent_id ||
            a.parent_id === asset.id ||
            (a.area_id === asset.area_id && a.class_id !== null && a.class_id === asset.class_id)),
      )
    : [];

  const historyAssetIds = [asset, ...related].filter(Boolean).map((a) => a!.id);
  const histories = await Promise.all(historyAssetIds.map((id) => repo.listWorkOrders({ assetId: id })));
  const history = histories
    .flat()
    .filter((w) => w.id !== woId && w.status === "closed")
    .sort((a, b) => (b.closed_at ?? "").localeCompare(a.closed_at ?? ""))
    .slice(0, 8);

  return {
    workOrder,
    asset,
    assetClass,
    related,
    classNames: new Map(classes.map((c) => [c.id, c.name])),
    history,
    inventory,
    crew: profiles.filter((p) => p.role === "technician"),
    siteName: site.name,
  };
}

export function formatSiteContext(ctx: SiteContext): string {
  const wo = ctx.workOrder;
  const a = ctx.asset;
  const lines: string[] = [];

  lines.push(`## Work order ${wo.wo_number}: ${wo.title}`);
  lines.push(`Type: ${wo.wo_type}. Priority: P${wo.priority}. Stage: ${wo.stage}.`);
  lines.push(`Reported problem: ${wo.description}`);
  if (wo.tasks.length) {
    lines.push(`Existing plan steps: ${wo.tasks.map((t) => `${t.seq} ${t.description}`).join("; ")}`);
  }

  if (a) {
    lines.push("", `## Asset ${a.floc}: ${a.name}`);
    lines.push(
      `Class: ${ctx.assetClass ? `${ctx.assetClass.name} (${ctx.assetClass.code})` : "unclassified"}. Criticality: ${a.criticality}. Status: ${a.status}. Make/model: ${a.manufacturer ?? "?"} ${a.model ?? ""}. Installed: ${a.install_date ?? "unknown"}.`,
    );
    if (ctx.assetClass) {
      const nameplate = ctx.assetClass.attributes
        .filter((s) => a.attributes[s.key] !== undefined)
        .map((s) => `${s.label} ${formatAttribute(s, a.attributes[s.key])}`);
      const missing = ctx.assetClass.attributes.filter((s) => s.required && a.attributes[s.key] === undefined);
      if (nameplate.length) lines.push(`Nameplate: ${nameplate.join("; ")}.`);
      if (missing.length) lines.push(`Not on record: ${missing.map((s) => s.label).join(", ")}. Ask the planner or add to open questions if it matters for this job.`);
    }
    if (a.notes) lines.push(`Notes: ${a.notes}`);
  }
  if (ctx.assetClass?.failure_modes.length) {
    lines.push("", `## Known failure modes for the ${ctx.assetClass.name} class (code, mode, how it is detected)`);
    for (const m of ctx.assetClass.failure_modes) lines.push(`- ${m.code} ${m.name}: ${m.description} Detected by: ${m.detection}`);
  }
  if (ctx.related.length) {
    lines.push("", "## Related equipment (same train or duty/standby set)");
    for (const r of ctx.related) lines.push(`- ${r.floc} ${r.name} (${(r.class_id && ctx.classNames.get(r.class_id)) ?? "unclassified"}, ${r.status})`);
  }

  lines.push("", "## Closed work history on this equipment and its train, newest first");
  if (!ctx.history.length) lines.push("None on record.");
  for (const h of ctx.history) {
    lines.push(
      `- ${h.wo_number} on ${h.asset?.floc ?? "?"}, closed ${h.closed_at?.slice(0, 10) ?? "?"}: ${h.title}. Planned ${h.estimated_hours ?? "?"} h, actual ${h.actual_hours ?? "?"} h.${h.debrief ? ` Debrief: ${h.debrief}` : ""}`,
    );
  }

  lines.push("", "## Storeroom catalog with available stock (on hand minus reserved)");
  for (const i of ctx.inventory) {
    lines.push(
      `- ${i.part.part_number} | ${i.part.description} | available ${i.on_hand - i.reserved} ${i.part.unit} | bin ${i.bin}`,
    );
  }

  lines.push("", "## Crafts available");
  const byCraft = new Map<string, number>();
  for (const p of ctx.crew) byCraft.set(p.craft ?? "general", (byCraft.get(p.craft ?? "general") ?? 0) + 1);
  lines.push([...byCraft].map(([craft, n]) => `${craft}: ${n}`).join(", ") + ". Operations support available for isolations.");

  return lines.join("\n");
}
