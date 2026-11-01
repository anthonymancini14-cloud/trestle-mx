import { beforeEach, describe, expect, it } from "vitest";
import { loadStaticContext } from "@/lib/anthropic/context/loader";
import { buildSiteContext, formatSiteContext } from "@/lib/anthropic/context/site-context";
import { indexOptions, searchAssets } from "@/lib/assets/search";
import { demoProfileFor } from "@/lib/auth/viewer";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { buildDataset, DEFAULT_DEMO_SITE_ID } from "@/lib/demo/dataset";
import { DC_SITE } from "@/lib/demo/seed-datacenter";
import { SITE } from "@/lib/demo/seed";
import { DEMO_SCRIPTS } from "@/lib/planning/demo-plans";
import type { CableSpec } from "@/types/domain";

const db = buildDataset(new Date("2026-10-16T12:00:00Z"));
const classCode = (id: string | null) => db.assetClasses.find((c) => c.id === id)?.code;
const cables = db.assets.filter((a) => classCode(a.class_id) === "CABLE");

describe("cable plant records", () => {
  it("routes every installed cable through tray sections at its own site, in order", () => {
    expect(cables.length).toBeGreaterThanOrEqual(6);
    for (const cable of cables) {
      const route = db.cableRoutes.filter((r) => r.cable_id === cable.id);
      expect(route.length, cable.floc).toBeGreaterThan(0);
      const seqs = route.map((r) => r.seq);
      expect([...seqs].sort((a, b) => a - b), cable.floc).toEqual(seqs);
      for (const step of route) {
        const tray = db.assets.find((a) => a.id === step.pathway_id)!;
        expect(classCode(tray.class_id), `${cable.floc} → ${tray.floc}`).toBe("CABLE-TRAY");
        expect(tray.site_id).toBe(cable.site_id);
      }
    }
  });

  it("keeps power cables out of data trays and data cables out of power trays", () => {
    for (const step of db.cableRoutes) {
      const cable = db.assets.find((a) => a.id === step.cable_id)!;
      const tray = db.assets.find((a) => a.id === step.pathway_id)!;
      const isPowerTray = tray.attributes.service === "Power";
      expect(isPowerTray, `${cable.floc} in ${tray.floc}`).toBe(cable.attributes.media === "Power");
    }
  });

  it("points every cable at a stocked storeroom spec of the same media that is long enough", () => {
    for (const cable of cables) {
      const part = db.parts.find((p) => p.part_number === cable.attributes.part_number);
      expect(part, cable.floc).toBeTruthy();
      const spec = part!.specs as CableSpec;
      expect(spec?.kind).toBe("cable");
      expect(spec.media).toBe(cable.attributes.media);
      if (typeof cable.attributes.installed_length === "number" && spec.length_m !== null) {
        expect(cable.attributes.installed_length, cable.floc).toBeLessThanOrEqual(spec.length_m);
      }
      expect(db.inventory.some((r) => r.part_id === part!.id && r.site_id === cable.site_id), cable.floc).toBe(true);
    }
  });

  it("gives every cable spec dimensions and both terminations", () => {
    for (const part of db.parts.filter((p) => p.specs)) {
      const s = part.specs as CableSpec;
      expect(s.outer_diameter_mm, part.part_number).toBeGreaterThan(0);
      expect(s.count).toBeGreaterThan(0);
      expect(s.termination_a && s.termination_b && s.jacket && s.gauge && s.cable_type).toBeTruthy();
      expect(part.category).toBe("Cable");
    }
  });
});

describe("site scoping in the demo store", () => {
  beforeEach(() => resetDemoStore());

  it("defaults to the data center and only shows each site's own records", async () => {
    expect(DEFAULT_DEMO_SITE_ID).toBe(DC_SITE.id);
    const dc = new DemoRepository(DC_SITE.id);
    const brp = new DemoRepository(SITE.id);
    const dcWos = await dc.listWorkOrders();
    expect(dcWos.length).toBeGreaterThan(0);
    expect(dcWos.every((w) => w.site_id === DC_SITE.id)).toBe(true);
    expect((await brp.listAssets()).every((a) => a.site_id === SITE.id)).toBe(true);
    expect((await dc.listInventory()).every((i) => i.site_id === DC_SITE.id)).toBe(true);
    // A Basalt Ridge work order is invisible from the data center, like RLS.
    const brpWo = (await brp.listWorkOrders())[0];
    expect(await dc.getWorkOrder(brpWo.id)).toBeNull();
    await expect(dc.moveStage(brpWo.id, "vetting", "x")).rejects.toThrow();
  });

  it("lists each site's own people, with the org admin at both", async () => {
    const dcPeople = await new DemoRepository(DC_SITE.id).listProfiles();
    const brpPeople = await new DemoRepository(SITE.id).listProfiles();
    expect(dcPeople.map((p) => p.full_name)).toContain("Owen Castillo");
    expect(dcPeople.map((p) => p.full_name)).not.toContain("Marcus Reyes");
    const admin = brpPeople.find((p) => p.role === "admin")!;
    expect(dcPeople.some((p) => p.id === admin.id)).toBe(true);
  });

  it("falls back to the site's planner when the chosen person doesn't work there", () => {
    const marcus = db.profiles.find((p) => p.full_name === "Marcus Reyes")!;
    expect(demoProfileFor(SITE.id, marcus.id).full_name).toBe("Marcus Reyes");
    expect(demoProfileFor(DC_SITE.id, marcus.id).full_name).toBe("Owen Castillo");
  });

  it("commits the cable plan against the data center storeroom", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === "WO-26-2007")!;
    await repo.commitPlan(wo.id, DEMO_SCRIPTS["WO-26-2007"].plan, db.profiles.find((p) => p.full_name === "Owen Castillo")!.id);
    const after = await repo.getWorkOrder(wo.id);
    expect(after?.stage).toBe("scheduling");
    const trunk = after!.parts.find((p) => p.part?.part_number === "MX-FIB-MPO24-OS2-45M")!;
    expect(trunk.status).toBe("reserved");
    expect(trunk.stock?.site_id).toBe(DC_SITE.id);
  });
});

describe("Planning Mode for cable work", () => {
  beforeEach(() => resetDemoStore());

  it("gives Claude the cable's route, end points and replacement spec", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === "WO-26-2007")!;
    const ctx = await buildSiteContext(repo, wo.id);
    expect(ctx!.vertical).toBe("data_center");
    const text = formatSiteContext(ctx!);
    expect(text).toContain("## Cable route, end A to end B");
    expect(text).toContain("End A: CFD-MMR-ODF-01, panel 2, MPO port 1");
    const order = ["CFD-MMR-CT-01", "CFD-DH1-CT-X1", "CFD-DH1-CT-A"].map((tag) => text.indexOf(`- ${tag} `));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("## Replacement cable from the storeroom");
    expect(text).toContain("OD 4.5 mm");
    expect(text).toContain("polarity Type B");
    // The tray job whose debrief flagged this trunk is in the history.
    expect(ctx!.history.map((h) => h.wo_number)).toContain("WO-26-2001");
    expect(text).toContain("left it as found");
  });

  it("lists the cables in a tray section for tray work", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === "WO-26-2010")!;
    const text = formatSiteContext((await buildSiteContext(repo, wo.id))!);
    expect(text).toContain("## Cables routed through this tray section");
    expect(text).toContain("CFD-DH1-CBL-0103");
  });

  it("loads the data center guidance pack for data center sites only", async () => {
    const dc = await loadStaticContext("data_center");
    const plant = await loadStaticContext("industrial_utility");
    expect(dc.some((d) => d.file === "02-cable-plant.md")).toBe(true);
    expect(dc.some((d) => d.file === "01-utility-operations.md")).toBe(false);
    expect(plant.some((d) => d.file === "01-utility-operations.md")).toBe(true);
    expect(plant.some((d) => d.file === "02-cable-plant.md")).toBe(false);
  });
});

describe("asset picker search", () => {
  const index = indexOptions(
    db.assets.map((a) => ({
      id: a.id,
      floc: a.floc,
      name: a.name,
      className: db.assetClasses.find((c) => c.id === a.class_id)!.name,
      area: db.areas.find((x) => x.id === a.area_id)!.name,
    })),
  );

  it("matches every word in any order across tag, name, class and area", () => {
    const { results } = searchAssets(index, "pump high service b");
    expect(results[0].floc).toBe("BRP-HSP-P-201B");
    expect(searchAssets(index, "fiber trunk a03").results[0].floc).toBe("CFD-DH1-CBL-0101");
    expect(searchAssets(index, "ladder rack").results.every((r) => r.className === "Cable tray section")).toBe(true);
  });

  it("finds a tag typed without separators and ranks the exact tag first", () => {
    expect(searchAssets(index, "hspp201b").results[0].floc).toBe("BRP-HSP-P-201B");
    expect(searchAssets(index, "CFD-ELA-UPS-A1").results[0].floc).toBe("CFD-ELA-UPS-A1");
  });

  it("caps results and reports the total so thousands of assets stay fast", () => {
    const big = indexOptions(
      Array.from({ length: 5000 }, (_, i) => ({ id: String(i), floc: `X-PMP-${i}`, name: `Pump ${i}`, className: "Centrifugal pump", area: "Area 1" })),
    );
    const { results, total } = searchAssets(big, "pump");
    expect(results).toHaveLength(50);
    expect(total).toBe(5000);
    expect(searchAssets(big, "nothing like this").total).toBe(0);
  });
});
