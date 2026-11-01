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
    // Every record's site exists, and work orders only point at assets at their own site.
    const sites = new Set(db.sites.map((s) => s.id));
    for (const r of [...db.areas, ...db.assets, ...db.workOrders, ...db.inventory]) expect(sites.has(r.site_id)).toBe(true);
    for (const w of db.workOrders) {
      if (w.asset_id) expect(db.assets.find((a) => a.id === w.asset_id)!.site_id).toBe(w.site_id);
    }
    for (const a of db.siteAccess) {
      expect(people.has(a.user_id)).toBe(true);
      expect(sites.has(a.site_id)).toBe(true);
    }
  });

  it("uses unique ids and work order numbers", () => {
    const all = [
      ...db.sites,
      ...db.areas,
      ...db.profiles,
      ...db.assets,
      ...db.workOrders,
      ...db.tasks,
      ...db.events,
      ...db.parts,
      ...db.inventory,
      ...db.woParts,
      ...db.cableRoutes,
    ];
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(new Set(db.workOrders.map((w) => w.wo_number)).size).toBe(db.workOrders.length);
    expect(new Set(db.assets.map((a) => a.floc)).size).toBe(db.assets.length);
    expect(new Set(db.parts.map((p) => p.part_number)).size).toBe(db.parts.length);
  });

  it("never reserves more than is on hand", () => {
    for (const row of db.inventory) {
      expect(row.reserved).toBeGreaterThanOrEqual(0);
      expect(row.reserved).toBeLessThanOrEqual(row.on_hand);
    }
  });

  it("covers every lifecycle stage at every site", () => {
    for (const site of db.sites) {
      const stages = new Set(db.workOrders.filter((w) => w.site_id === site.id && w.status === "open").map((w) => w.stage));
      expect(stages.size, site.code).toBe(6);
    }
  });

  it("produces sensible dashboard metrics", () => {
    const brp = db.sites.find((s) => s.code === "BRP")!.id;
    const m = computeMetrics(
      db.workOrders.filter((w) => w.site_id === brp).map((w) => ({ ...w, asset: null, assignee_name: null })),
      db.inventory.filter((r) => r.site_id === brp).map((r) => ({ ...r, part: db.parts.find((p) => p.id === r.part_id)! })),
    );
    expect(m.stageCounts.planning).toBe(4);
    expect(m.estimateRatio).toBeGreaterThan(1); // the history overran, which Planning Mode learns from
  });
});

describe("demo timeline realism", () => {
  const now = new Date("2026-10-16T12:00:00Z").getTime();
  const DAY = 86_400_000;

  it("closes past work in the past, after a believable duration", () => {
    const closed = db.workOrders.filter((w) => w.status === "closed");
    expect(closed.length).toBeGreaterThan(0);
    for (const w of closed) {
      const opened = Date.parse(w.created_at);
      const done = Date.parse(w.closed_at!);
      expect(done, w.wo_number).toBeGreaterThan(opened);
      expect(done, w.wo_number).toBeLessThan(now);
      expect((done - opened) / DAY, w.wo_number).toBeLessThanOrEqual(40);
      expect(w.scheduled_date! <= w.closed_at!.slice(0, 10), w.wo_number).toBe(true);
    }
    // Closed history is spread over months, not stacked on one day.
    expect(new Set(closed.map((w) => w.closed_at!.slice(0, 7))).size).toBeGreaterThan(1);
  });

  it("records every work order's stage history in order", () => {
    for (const w of db.workOrders) {
      const times = db.events.filter((e) => e.wo_id === w.id).map((e) => Date.parse(e.created_at));
      expect([...times].sort((a, b) => a - b), w.wo_number).toEqual(times);
      expect(Math.max(...times), w.wo_number).toBeLessThanOrEqual(now);
    }
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
