import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDataset } from "@/lib/demo/dataset";
import { computeMetrics } from "@/lib/metrics";
import { DEMO_SCRIPTS } from "@/lib/planning/demo-plans";
import { jobPlanSchema } from "@/lib/planning/plan-schema";

const db = buildDataset(new Date("2026-10-16T12:00:00Z"));

describe("demo dataset", () => {
  it("has referential integrity", () => {
    const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
    const assets = ids(db.assets);
    const people = ids(db.profiles);
    const wos = ids(db.workOrders);
    const parts = ids(db.parts);

    for (const a of db.assets) if (a.parent_id) expect(assets.has(a.parent_id)).toBe(true);
    for (const w of db.workOrders) {
      if (w.asset_id) expect(assets.has(w.asset_id)).toBe(true);
      for (const p of [w.reported_by, w.assigned_to, w.planner_id]) if (p) expect(people.has(p)).toBe(true);
    }
    for (const t of db.tasks) expect(wos.has(t.wo_id)).toBe(true);
    for (const p of db.woParts) if (p.part_id) expect(parts.has(p.part_id)).toBe(true);
    for (const e of db.events) expect(wos.has(e.wo_id)).toBe(true);
  });

  it("uses unique ids and work order numbers", () => {
    const all = [...db.assets, ...db.workOrders, ...db.tasks, ...db.events, ...db.parts, ...db.inventory, ...db.woParts];
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(new Set(db.workOrders.map((w) => w.wo_number)).size).toBe(db.workOrders.length);
  });

  it("never reserves more than is on hand", () => {
    for (const row of db.inventory) {
      expect(row.reserved).toBeGreaterThanOrEqual(0);
      expect(row.reserved).toBeLessThanOrEqual(row.on_hand);
    }
  });

  it("covers every lifecycle stage", () => {
    const stages = new Set(db.workOrders.filter((w) => w.status === "open").map((w) => w.stage));
    expect(stages.size).toBe(6);
  });

  it("produces sensible dashboard metrics", () => {
    const m = computeMetrics(
      db.workOrders.map((w) => ({ ...w, asset: null, assignee_name: null })),
      db.inventory.map((r) => ({ ...r, part: db.parts.find((p) => p.id === r.part_id)! })),
    );
    expect(m.stageCounts.planning).toBe(4);
    expect(m.estimateRatio).toBeGreaterThan(1); // the history overran, which Planning Mode learns from
  });
});

describe("demo Planning Mode scripts", () => {
  const catalog = new Set(db.parts.map((p) => p.part_number));

  for (const [woNumber, script] of Object.entries(DEMO_SCRIPTS)) {
    it(`${woNumber}: plans are valid and only cite real catalog parts`, () => {
      const wo = db.workOrders.find((w) => w.wo_number === woNumber);
      expect(wo?.stage).toBe("planning");
      const plans = [script.plan, ...script.turns.flatMap((t) => (t.revise ? [t.revise(script.plan)] : []))];
      for (const plan of plans) {
        expect(jobPlanSchema.safeParse(plan).success).toBe(true);
        for (const p of plan.parts) if (p.part_number) expect(catalog.has(p.part_number)).toBe(true);
        const seqs = plan.tasks.map((t) => t.seq);
        expect(new Set(seqs).size).toBe(seqs.length);
      }
    });
  }
});

describe("fictional data hygiene", () => {
  // The demo plant is invented. Guard against real employer or site names creeping in.
  const banned = [/georgia[-\s]?pacific/i, /\bwauna\b/i, /\bGP\b/, /\bkraft\b/i, /\bpulp\b/i, /\bTAPPI\b/, /BLRBAC/i];
  const roots = ["app", "components", "lib", "types", "supabase", "scripts", "README.md"];

  function files(p: string): string[] {
    if (statSync(p).isFile()) return [p];
    return readdirSync(p).flatMap((f) => files(path.join(p, f)));
  }

  it("contains no references to real employers or the old vertical", () => {
    const hits: string[] = [];
    for (const root of roots) {
      for (const f of files(path.resolve(__dirname, "..", root))) {
        if (!/\.(ts|tsx|md|sql|css)$/.test(f)) continue;
        const text = readFileSync(f, "utf8");
        for (const re of banned) if (re.test(text)) hits.push(`${path.relative(process.cwd(), f)} ~ ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
