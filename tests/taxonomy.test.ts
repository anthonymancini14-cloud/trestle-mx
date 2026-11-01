import { beforeEach, describe, expect, it } from "vitest";
import { buildSiteContext, formatSiteContext } from "@/lib/anthropic/context/site-context";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { buildDataset } from "@/lib/demo/dataset";
import { SITE } from "@/lib/demo/seed";
import { assessAsset, assessRegister } from "@/lib/taxonomy/assess";
import { ASSET_CLASS_LIBRARY } from "@/lib/taxonomy/library";
import { CLASS_CATEGORIES, VERTICALS, type AssetClass } from "@/types/domain";

const db = buildDataset(new Date("2026-10-16T12:00:00Z"));

describe("asset class library", () => {
  it("uses unique class codes in the format the database enforces", () => {
    const codes = ASSET_CLASS_LIBRARY.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
  });

  for (const cls of ASSET_CLASS_LIBRARY) {
    it(`${cls.code}: is a complete standard`, () => {
      expect(CLASS_CATEGORIES).toContain(cls.category);
      expect(cls.verticals.length).toBeGreaterThan(0);
      for (const v of cls.verticals) expect(VERTICALS).toContain(v);
      expect(cls.description.length).toBeGreaterThan(10);

      const keys = cls.attributes.map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(cls.attributes.filter((a) => a.required).length).toBeGreaterThanOrEqual(2);
      for (const a of cls.attributes) {
        expect(a.key).toMatch(/^[a-z][a-z0-9_]*$/);
        if (a.type === "enum") expect(a.options?.length ?? 0).toBeGreaterThanOrEqual(2);
        if (a.type === "number") expect(a.unit).toBeTruthy();
      }

      const modes = cls.failureModes.map((m) => m.code);
      expect(modes.length).toBeGreaterThanOrEqual(3);
      expect(new Set(modes).size).toBe(modes.length);
      for (const m of cls.failureModes) {
        expect(m.code).toMatch(/^[A-Z]{3}$/);
        expect(m.description).toBeTruthy();
        expect(m.detection).toBeTruthy();
      }
    });
  }

  it("covers both verticals", () => {
    for (const v of VERTICALS) expect(ASSET_CLASS_LIBRARY.some((c) => c.verticals.includes(v))).toBe(true);
  });
});

describe("demo register against the library", () => {
  const classById = new Map(db.assetClasses.map((c) => [c.id, c]));

  it("classifies every asset with a class meant for the site's vertical", () => {
    for (const a of db.assets) {
      const cls = a.class_id ? classById.get(a.class_id) : undefined;
      expect(cls, a.floc).toBeTruthy();
      const site = db.sites.find((s) => s.id === a.site_id)!;
      expect(cls!.verticals, a.floc).toContain(site.vertical);
    }
  });

  it("only has missing fields, never wrong values or unknown keys", () => {
    for (const a of db.assets) {
      const result = assessAsset(a, classById.get(a.class_id!)!);
      expect(result.unknownKeys, a.floc).toEqual([]);
      expect(result.issues.filter((i) => i.problem !== "missing"), a.floc).toEqual([]);
    }
  });

  it("leaves the intended data gaps for the demo", () => {
    const incomplete = db.assets.filter((a) => !assessAsset(a, classById.get(a.class_id!)!).complete).map((a) => a.floc);
    expect(incomplete.sort()).toEqual([
      "BRP-BLR-DA-503",
      "BRP-CTW-F-601",
      "BRP-INT-P-101B",
      "BRP-INT-SCR-101",
      "CFD-DH1-CBL-0201",
      "CFD-DH1-CRAH-04",
    ]);
    const brp = assessRegister(db.assets.filter((a) => a.site_id === SITE.id), db.assetClasses);
    expect(brp.classified).toBe(24);
    expect(brp.complete).toBe(20);
    expect(brp.completePct).toBe(83);
  });
});

describe("assessAsset", () => {
  const cls: AssetClass = {
    id: "c1",
    org_id: "o1",
    code: "TEST",
    name: "Test",
    category: "Rotating",
    verticals: ["industrial_utility"],
    description: "Test class",
    is_active: true,
    attributes: [
      { key: "power", label: "Power", type: "number", unit: "hp", required: true },
      { key: "seal", label: "Seal", type: "enum", options: ["Packing", "Mechanical"], required: true },
      { key: "spare", label: "Spare on site", type: "boolean", required: true },
      { key: "note", label: "Note", type: "text", required: false },
    ],
  };

  it("passes a complete asset", () => {
    const r = assessAsset({ class_id: "c1", attributes: { power: 10, seal: "Packing", spare: false } }, cls);
    expect(r).toMatchObject({ classified: true, complete: true, requiredFilled: 3, requiredTotal: 3 });
  });

  it("flags missing, wrong type, bad option and unknown keys", () => {
    const r = assessAsset({ class_id: "c1", attributes: { power: "ten", seal: "Lip seal", colour: "red" } }, cls);
    expect(r.complete).toBe(false);
    expect(r.requiredFilled).toBe(0);
    expect(r.issues.map((i) => [i.spec.key, i.problem])).toEqual([
      ["power", "wrong_type"],
      ["seal", "not_an_option"],
      ["spare", "missing"],
    ]);
    expect(r.unknownKeys).toEqual(["colour"]);
  });

  it("treats an asset with no class as unclassified", () => {
    expect(assessAsset({ class_id: null, attributes: {} }, null)).toMatchObject({ classified: false, complete: false });
  });
});

describe("Planning Mode context", () => {
  beforeEach(() => resetDemoStore());

  it("gives Claude the asset's class, nameplate and failure modes", async () => {
    const repo = new DemoRepository(SITE.id);
    const wo = db.workOrders.find((w) => w.wo_number === "WO-26-1031")!;
    const ctx = await buildSiteContext(repo, wo.id);
    const text = formatSiteContext(ctx!);
    expect(text).toContain("Class: Centrifugal pump (PUMP-CENT)");
    expect(text).toContain("Nameplate: Configuration Horizontal split case");
    expect(text).toContain("## Known failure modes for the Centrifugal pump class");
    expect(text).toContain("- VIB Vibration");
    // The sister unit is found through the shared class, not free text.
    expect(text).toContain("BRP-HSP-P-201A High-service pump A (Centrifugal pump, running)");
  });
});
