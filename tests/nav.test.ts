import { describe, expect, it } from "vitest";
import { DASHBOARD_LINK, NAV_GROUPS, activeGroupId, auditArea, isActiveHref } from "@/lib/nav";

describe("grouped navigation", () => {
  it("has the three sides in order, then AI audit", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["cmms", "eam", "projects", "audit"]);
  });

  it("links every app page exactly once (audit areas aside)", () => {
    const hrefs = [DASHBOARD_LINK.href, ...NAV_GROUPS.flatMap((g) => g.links.flatMap((l) => (l.href && !l.href.includes("?") ? [l.href] : [])))];
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.sort()).toEqual(
      [
        "/asset-classes",
        "/assets",
        "/audit",
        "/dashboard",
        "/documents",
        "/inventory",
        "/planning",
        "/pm",
        "/schedule",
        "/work-orders",
        "/work-orders/new",
      ].sort(),
    );
  });

  it("only shows unbuilt pages as designed (no href) in Project management", () => {
    const designed = NAV_GROUPS.flatMap((g) => g.links.filter((l) => !l.href).map(() => g.id));
    expect(designed.every((id) => id === "projects")).toBe(true);
  });

  it("opens the group that holds the current page", () => {
    expect(activeGroupId("/work-orders/abc")).toBe("cmms");
    expect(activeGroupId("/planning/abc")).toBe("cmms");
    expect(activeGroupId("/assets/xyz")).toBe("eam");
    expect(activeGroupId("/documents/new")).toBe("eam");
    expect(activeGroupId("/dashboard")).toBeNull();
  });

  it("keeps Report and Work orders highlighted separately", () => {
    expect(isActiveHref("/work-orders/new", "/work-orders/new")).toBe(true);
    expect(isActiveHref("/work-orders", "/work-orders/new")).toBe(false);
    expect(isActiveHref("/work-orders", "/work-orders/abc")).toBe(true);
    expect(isActiveHref("/assets", "/asset-classes")).toBe(false);
  });
});

describe("AI audit areas", () => {
  it("is its own group, last, with the queue first and one link per area", () => {
    const audit = NAV_GROUPS.at(-1)!;
    expect(audit.id).toBe("audit");
    expect(audit.links.map((l) => l.href)).toEqual(["/audit", "/audit?area=cmms", "/audit?area=assets", "/audit?area=storeroom", "/audit?area=documents"]);
    expect(NAV_GROUPS.find((g) => g.id === "cmms")!.links.some((l) => l.href?.startsWith("/audit"))).toBe(false);
  });

  it("highlights only the chosen area", () => {
    expect(isActiveHref("/audit?area=storeroom", "/audit", "storeroom")).toBe(true);
    expect(isActiveHref("/audit?area=cmms", "/audit", "storeroom")).toBe(false);
    expect(isActiveHref("/audit", "/audit", "storeroom")).toBe(false);
    expect(isActiveHref("/audit", "/audit", null)).toBe(true);
    expect(isActiveHref("/audit", "/audit", "nonsense")).toBe(true);
    expect(isActiveHref("/audit", "/audit/run-1", null)).toBe(true);
    expect(isActiveHref("/audit?area=cmms", "/audit/run-1", "cmms")).toBe(false);
  });

  it("opens the AI audit group on any audit page", () => {
    expect(activeGroupId("/audit", "documents")).toBe("audit");
    expect(activeGroupId("/audit/run-1")).toBe("audit");
    expect(auditArea("storeroom")?.label).toBe("Storeroom");
    expect(auditArea("payroll")).toBeNull();
  });
});
