import { beforeEach, describe, expect, it } from "vitest";
import { buildSiteContext, formatSiteContext } from "@/lib/anthropic/context/site-context";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { buildDataset, personId, seedNumbers } from "@/lib/demo/dataset";
import { DC_SITE } from "@/lib/demo/seed-datacenter";
import { SITE } from "@/lib/demo/seed";
import { evidenceBlocker, repeatCheck, repeatFailures, resolutionProblems } from "@/lib/troubleshooting";
import { availableActions, canRecord } from "@/lib/workflow";
import type { ResolutionHistoryItem } from "@/types/domain";
import { liveNum } from "./seed-numbers";

const res = (over: Partial<Parameters<typeof evidenceBlocker>[1][number]> = {}) => ({
  created_at: "2026-11-01T10:00:00Z",
  no_fault_found: false,
  finding_ids: ["f1"],
  failure_mode: "VIB",
  cause: "2.2",
  ...over,
});

describe("evidence to close (TMX-006)", () => {
  const primary = { wce_seq: 1, wo_type: "corrective" as const };
  it("needs a resolution with a coded cause and a linked finding, or no fault found", () => {
    expect(evidenceBlocker(primary, [])).toMatch(/Record the resolution/);
    expect(evidenceBlocker(primary, [res({ finding_ids: [] })])).toMatch(/Link at least one finding/);
    expect(evidenceBlocker(primary, [res({ failure_mode: null, cause: null })])).toMatch(/coded/);
    expect(evidenceBlocker(primary, [res()])).toBeNull();
    expect(evidenceBlocker(primary, [res({ no_fault_found: true, finding_ids: [], failure_mode: null, cause: null })])).toBeNull();
  });

  it("uses the newest resolution", () => {
    const old = res({ created_at: "2026-11-01T10:00:00Z" });
    const newer = res({ created_at: "2026-11-02T10:00:00Z", finding_ids: [] });
    expect(evidenceBlocker(primary, [old, newer])).toMatch(/Link at least one finding/);
  });

  it("applies to corrective and emergency WCE -001 only", () => {
    expect(evidenceBlocker({ wce_seq: 2, wo_type: "corrective" }, [])).toBeNull();
    expect(evidenceBlocker({ wce_seq: 1, wo_type: "preventive" }, [])).toBeNull();
    expect(evidenceBlocker({ wce_seq: 1, wo_type: "emergency" }, [])).not.toBeNull();
  });

  it("checks a resolution before it's saved: a cause needs findings, a fix and a tested fix", () => {
    const base = { no_fault_found: false, failure_mode: "VIB", cause: "2.2", finding_ids: ["f1"], cause_narrative: "Bearing wore from misalignment.", remedy: "Replaced and aligned.", verification: "Ran 4 h, 0.08 in/s", verification_passed: true };
    expect(resolutionProblems(base)).toEqual([]);
    expect(resolutionProblems({ ...base, verification: null, verification_passed: null })).toHaveLength(2);
    expect(resolutionProblems({ ...base, finding_ids: [] })).toEqual(["Link the findings that support the cause."]);
    expect(resolutionProblems({ ...base, no_fault_found: true, failure_mode: null, cause: null, finding_ids: [], remedy: "", verification: null, verification_passed: null })).toEqual([]);
  });
});

describe("repeat failures (TMX-008)", () => {
  const item = (id: string, asset: string, mode: string, closedAt: string, createdAt = "2026-01-01T00:00:00Z"): ResolutionHistoryItem => ({
    id: `r-${id}`,
    wo_id: id,
    failure_mode: mode,
    mechanism: null,
    cause: "3.4",
    no_fault_found: false,
    cause_narrative: "x",
    remedy: "y",
    verification: "z",
    verification_passed: true,
    operator_review: "none_taken",
    operator_review_note: null,
    finding_ids: ["f"],
    supersedes_id: null,
    created_by: null,
    created_at: closedAt,
    wo: { id, wo_number: id, title: id, asset_id: asset, wo_type: "corrective", status: "closed", closed_at: closedAt, created_at: createdAt },
  });

  it("flags a new discrepancy when corrective work on the asset closed within the window", () => {
    const history = [item("a", "pump", "VIB", "2026-09-20T00:00:00Z"), item("b", "pump", "ELP", "2026-03-01T00:00:00Z"), item("c", "other", "VIB", "2026-10-01T00:00:00Z")];
    const wo = { id: "new", asset_id: "pump", created_at: "2026-11-01T00:00:00Z", wo_type: "corrective" as const };
    const r = repeatCheck(wo, history, 90, null)!;
    expect(r.prior.map((p) => p.wo_id)).toEqual(["a"]);
    expect(r.sameMode).toEqual([]);
    expect(repeatCheck(wo, history, 90, { failure_mode: "VIB" })!.sameMode.map((p) => p.wo_id)).toEqual(["a"]);
    expect(repeatCheck(wo, history, 30, null)).toBeNull();
    expect(repeatCheck(wo, history, null, null)).toBeNull(); // run to failure: off
    expect(repeatCheck({ ...wo, wo_type: "preventive" }, history, 90, null)).toBeNull(); // a PM isn't a failure
  });

  it("counts confirmed repeats: same asset, same failure mode, within the window", () => {
    const first = item("a", "pump", "VIB", "2026-08-01T00:00:00Z", "2026-07-25T00:00:00Z");
    const again = item("b", "pump", "VIB", "2026-09-30T00:00:00Z", "2026-09-20T00:00:00Z");
    const other = item("c", "pump", "ELP", "2026-10-30T00:00:00Z", "2026-10-25T00:00:00Z");
    expect(repeatFailures([first, again, other], () => 90).map((r) => [r.item.wo_id, r.prior.wo_id])).toEqual([["b", "a"]]);
    expect(repeatFailures([first, again], () => 30)).toEqual([]);
  });
});

describe("who writes the record", () => {
  const open = { stage: "execution" as const, status: "open" as const, assigned_to: "tech-1" };
  it("lets operators record actions and report discrepancies (TMX-009)", () => {
    expect(canRecord("operator_action", "operator", open)).toBe(true);
    expect(canRecord("operator_action", "technician", open)).toBe(false);
    expect(availableActions("operator", { stage: "identification", status: "open" })).toEqual(["submit_for_vetting"]);
  });

  it("lets technicians log findings and the resolution in Execution or Closure", () => {
    expect(canRecord("finding", "technician", { ...open, stage: "planning" })).toBe(true);
    expect(canRecord("resolution", "technician", open)).toBe(true);
    expect(canRecord("resolution", "technician", { ...open, stage: "planning" })).toBe(false);
    expect(canRecord("finding", "operator", open)).toBe(false);
  });

  it("lets supervisors, planners, admins and the technician who worked it add to closed work (TMX-007)", () => {
    const closed = { ...open, status: "closed" as const };
    expect(canRecord("addendum", "planner", closed)).toBe(true);
    expect(canRecord("addendum", "technician", closed, "tech-1")).toBe(true);
    expect(canRecord("addendum", "technician", closed, "tech-2")).toBe(false);
    expect(canRecord("addendum", "supervisor", open)).toBe(false);
    expect(canRecord("finding", "technician", closed)).toBe(false);
  });
});

describe("demo troubleshooting records", () => {
  const db = buildDataset(new Date("2026-11-04T18:00:00Z"));
  const nums = seedNumbers(db);
  const bySeed = (n: number) => db.workOrders.find((w) => w.wo_number === nums.get(n))!;

  it("links every resolution only to findings on its own work order, recorded before it closed", () => {
    for (const r of db.resolutions) {
      const wo = db.workOrders.find((w) => w.id === r.wo_id)!;
      for (const f of r.finding_ids) {
        const finding = db.findings.find((x) => x.id === f)!;
        expect(finding.wo_id).toBe(r.wo_id);
        expect(finding.created_at <= r.created_at, wo.title).toBe(true);
      }
      if (wo.closed_at) expect(r.created_at <= wo.closed_at).toBe(true);
    }
  });

  it("dates every entry between the write-up and now", () => {
    const now = new Date("2026-11-04T18:00:00Z").toISOString();
    for (const e of [...db.operatorActions, ...db.findings, ...db.resolutions]) {
      const wo = db.workOrders.find((w) => w.id === e.wo_id)!;
      expect(e.created_at >= wo.created_at && e.created_at <= now, wo.title).toBe(true);
    }
  });

  it("seeds a full record on the P-201A bearing job, with an addendum after it closed", () => {
    const wo = bySeed(1009);
    expect(db.operatorActions.filter((a) => a.wo_id === wo.id)).toHaveLength(1);
    expect(db.findings.filter((f) => f.wo_id === wo.id)).toHaveLength(4);
    expect(db.resolutions.find((r) => r.wo_id === wo.id)).toMatchObject({ failure_mode: "VIB", cause: "2.2", operator_review: "helped" });
    expect(db.addenda.find((a) => a.wo_id === wo.id)!.created_at > wo.closed_at!).toBe(true);
  });

  it("flags the compressor alarm as a possible repeat of the job 40 days earlier", () => {
    const now = bySeed(1038);
    const before = bySeed(1049);
    const history = db.resolutions.map((r) => {
      const w = db.workOrders.find((x) => x.id === r.wo_id)!;
      return { ...r, wo: { id: w.id, wo_number: w.wo_number, title: w.title, asset_id: w.asset_id, wo_type: w.wo_type, status: w.status, closed_at: w.closed_at, created_at: w.created_at } };
    });
    expect(repeatCheck(now, history, 90, null)!.prior.map((p) => p.wo_id)).toEqual([before.id]);
  });
});

describe("troubleshooting in the demo store", () => {
  beforeEach(() => resetDemoStore());

  it("won't close corrective WCE -001 without evidence, then closes once the cause is proven", async () => {
    const repo = new DemoRepository(SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1018))!; // in Closure, findings, no resolution
    await expect(repo.closeWorkOrder(wo.id, 1, "Replaced the seized gauge valve.", personId("Lena"))).rejects.toThrow(/resolution/);
    const record = await repo.getTroubleshooting(wo.id);
    await repo.recordResolution(
      wo.id,
      {
        failure_mode: "STD", mechanism: "1.6", cause: "3.4", no_fault_found: false,
        cause_narrative: "Gauge isolation valve seized closed from scale, so the gauge read zero.",
        remedy: "Replaced the isolation valve.", verification: "Gauge 62 psi against a 61 psi test gauge.", verification_passed: true,
        operator_review: "none_taken", operator_review_note: null, finding_ids: [record.findings[0].id],
      },
      personId("Riley"),
    );
    await repo.closeWorkOrder(wo.id, 1, "Corrective action: replaced the seized gauge isolation valve; gauge verified.", personId("Lena"));
    expect((await repo.getWorkOrder(wo.id))!.status).toBe("closed");
    // Closed work takes addenda, not entries.
    await repo.addAddendum(wo.id, "Gauge still reading true a week later.", personId("Lena"));
    expect((await repo.getTroubleshooting(wo.id)).addenda).toHaveLength(1);
    await expect(repo.addFinding(wo.id, { test: "late", value: null, unit: null, spec: null, result: "info", note: null, corrects_id: null }, personId("Riley"))).rejects.toThrow(/closed/);
  });

  it("keeps entries insert-only: corrections and new resolutions point at what they replace", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(2005))!;
    const first = (await repo.getTroubleshooting(wo.id)).findings[0];
    await repo.addFinding(wo.id, { test: "Strainer DP, recalibrated gauge", value: 8.7, unit: "psi", spec: "Alarm at 6 psi", result: "fail", note: null, corrects_id: first.id }, personId("Mateo"));
    const after = await repo.getTroubleshooting(wo.id);
    expect(after.findings).toHaveLength(2);
    expect(after.findings[1].corrects_id).toBe(first.id);
    // A correction can't point at another work order's entry.
    const other = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(2003))!;
    const foreign = (await repo.getTroubleshooting(other.id)).findings[0];
    await expect(repo.addFinding(wo.id, { test: "x x x", value: null, unit: null, spec: null, result: "info", note: null, corrects_id: foreign.id }, personId("Mateo"))).rejects.toThrow();
    await expect(
      repo.recordResolution(wo.id, { failure_mode: "LOO", mechanism: "5.1", cause: "3.4", no_fault_found: false, cause_narrative: "Strainer plugged.", remedy: "Cleaned.", verification: "DP 1 psi", verification_passed: true, operator_review: "helped", operator_review_note: null, finding_ids: [foreign.id] }, personId("Mateo")),
    ).rejects.toThrow(/this work order/);
  });

  it("gives Planning Mode the proven causes and the troubleshooting so far", async () => {
    const repo = new DemoRepository(SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1031))!; // P-201B bearing, sister of P-201A
    const text = formatSiteContext((await buildSiteContext(repo, wo.id))!);
    expect(text).toContain("Proven cause (VIB, mechanism 2.4, cause 2.2)");
    expect(text).toContain("Operator first response helped");
    const comp = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1038))!;
    const compText = formatSiteContext((await buildSiteContext(repo, comp.id))!);
    expect(compText).toContain("## Troubleshooting so far on this work order");
    expect(compText).toContain("Reset the trip and restarted");
  });
});
