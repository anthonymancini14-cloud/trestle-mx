/**
 * Expands the document seeds (seed-documents.ts) into rows with real
 * timestamps: revisions released and superseded in order, documents on work
 * orders, the views of them during the work, and the revision each closed
 * work order kept.
 */
import { seedId } from "./ids";
import { BRP_DOCS, DC_DOCS, type DocDef } from "./seed-documents";
import { nextDocNumber, revisionToPin, revLabel } from "@/lib/documents";
import type { Asset, ControlledDocument, DocumentRevision, Profile, Site, WoDocument, WoDocumentView, WorkOrder } from "@/types/domain";

export interface DocumentAssetLink {
  document_id: string;
  asset_id: string;
  site_id: string;
}

export interface DocumentRows {
  documents: ControlledDocument[];
  documentRevisions: DocumentRevision[];
  documentAssets: DocumentAssetLink[];
  woDocuments: WoDocument[];
  woDocumentViews: WoDocumentView[];
  /** Files uploaded in the demo, by path (base64). Seed files are static under /demo-docs. */
  docFiles: Record<string, { data: string; mime: string }>;
}

const DAY_MS = 86_400_000;

/** The revision in force at a moment: the released one with the latest effective time at or before it. */
export function revisionAt<T extends Pick<DocumentRevision, "effective_at">>(revisions: T[], iso: string): T | null {
  return (
    revisions
      .filter((r) => r.effective_at && r.effective_at <= iso)
      .sort((a, b) => b.effective_at!.localeCompare(a.effective_at!))[0] ?? null
  );
}

export function buildDocuments(args: {
  now: Date;
  sites: Site[];
  assets: Asset[];
  profiles: Profile[];
  workOrders: WorkOrder[];
  /** Work order id by seed key. */
  woIdByNum: Map<number, string>;
}): DocumentRows {
  const { now, sites, assets, profiles, workOrders, woIdByNum } = args;
  const nowIso = now.toISOString();
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const person = (first: string) => {
    const p = profiles.find((x) => x.full_name.split(" ")[0] === first);
    if (!p) throw new Error(`No demo profile ${first}`);
    return p.id;
  };
  const rows: DocumentRows = { documents: [], documentRevisions: [], documentAssets: [], woDocuments: [], woDocumentViews: [], docFiles: {} };

  const bySite: [string, DocDef[]][] = [
    ["BRP", BRP_DOCS],
    ["CFD", DC_DOCS],
  ];
  for (const [code, defs] of bySite) {
    const site = sites.find((s) => s.code === code)!;
    const ids = new Map<string, string>();
    // Number and create every document first, so an obsolete one can name its replacement.
    for (const def of defs) {
      const id = seedId("document", rows.documents.length + 1);
      ids.set(def.title, id);
      const created = Math.max(...def.revs.map((r) => r.daysAgo));
      rows.documents.push({
        id,
        site_id: site.id,
        doc_number: nextDocNumber(rows.documents.filter((d) => d.site_id === site.id).map((d) => d.doc_number), code, def.type),
        title: def.title,
        doc_type: def.type,
        status: "active",
        replaced_by_id: null,
        obsolete_reason: null,
        obsoleted_by: null,
        obsoleted_at: null,
        created_by: person(def.revs[0].by),
        created_at: ago(created),
      });
    }
    for (const def of defs) {
      const doc = rows.documents.find((d) => d.id === ids.get(def.title))!;
      if (def.obsolete) {
        doc.status = "obsolete";
        doc.obsolete_reason = def.obsolete.reason;
        doc.obsoleted_by = person(def.obsolete.by);
        doc.obsoleted_at = ago(def.obsolete.daysAgo);
        doc.replaced_by_id = def.obsolete.replacedBy ? ids.get(def.obsolete.replacedBy)! : null;
      }

      // Revisions in order: each released one replaces the one before.
      const revs: DocumentRevision[] = def.revs.map((r, i) => {
        const prepared = ago(r.daysAgo);
        const released = !r.status;
        const reviewedAt = r.status === "draft" ? null : ago(Math.max(r.daysAgo - 1, 0.1));
        return {
          id: seedId("documentRevision", rows.documentRevisions.length + i + 1),
          document_id: doc.id,
          rev: revLabel(i),
          status: r.status ?? "superseded",
          change_summary: r.summary,
          body: r.body ?? null,
          file: r.file ? { ...r.file } : null,
          prepared_by: person(r.by),
          prepared_at: prepared,
          reviewed_by: r.status === "draft" ? null : person(r.reviewer ?? "Chris"),
          reviewed_at: reviewedAt,
          review_note: r.reviewNote ?? null,
          effective_at: released ? reviewedAt : null,
          superseded_at: null,
        };
      });
      const released = revs.filter((r) => r.effective_at);
      released.forEach((r, i) => {
        const next = released[i + 1];
        if (next) r.superseded_at = next.effective_at;
        else r.status = "current";
      });
      rows.documentRevisions.push(...revs);

      for (const floc of def.flocs) {
        const asset = assets.find((a) => a.floc === floc && a.site_id === site.id);
        if (!asset) throw new Error(`Document ${doc.doc_number}: no asset ${floc}`);
        rows.documentAssets.push({ document_id: doc.id, asset_id: asset.id, site_id: site.id });
      }

      for (const use of def.uses ?? []) {
        const woId = woIdByNum.get(use.wo);
        const wo = workOrders.find((w) => w.id === woId);
        if (!wo) throw new Error(`Document ${doc.doc_number}: no work order ${use.wo}`);
        const linkId = seedId("woDocument", rows.woDocuments.length + 1);
        // The work starts on the scheduled day (07:00 UTC) or at the write-up; views never after close or now.
        const start = wo.scheduled_date && `${wo.scheduled_date}T07:00:00.000Z` > wo.created_at ? `${wo.scheduled_date}T07:00:00.000Z` : wo.created_at;
        const latest = wo.closed_at ? new Date(Date.parse(wo.closed_at) - 3_600_000).toISOString() : nowIso;
        const views: WoDocumentView[] = [];
        for (const v of use.views ?? []) {
          let at = new Date(Date.parse(start) + v.hoursIntoWork * 3_600_000).toISOString();
          if (at > latest) at = latest;
          // Work scheduled later than today hasn't been opened yet.
          if (at > nowIso) continue;
          const rev = revisionAt(revs, at);
          if (!rev) continue;
          views.push({
            id: seedId("woDocumentView", rows.woDocumentViews.length + views.length + 1),
            wo_id: wo.id,
            document_id: doc.id,
            revision_id: rev.id,
            stage: wo.status === "closed" ? "execution" : wo.stage,
            viewed_by: person(v.by ?? use.by),
            viewed_at: at,
          });
        }
        rows.woDocumentViews.push(...views);
        const addedAt = use.source === "opened" && views[0] ? views[0].viewed_at : start < wo.created_at ? wo.created_at : new Date(Math.min(Date.parse(start), Date.parse(latest))).toISOString();
        rows.woDocuments.push({
          id: linkId,
          wo_id: wo.id,
          document_id: doc.id,
          source: use.source,
          pinned_revision_id: wo.closed_at ? revisionToPin(views, revs.map((r) => ({ ...r, status: r === revisionAt(revs, wo.closed_at!) ? "current" : "superseded" }))) : null,
          added_by: person(use.by),
          added_at: addedAt,
        });
      }
    }
  }
  return rows;
}
