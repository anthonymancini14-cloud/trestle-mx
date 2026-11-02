import { beforeEach, describe, expect, it } from "vitest";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { buildDataset, personId, seedNumbers } from "@/lib/demo/dataset";
import { SITE } from "@/lib/demo/seed";
import { DC_SITE } from "@/lib/demo/seed-datacenter";
import { citedDocuments, fileProblems, formatDocNumber, nextDocNumber, nextRev, revisionProblems, revisionToPin, revLabel } from "@/lib/documents";
import { canAttachDocument, canDetachDocument, canDoc, canReview } from "@/lib/workflow";
import { liveNum } from "./seed-numbers";

describe("document numbers and revisions (TMX-026)", () => {
  it("numbers documents by site, type and sequence", () => {
    expect(formatDocNumber("CFD", "drawing", 1)).toBe("CFD-DWG-0001");
    expect(nextDocNumber(["CFD-DWG-0001", "CFD-DWG-0007", "CFD-PRC-0009", "BRP-DWG-0012"], "CFD", "drawing")).toBe("CFD-DWG-0008");
    expect(nextDocNumber([], "BRP", "moc")).toBe("BRP-MOC-0001");
  });

  it("letters revisions A … Z, AA, AB", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(revLabel)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
    expect(nextRev([{ rev: "A" }, { rev: "B" }])).toBe("C");
  });

  it("keeps the revision last opened from the work order, else the current one, else the newest released", () => {
    const revs = [
      { id: "a", status: "superseded" as const, effective_at: "2026-01-01" },
      { id: "b", status: "current" as const, effective_at: "2026-06-01" },
      { id: "c", status: "draft" as const, effective_at: null },
    ];
    expect(revisionToPin([{ revision_id: "a", viewed_at: "2026-03-01" }, { revision_id: "a", viewed_at: "2026-03-02" }], revs)).toBe("a");
    expect(revisionToPin([{ revision_id: "a", viewed_at: "2026-03-01" }, { revision_id: "b", viewed_at: "2026-07-01" }], revs)).toBe("b");
    expect(revisionToPin([], revs)).toBe("b");
    expect(revisionToPin([], [{ ...revs[0] }, { ...revs[1], status: "superseded" }])).toBe("b");
    expect(revisionToPin([], [revs[2]])).toBeNull();
  });

  it("checks files and content before accepting a revision", () => {
    expect(fileProblems({ name: "a.pdf", type: "application/pdf", size: 1000 }, "demo")).toEqual([]);
    expect(fileProblems({ name: "a.exe", type: "application/x-msdownload", size: 10 }, "live")[0]).toMatch(/PDF, image or text/);
    expect(fileProblems({ name: "big.pdf", type: "application/pdf", size: 3 * 1024 * 1024 }, "demo")[0]).toMatch(/2 MB/);
    expect(fileProblems({ name: "big.pdf", type: "application/pdf", size: 3 * 1024 * 1024 }, "live")).toEqual([]);
    expect(revisionProblems({ change_summary: "Initial issue.", body: null, hasFile: true })).toEqual([]);
    expect(revisionProblems({ change_summary: "x", body: "short", hasFile: false })).toHaveLength(2);
  });

  it("finds the documents a plan cites by number", () => {
    const docs = [{ doc_number: "BRP-PRC-0003" }, { doc_number: "BRP-PRC-0030" }, { doc_number: "BRP-OEM-0001" }];
    expect(citedDocuments([{ source: "brp-prc-0003 Rev C", note: "" }, { source: "History", note: "see BRP-OEM-0001" }], docs).map((d) => d.doc_number)).toEqual(["BRP-PRC-0003", "BRP-OEM-0001"]);
  });

  it("lets planners and supervisors write, supervisors approve (never their own), technicians attach", () => {
    expect(canDoc("author", "planner")).toBe(true);
    expect(canDoc("author", "technician")).toBe(false);
    expect(canReview("supervisor", "me", { status: "draft", prepared_by: "other" }, { status: "active" })).toBe(true);
    expect(canReview("supervisor", "me", { status: "draft", prepared_by: "me" }, { status: "active" })).toBe(false);
    expect(canReview("planner", "me", { status: "draft", prepared_by: "other" }, { status: "active" })).toBe(false);
    expect(canReview("admin", "me", { status: "draft", prepared_by: "other" }, { status: "obsolete" })).toBe(false);
    expect(canAttachDocument("technician", { status: "open" })).toBe(true);
    expect(canAttachDocument("operator", { status: "open" })).toBe(false);
    expect(canAttachDocument("planner", { status: "closed" })).toBe(false);
    expect(canDetachDocument("planner", { status: "open" }, 0)).toBe(true);
    expect(canDetachDocument("planner", { status: "open" }, 1)).toBe(false);
  });
});

describe("demo documents", () => {
  const db = buildDataset(new Date("2026-11-04T18:00:00Z"));
  const nums = seedNumbers(db);
  const doc = (n: string) => db.documents.find((d) => d.doc_number === n)!;
  const revs = (n: string) => db.documentRevisions.filter((r) => r.document_id === doc(n).id);

  it("gives every active document exactly one current revision, superseded ones in order", () => {
    for (const d of db.documents.filter((x) => x.status === "active")) {
      const r = db.documentRevisions.filter((x) => x.document_id === d.id);
      expect(r.filter((x) => x.status === "current"), d.doc_number).toHaveLength(1);
      for (const s of r.filter((x) => x.status === "superseded")) expect(s.superseded_at! >= s.effective_at!).toBe(true);
      for (const x of r.filter((y) => y.reviewed_by)) expect(x.reviewed_by).not.toBe(x.prepared_by);
    }
    expect(revs("BRP-PRC-0003").map((r) => `${r.rev}:${r.status}`)).toEqual(["A:superseded", "B:superseded", "C:current"]);
    expect(revs("CFD-PRC-0001").map((r) => r.status)).toEqual(["superseded", "current", "draft"]);
  });

  it("keeps Rev B with the closed P-201A bearing job; the procedure has moved on to Rev C since", () => {
    const wo = db.workOrders.find((w) => w.wo_number === nums.get(1009))!;
    const link = db.woDocuments.find((l) => l.wo_id === wo.id && l.document_id === doc("BRP-PRC-0003").id)!;
    expect(db.documentRevisions.find((r) => r.id === link.pinned_revision_id)!.rev).toBe("B");
    const c = revs("BRP-PRC-0003").find((r) => r.rev === "C")!;
    expect(c.effective_at! > wo.closed_at!).toBe(true);
    expect(c.body).toMatch(/soft foot/i);
  });

  it("archives an obsolete document with its replacement", () => {
    expect(doc("BRP-PRC-0001")).toMatchObject({ status: "obsolete", replaced_by_id: doc("BRP-PRC-0002").id });
    expect(doc("CFD-PRC-0003")).toMatchObject({ status: "obsolete", replaced_by_id: null });
  });

  it("links each document to assets at its own site, and work orders to documents at theirs", () => {
    for (const l of db.documentAssets) expect(db.assets.find((a) => a.id === l.asset_id)!.site_id).toBe(doc(db.documents.find((d) => d.id === l.document_id)!.doc_number).site_id);
    for (const l of db.woDocuments) expect(db.workOrders.find((w) => w.id === l.wo_id)!.site_id).toBe(db.documents.find((d) => d.id === l.document_id)!.site_id);
    for (const v of db.woDocumentViews) expect(v.viewed_at <= "2026-11-04T18:00:00.000Z").toBe(true);
  });
});

describe("document control in the demo store", () => {
  beforeEach(() => resetDemoStore());

  it("writes a document as a draft that someone else approves", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    const pump = (await repo.listAssets()).find((a) => a.floc === "CFD-CUP-P-01A")!;
    const id = await repo.createDocument(
      { title: "Chilled water pump seal replacement", doc_type: "procedure", asset_ids: [pump.id], revision: { change_summary: "Initial issue.", body: "# Seal\n\n1. Isolate the pump.\n2. Replace the seal.", file: null } },
      personId("Owen"),
    );
    let doc = (await repo.getDocument(id))!;
    expect(doc.doc_number).toBe("CFD-PRC-0004");
    expect(doc.current).toBeNull();
    expect(doc.pending?.rev).toBe("A");
    await expect(repo.reviewRevision(doc.pending!.id, true, null, personId("Owen"))).rejects.toThrow(/someone other/);
    await repo.reviewRevision(doc.pending!.id, true, "OK", personId("Hana"));
    doc = (await repo.getDocument(id))!;
    expect(doc.current?.rev).toBe("A");
    expect((await repo.listDocuments({ assetId: pump.id })).map((d) => d.id)).toContain(id);
  });

  it("supersedes the current revision when a new one is approved; one draft at a time", async () => {
    const repo = new DemoRepository(DC_SITE.id);
    const doc = (await repo.listDocuments()).find((d) => d.doc_number === "CFD-PRC-0001")!;
    await expect(repo.addRevision(doc.id, { change_summary: "Another change", body: "x".repeat(30), file: null }, personId("Owen"))).rejects.toThrow(/draft/);
    await repo.reviewRevision(doc.pending!.id, true, null, personId("Hana"));
    const after = (await repo.getDocument(doc.id))!;
    expect(after.current?.rev).toBe("C");
    expect(after.revisions.find((r) => r.rev === "B")).toMatchObject({ status: "superseded" });
    expect(after.revisions.find((r) => r.rev === "B")!.superseded_at).toBe(after.current!.effective_at);
  });

  it("logs a view when a document is opened from open work, adds it, keeps it, and pins the revision at close", async () => {
    const repo = new DemoRepository(SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1025))!; // PM in Execution, with BRP-PRC-0002 from the plan
    const manual = (await repo.listDocuments()).find((d) => d.doc_number === "BRP-OEM-0002")!;
    const procedure = (await repo.listDocuments()).find((d) => d.doc_number === "BRP-PRC-0002")!;

    // Opening a document that wasn't on the work order puts it there.
    const seen = await repo.openWoDocument(wo.id, manual.id, personId("Devon"));
    expect(seen).toBe(manual.current!.id);
    let rows = await repo.listWoDocuments(wo.id);
    expect(rows.find((r) => r.document_id === manual.id)).toMatchObject({ source: "opened" });
    expect(rows.find((r) => r.document_id === manual.id)!.views).toHaveLength(1);
    await expect(repo.detachDocument(wo.id, manual.id, personId("Marcus"))).rejects.toThrow(/opened/);
    await repo.openWoDocument(wo.id, procedure.id, personId("Devon"));

    await repo.closeWorkOrder(wo.id, 4, "Service done, discharge temperature 196 °F loaded.", personId("Lena"));
    rows = await repo.listWoDocuments(wo.id);
    expect(rows.every((r) => r.pinned_revision_id)).toBe(true);

    // The procedure is revised after the job: the closed work order keeps Rev A.
    const revB = await repo.addRevision(procedure.id, { change_summary: "Adds the cooler cleaning step.", body: "# Procedure\n\n1. Clean the cooler fins.", file: null }, personId("Marcus"));
    await repo.reviewRevision(revB, true, null, personId("Lena"));
    rows = await repo.listWoDocuments(wo.id);
    expect(rows.find((r) => r.document_id === procedure.id)!.revision!.rev).toBe("A");
    expect(await repo.openWoDocument(wo.id, procedure.id, personId("Lena"))).toBe(procedure.current!.id);
    expect((await repo.getDocument(procedure.id))!.usage.find((u) => u.wo.id === wo.id)!.rev).toBe("A");
    // Closed work keeps its documents.
    await expect(repo.attachDocument(wo.id, manual.id, personId("Marcus"))).rejects.toThrow(/Closed/);
    await expect(repo.detachDocument(wo.id, procedure.id, personId("Marcus"))).rejects.toThrow(/Closed/);
  });

  it("pins documents when a WCE is closed as deferred", async () => {
    const repo = new DemoRepository(SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1022))!; // MCC-2 retorque, BRP-DWG-0002 opened by Alex
    await repo.deferWorkOrder(wo.id, "Needs an outage on MCC-2; doesn't affect operation.", personId("Lena"));
    const row = (await repo.listWoDocuments(wo.id))[0];
    expect(row.document.doc_number).toBe("BRP-DWG-0002");
    expect(row.pinned_revision_id).toBe(row.document.current!.id);
  });

  it("archives a document as obsolete: drafts rejected, no new revisions, not attachable, still readable", async () => {
    const repo = new DemoRepository(SITE.id);
    const doc = (await repo.listDocuments()).find((d) => d.doc_number === "BRP-PRC-0004")!; // Rev B draft pending
    const replacement = (await repo.listDocuments()).find((d) => d.doc_number === "BRP-PRC-0002")!;
    await expect(repo.obsoleteDocument(doc.id, "Wrong", doc.id, personId("Lena"))).rejects.toThrow(/itself/);
    await repo.obsoleteDocument(doc.id, "Gearbox replaced with a sealed unit.", null, personId("Lena"));
    const after = (await repo.getDocument(doc.id))!;
    expect(after.status).toBe("obsolete");
    expect(after.revisions.find((r) => r.rev === "B")!.status).toBe("rejected");
    await expect(repo.addRevision(doc.id, { change_summary: "More", body: "x".repeat(30), file: null }, personId("Marcus"))).rejects.toThrow(/obsolete/);
    const open = (await repo.listWorkOrders({ status: "open" }))[0];
    await expect(repo.attachDocument(open.id, doc.id, personId("Marcus"))).rejects.toThrow(/obsolete/);
    expect((await repo.listDocuments()).some((d) => d.id === doc.id)).toBe(false);
    expect((await repo.listDocuments({ includeObsolete: true })).some((d) => d.id === doc.id)).toBe(true);
    await expect(repo.obsoleteDocument(replacement.id, "x".repeat(10), doc.id, personId("Lena"))).rejects.toThrow(/active/);
  });

  it("keeps a demo upload in memory and serves it back; scoped to the site", async () => {
    const repo = new DemoRepository(SITE.id);
    const data = Buffer.from("%PDF-1.4 fictional").toString("base64");
    const id = await repo.createDocument(
      { title: "Boiler feed pump curve", doc_type: "specification", asset_ids: [], revision: { change_summary: "Initial issue.", body: null, file: { name: "curve.pdf", mime: "application/pdf", size: 18, path: "" }, file_data: data } },
      personId("Marcus"),
    );
    const rev = (await repo.getDocument(id))!.pending!;
    const file = await repo.getRevisionFile(rev.id);
    expect(file && "data" in file && Buffer.from(file.data).toString()).toBe("%PDF-1.4 fictional");
    expect(await new DemoRepository(DC_SITE.id).getRevisionFile(rev.id)).toBeNull();
    expect(await new DemoRepository(DC_SITE.id).getDocument(id)).toBeNull();
    const seed = (await repo.listDocuments()).find((d) => d.doc_number === "BRP-DWG-0001")!;
    expect(await repo.getRevisionFile(seed.current!.id)).toEqual({ url: "/demo-docs/brp-dwg-0001-b.svg" });
  });

  it("links the documents a committed plan cites", async () => {
    const repo = new DemoRepository(SITE.id);
    const wo = (await repo.listWorkOrders()).find((w) => w.wo_number === liveNum(1031))!; // P-201B bearing, in Planning
    await repo.commitPlan(
      wo.id,
      {
        summary: "Replace P-201B bearings per the current procedure.",
        likely_cause: "Bearing wear",
        requires_shutdown: true,
        estimated_duration_hours: 8,
        hazards: [],
        permits: [],
        isolation_points: [],
        tasks: [{ seq: 10, description: "Replace bearings", craft: "mechanical", crew_size: 2, est_hours: 4, safety_note: null, acceptance_criteria: null }],
        parts: [],
        tools: [],
        references: [{ source: "BRP-PRC-0003 Rev C", note: "Procedure" }, { source: "History", note: "BRP-PRC-0001 is obsolete and must not link" }],
        open_questions: [],
      },
      personId("Marcus"),
    );
    const rows = await repo.listWoDocuments(wo.id);
    expect(rows.map((r) => [r.document.doc_number, r.source])).toEqual([["BRP-PRC-0003", "plan"]]);
    expect(rows[0].revision!.rev).toBe("C");
  });
});
