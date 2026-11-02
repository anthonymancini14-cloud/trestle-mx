"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, FileText, Plus, X } from "lucide-react";
import { Badge, EmptyState, Panel, PanelHeader, Select } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { attachDocument, detachDocument } from "@/lib/actions";
import { formatDay, formatDateTime } from "@/lib/utils";
import { DOC_TYPE_LABELS, type DocumentListItem, type WoDocumentRow } from "@/types/domain";

const SOURCE_LABEL = { plan: "From the plan", attached: "Added", opened: "Opened during the work" } as const;

/**
 * The documents for this WCE. Open work: each opens the current revision and
 * the view is logged. Closed work: each opens the revision kept at close.
 */
export function WoDocumentsPanel({
  woId,
  woOpen,
  rows,
  assetDocs,
  siteDocs,
  canAttach,
  canDetach,
}: {
  woId: string;
  woOpen: boolean;
  rows: WoDocumentRow[];
  /** Current documents for the work order's asset that aren't on it yet. */
  assetDocs: DocumentListItem[];
  /** Every other active document at the site, for adding one that isn't tied to the asset. */
  siteDocs: DocumentListItem[];
  canAttach: boolean;
  canDetach: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : (res.error ?? "Couldn't save that."));
    });

  return (
    <Panel>
      <PanelHeader
        eyebrow="Document control"
        title="Documents"
        actions={<span className="font-mono text-xs text-tx-3">{rows.length} on this WCE</span>}
      />
      {!woOpen && rows.length > 0 && (
        <p className="border-b border-line bg-panel-2 px-4 py-2 text-xs text-tx-2">
          Kept with this record: the revision of each document the crew used, as it was when the work order closed.
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState>{woOpen ? "No documents on this WCE yet." : "No documents were used on this WCE."}</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <DocRow key={r.id} row={r} woId={woId} woOpen={woOpen} canDetach={canDetach && r.views.length === 0} pending={pending} onDetach={() => run(() => detachDocument(woId, r.document_id))} />
          ))}
        </ul>
      )}

      {assetDocs.length > 0 && (
        <div className="border-t border-line">
          <div className="px-4 pt-2.5 text-[11px] uppercase tracking-wider text-tx-3">{woOpen ? "Also on this asset" : "Current documents for this asset"}</div>
          <ul className="divide-y divide-line">
            {assetDocs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="whitespace-nowrap font-mono text-xs text-tx-2">
                  {d.doc_number} Rev {d.current?.rev ?? "—"}
                </span>
                <span className="min-w-48 flex-1 truncate text-sm text-tx-2">{d.title}</span>
                <span className="text-[11px] text-tx-3">{DOC_TYPE_LABELS[d.doc_type]}</span>
                {/* Opening from open work logs the view and puts the document on the WCE. */}
                <a
                  href={woOpen ? `/documents/${d.id}/open?wo=${woId}` : `/documents/${d.id}`}
                  className="inline-flex min-h-9 items-center gap-1 text-sm text-brass hover:text-brass-bright"
                >
                  <BookOpen className="size-4" aria-hidden /> Open
                </a>
                {woOpen && canAttach && (
                  <button type="button" disabled={pending} onClick={() => run(() => attachDocument(woId, d.id))} className="inline-flex min-h-9 items-center gap-1 text-sm text-tx-2 hover:text-tx">
                    <Plus className="size-4" aria-hidden /> Add
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {woOpen && canAttach && siteDocs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
          <Select value={adding} onChange={(e) => setAdding(e.target.value)} className="min-w-0 flex-1" aria-label="Add a document">
            <option value="">Add another document…</option>
            {siteDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.doc_number} {d.title}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            disabled={!adding || pending}
            onClick={() =>
              run(async () => {
                const res = await attachDocument(woId, adding);
                if (res.ok) setAdding("");
                return res;
              })
            }
          >
            Add
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="border-t border-line px-4 py-2 text-sm text-bad">
          {error}
        </p>
      )}
    </Panel>
  );
}

function DocRow({ row, woId, woOpen, canDetach, pending, onDetach }: { row: WoDocumentRow; woId: string; woOpen: boolean; canDetach: boolean; pending: boolean; onDetach: () => void }) {
  const doc = row.document;
  const last = row.views[0];
  const warnings: string[] = [];
  if (woOpen) {
    if (doc.status === "obsolete") warnings.push(`Obsolete${doc.replaced_by ? `: replaced by ${doc.replaced_by.doc_number}` : ""}. Check before using it.`);
    if (last && doc.current && last.revision_id !== doc.current.id) warnings.push(`Last opened at Rev ${last.rev}; Rev ${doc.current.rev} is current now.`);
    if (doc.pending) warnings.push(`Rev ${doc.pending.rev} is in review.`);
  }
  const later = !woOpen && row.revision && doc.current && doc.current.id !== row.revision.id;

  return (
    <li className="space-y-1 px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <FileText className="mt-0.5 size-4 shrink-0 text-tx-3" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="whitespace-nowrap font-mono text-sm text-brass-bright">
              {doc.doc_number} Rev {row.revision?.rev ?? "—"}
            </span>
            {!woOpen && <Badge className="border-good/40 bg-good/10 text-good">Kept at close</Badge>}
            {later && <Badge className="border-warn/50 bg-warn/10 text-warn">Rev {doc.current!.rev} current now</Badge>}
            {!woOpen && doc.status === "obsolete" && <Badge className="border-bad/40 bg-bad/10 text-bad">Obsolete now</Badge>}
          </div>
          <p className="text-sm">{doc.title}</p>
          <p className="text-[11px] text-tx-3">
            {DOC_TYPE_LABELS[doc.doc_type]} · {SOURCE_LABEL[row.source]}
            {row.source !== "opened" && row.added_by_name ? ` by ${row.added_by_name}` : ""}, {formatDay(row.added_at)}
          </p>
        </div>
        <a
          href={`/documents/${doc.id}/open?wo=${woId}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-[3px] border border-line-strong bg-panel-2 px-3 text-sm hover:border-brass-dim"
        >
          <BookOpen className="size-4 text-brass" aria-hidden /> Open
        </a>
        {canDetach && (
          <button type="button" disabled={pending} onClick={onDetach} aria-label={`Take ${doc.doc_number} off this WCE`} className="inline-flex min-h-11 items-center px-2 text-tx-3 hover:text-bad">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {warnings.map((w) => (
        <p key={w} className="flex items-center gap-1.5 pl-7 text-xs text-warn">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> {w}
        </p>
      ))}
      {row.views.length > 0 && (
        <details className="pl-7 text-xs text-tx-3">
          <summary className="cursor-pointer">
            Opened {row.views.length}× · last by {last.viewer_name ?? "someone"}, Rev {last.rev}, {formatDateTime(last.viewed_at)}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {row.views.map((v) => (
              <li key={v.id}>
                {v.viewer_name ?? "Someone"} opened Rev {v.rev} in {v.stage}, {formatDateTime(v.viewed_at)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!woOpen && row.revision && (
        <p className="pl-7 text-xs">
          <Link href={`/documents/${doc.id}`} className="text-tx-3 hover:text-tx-2">
            Document history
          </Link>
        </p>
      )}
    </li>
  );
}
