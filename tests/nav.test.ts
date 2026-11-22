import { describe, expect, it } from "vitest";
import { DASHBOARD_LINK, NAV_GROUPS, activeGroupId, isActiveHref } from "@/lib/nav";

describe("grouped navigation", () => {
  it("has the three sides in order", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["cmms", "eam", "projects"]);
  });

  it("links every app page exactly once", () => {
    const hrefs = [DASHBOARD_LINK.href, ...NAV_GROUPS.flatMap((g) => g.links.flatMap((l) => (l.href ? [l.href] : [])))];
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
