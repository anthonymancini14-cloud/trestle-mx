import "server-only";
import { todayAt } from "@/lib/utils";
import type { Repository } from "@/lib/data/repository";
import { daysBetween } from "@/lib/pm/program";
import { formatAttribute } from "@/lib/taxonomy/assess";
import type {
  Asset,
  AssetClassWithModes,
  AssetDetail,
  CableSpec,
  PmScheduleRow,
  ResolutionHistoryItem,
  TroubleshootingRecord,
  InventoryItem,
  Profile,
  WorkOrderDetail,
  Vertical,
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
  vertical: Vertical;
  /** Cable work: the tray sections the cable runs through, end A to end B. */
  route: AssetDetail["route"];
  /** Tray work: the cables routed through this section. */
  carriedCables: AssetDetail["carried_cables"];
  /** The asset's PM schedule, so PMs due soon can be done in the same outage. */
  pmSchedules: PmScheduleRow[];
  /** Every WCE on this work order's JCN. */
  job: WorkOrderListItem[];
  /** This WCE's troubleshooting record so far. */
  record: TroubleshootingRecord;
  /** Resolutions on the history work orders, by work order id (the cause behind each past job). */
  causes: Map<string, ResolutionHistoryItem>;
  today: string;
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
  const detail = asset && (assetClass?.code === "CABLE" || assetClass?.code === "CABLE-TRAY") ? await repo.getAsset(asset.id) : null;
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

  // Cable work also learns from jobs on the tray sections it runs through, and
  // tray work from jobs on the cables it carries.
  const pathwayLinked = [...(detail?.route.map((s) => s.pathway.id) ?? []), ...(detail?.carried_cables.map((c) => c.id) ?? [])];
  const historyAssetIds = [...new Set([...[asset, ...related].filter(Boolean).map((a) => a!.id), ...pathwayLinked])];
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
    vertical: site.vertical,
    route: detail?.route ?? [],
    carriedCables: detail?.carried_cables ?? [],
    pmSchedules: asset ? await repo.listPmSchedules({ assetId: asset.id }) : [],
    job: await repo.listJcn(workOrder.jcn),
    record: await repo.getTroubleshooting(workOrder.id),
    causes: await causesFor(repo, historyAssetIds),
    today: todayAt(site.timezone),
  };
}

/** The newest resolution of each past work order on these assets. */
async function causesFor(repo: Repository, assetIds: string[]): Promise<Map<string, ResolutionHistoryItem>> {
  const all = (await Promise.all(assetIds.map((id) => repo.listResolutions({ assetId: id })))).flat();
  const out = new Map<string, ResolutionHistoryItem>();
  for (const r of all) {
    const prev = out.get(r.wo_id);
    if (!prev || r.created_at > prev.created_at) out.set(r.wo_id, r);
  }
  return out;
}

export function formatSiteContext(ctx: SiteContext): string {
  const wo = ctx.workOrder;
  const a = ctx.asset;
  const lines: string[] = [];

  lines.push(`## Work order ${wo.wo_number}: ${wo.title}`);
  lines.push(`This is WCE ${String(wo.wce_seq).padStart(3, "0")} on JCN ${wo.jcn}${wo.wce_seq === 1 ? " (the primary shop's WCE)" : ""}.`);
  const others = ctx.job.filter((w) => w.id !== wo.id);
  if (others.length) {
    lines.push(`Other WCEs on this JCN: ${others.map((w) => `${w.wo_number} ${w.title} (${w.status === "open" ? w.stage : w.status}${w.scheduled_date ? `, scheduled ${w.scheduled_date}` : ""})`).join("; ")}.`);
  }
  lines.push(`Type: ${wo.wo_type}. Priority: P${wo.priority}. Stage: ${wo.stage}.`);
  lines.push(`Reported problem: ${wo.description}`);
  if (wo.tasks.length) {
    lines.push(`Existing plan steps: ${wo.tasks.map((t) => `${t.seq} ${t.description}`).join("; ")}`);
  }
  const corrected = new Set([...ctx.record.actions, ...ctx.record.findings].map((e) => e.corrects_id).filter(Boolean));
  const actions = ctx.record.actions.filter((a) => !corrected.has(a.id));
  const findings = ctx.record.findings.filter((f) => !corrected.has(f.id));
  if (actions.length || findings.length) {
    lines.push("", "## Troubleshooting so far on this work order");
    for (const a of actions) {
      lines.push(`- Operator: saw ${a.conditions} Did: ${a.action} Result: ${a.result}${a.ran_minutes !== null ? ` (ran ${a.ran_minutes} min)` : ""}`);
    }
    for (const f of findings) {
      lines.push(`- Finding: ${f.test}${f.value !== null ? ` = ${f.value} ${f.unit ?? ""}`.trimEnd() : ""}${f.spec ? ` (spec ${f.spec})` : ""}: ${f.result}${f.note ? `. ${f.note}` : ""}`);
    }
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
  if (ctx.assetClass?.code === "CABLE" && a) {
    lines.push("", "## Cable route, end A to end B (name these tray sections in the plan so the crew works in the right tray)");
    lines.push(`End A: ${a.attributes.end_a ?? "not recorded"}`);
    if (!ctx.route.length) lines.push("No tray route recorded.");
    for (const step of ctx.route) {
      const t = step.pathway.attributes;
      lines.push(
        `- ${step.pathway.floc} ${step.pathway.name}: ${t.tray_type ?? "tray"}, ${t.width ?? "?"} x ${t.depth ?? "?"} in, ${t.service ?? "?"} service, ${t.location ?? "location not recorded"}.${step.note ? ` Route note: ${step.note}.` : ""}`,
      );
    }
    lines.push(`End B: ${a.attributes.end_b ?? "not recorded"}`);
    const pn = typeof a.attributes.part_number === "string" ? a.attributes.part_number : null;
    const stock = pn ? ctx.inventory.find((i) => i.part.part_number === pn) : undefined;
    lines.push("", "## Replacement cable from the storeroom");
    if (!stock) lines.push(pn ? `${pn} is the recorded spec but it is not stocked at this site.` : "No storeroom part recorded for this cable.");
    else {
      lines.push(`${stock.part.part_number} | ${stock.part.description} | available ${stock.on_hand - stock.reserved} ${stock.part.unit} | bin ${stock.bin}`);
      if (stock.part.specs?.kind === "cable") lines.push(`Spec: ${formatCableSpec(stock.part.specs)}`);
    }
  }
  if (ctx.assetClass?.code === "CABLE-TRAY") {
    lines.push("", "## Cables routed through this tray section");
    if (!ctx.carriedCables.length) lines.push("None recorded.");
    for (const c of ctx.carriedCables) lines.push(`- ${c.floc} ${c.name} (${c.attributes.media ?? "?"})`);
  }
  if (ctx.pmSchedules.length) {
    lines.push("", "## PM schedule on this asset (fold PMs due soon into this job if the asset comes out of service anyway)");
    for (const s of ctx.pmSchedules) {
      const days = daysBetween(ctx.today, s.next_due_on);
      const when = days < 0 ? `OVERDUE by ${-days} days` : `due in ${days} days`;
      lines.push(
        `- ${s.task.code} ${s.task.title}: every ${s.interval_days} days, ${when} (${s.next_due_on}), ${s.task.est_hours} h ${s.task.craft}${s.task.requires_shutdown ? ", needs the asset out of service" : ""}. Addresses ${s.task.failure_mode_codes.join(", ")}.${s.open_wo ? ` Open work order ${s.open_wo.wo_number}.` : ""}`,
      );
    }
  }
  if (ctx.related.length) {
    lines.push("", "## Related equipment (same train or duty/standby set)");
    for (const r of ctx.related) lines.push(`- ${r.floc} ${r.name} (${(r.class_id && ctx.classNames.get(r.class_id)) ?? "unclassified"}, ${r.status})`);
  }

  lines.push("", "## Closed work history on this equipment and its train, newest first");
  if (!ctx.history.length) lines.push("None on record.");
  for (const h of ctx.history) {
    lines.push(
      `- ${h.wo_number} on ${h.asset?.floc ?? "?"}, closed ${h.closed_at?.slice(0, 10) ?? "?"}: ${h.title}. Planned ${h.estimated_hours ?? "?"} h, actual ${h.actual_hours ?? "?"} h.${h.debrief ? ` Debrief: ${h.debrief}` : ""}${formatCause(ctx.causes.get(h.id))}`,
    );
  }

  lines.push("", "## Storeroom catalog with available stock (on hand minus reserved)");
  for (const i of ctx.inventory) {
    const spec = i.part.specs?.kind === "cable" ? ` | ${formatCableSpec(i.part.specs)}` : "";
    lines.push(`- ${i.part.part_number} | ${i.part.description} | available ${i.on_hand - i.reserved} ${i.part.unit} | bin ${i.bin}${spec}`);
  }

  lines.push("", "## Crafts available");
  const byCraft = new Map<string, number>();
  for (const p of ctx.crew) byCraft.set(p.craft ?? "general", (byCraft.get(p.craft ?? "general") ?? 0) + 1);
  lines.push([...byCraft].map(([craft, n]) => `${craft}: ${n}`).join(", ") + ". Operations support available for isolations.");

  return lines.join("\n");
}

function formatCause(r: ResolutionHistoryItem | undefined): string {
  if (!r) return "";
  if (r.no_fault_found) return ` Resolution: no fault found. ${r.cause_narrative}`;
  const codes = [r.failure_mode, r.mechanism && `mechanism ${r.mechanism}`, r.cause && `cause ${r.cause}`].filter(Boolean).join(", ");
  return ` Proven cause (${codes}): ${r.cause_narrative} Fix: ${r.remedy}${r.verification ? ` Verified: ${r.verification}` : ""}${r.operator_review !== "none_taken" ? ` Operator first response ${r.operator_review.replace("_", " ")}${r.operator_review_note ? `: ${r.operator_review_note}` : ""}.` : ""}`;
}

function formatCableSpec(s: CableSpec): string {
  return [
    s.cable_type,
    `${s.count} ${s.media === "Fiber" ? "fibers" : "conductors"}, ${s.gauge}`,
    s.length_m === null ? "bulk" : `${s.length_m} m`,
    `OD ${s.outer_diameter_mm} mm`,
    s.jacket,
    `end A ${s.termination_a}`,
    `end B ${s.termination_b}`,
    s.polarity ? `polarity ${s.polarity}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}
