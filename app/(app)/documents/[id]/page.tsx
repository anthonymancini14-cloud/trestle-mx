import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Download, ExternalLink } from "lucide-react";
import { DocBody } from "@/components/documents/doc-body";
import { EditDocumentAssets, NewRevision, ObsoleteDocument, ReviewDraft } from "@/components/documents/doc-controls";
import { DocStatusBadge, RevisionBadge, StageBadge } from "@/components/status";
import { EmptyState, Mono, Panel, PanelHeader } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { formatBytes, nextRev } from "@/lib/documents";
import { cn, formatDay, formatDateTime } from "@/lib/utils";
import { canDoc, canReview } from "@/lib/workflow";
import { DOC_TYPE_LABELS, type DocumentRevision } from "@/types/domain";

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ rev?: string; wo?: string }> }) {
  const { id } = await params;
  const { rev: revParam, wo: woParam } = await searchParams;
  const { repo, profile } = await getViewer();
  const doc = await repo.getDocument(id);
  if (!doc) notFound();
  const wo = woParam ? await repo.getWorkOrder(woParam) : null;
  const shown = doc.revisions.find((r) => r.id === revParam) ?? doc.current ?? doc.revisions.find((r) => r.effective_at) ?? doc.revisions[0];
  const shownFull = doc.revisions.find((r) => r.id === shown?.id);
  const author = canDoc("author", profile.role);
  const [assets, others] = author || canDoc("obsolete", profile.role) ? await Promise.all([repo.listAssets(), repo.listDocuments()]) : [[], []];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {wo ? (
        <Link href={`/work-orders/${wo.id}`} className="inline-flex items-center gap-1 text-xs text-tx-3 hover:text-tx-2">
          <ArrowLeft className="size-3" aria-hidden /> <span className="font-mono">{wo.wo_number}</span> {wo.title}
        </Link>
      ) : (
        <Link href="/documents" className="inline-flex items-center gap-1 text-xs text-tx-3 hover:text-tx-2">
          <ArrowLeft className="size-3" aria-hidden /> Documents
        </Link>
      )}

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Mono className="text-sm">{doc.doc_number}</Mono>
          <DocStatusBadge status={doc.status} />
          <span className="text-xs text-tx-3">{DOC_TYPE_LABELS[doc.doc_type]}</span>
        </div>
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-wide sm:text-4xl">{doc.title}</h1>
        {doc.assets.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {doc.assets.map((a) => (
              <Link key={a.id} href={`/assets/${a.id}`} className="font-mono text-xs text-tx-2 hover:text-brass-bright">
                {a.floc}
              </Link>
            ))}
          </div>
        )}
      </header>

      {doc.status === "obsolete" && (
        <Notice tone="bad">
          Obsolete since {formatDay(doc.obsoleted_at)}: {doc.obsolete_reason}{" "}
          {doc.replaced_by ? (
            <>
              Replaced by{" "}
              <Link href={`/documents/${doc.replaced_by.id}`} className="font-mono underline">
                {doc.replaced_by.doc_number}
              </Link>{" "}
              {doc.replaced_by.title}.
            </>
          ) : (
            "Nothing replaces it."
          )}{" "}
          Kept in the archive for the record.
        </Notice>
      )}
      {wo && shown && <WoNotice wo={wo} shown={shown} current={doc.current} />}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {shownFull ? (
            <Panel>
              <PanelHeader
                eyebrow={`Rev ${shownFull.rev}`}
                title={shownFull.change_summary}
                actions={<RevisionBadge status={shownFull.status} />}
              />
              {shownFull.status === "superseded" && (
                <Notice tone="warn" flush>
                  Superseded {formatDay(shownFull.superseded_at)}
                  {doc.current && (
                    <>
                      {" "}by{" "}
                      <Link href={`/documents/${doc.id}`} className="underline">
                        Rev {doc.current.rev}
                      </Link>
                    </>
                  )}
                  . For reference only: use the current revision for new work.
                </Notice>
              )}
              {shownFull.status === "draft" && (
                <Notice tone="info" flush>
                  Draft, not approved. Don&apos;t use it for work until a reviewer approves it.
                </Notice>
              )}
              {shownFull.status === "rejected" && (
                <Notice tone="warn" flush>
                  Rejected{shownFull.reviewed_by_name ? ` by ${shownFull.reviewed_by_name}` : ""}: {shownFull.review_note}
                </Notice>
              )}
              <RevisionContent rev={shownFull} />
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-xs">
                <dt className="text-tx-3">Written by</dt>
                <dd>
                  {shownFull.prepared_by_name ?? "—"}, {formatDay(shownFull.prepared_at)}
                </dd>
                <dt className="text-tx-3">{shownFull.status === "rejected" ? "Rejected by" : "Approved by"}</dt>
                <dd>{shownFull.reviewed_by_name ? `${shownFull.reviewed_by_name}, ${formatDay(shownFull.reviewed_at)}` : "Not reviewed yet"}</dd>
                {shownFull.review_note && shownFull.status !== "rejected" && (
                  <>
                    <dt className="text-tx-3">Review note</dt>
                    <dd>{shownFull.review_note}</dd>
                  </>
                )}
                <dt className="text-tx-3">Effective</dt>
                <dd>{shownFull.effective_at ? formatDateTime(shownFull.effective_at) : "—"}</dd>
              </dl>
              {shownFull.status === "draft" && canReview(profile.role, profile.id, shownFull, doc) && (
                <div className="border-t border-line px-4 py-3">
                  <ReviewDraft documentId={doc.id} revisionId={shownFull.id} rev={shownFull.rev} />
                </div>
              )}
              {shownFull.status === "draft" && shownFull.prepared_by === profile.id && (
                <p className="border-t border-line px-4 py-2.5 text-xs text-tx-3">You wrote this draft, so someone else approves it.</p>
              )}
            </Panel>
          ) : (
            <Panel>
              <EmptyState>No revisions yet.</EmptyState>
            </Panel>
          )}

          {author && doc.status === "active" && !doc.pending && (
            <Panel>
              <PanelHeader eyebrow="Revise" title="Write the next revision" />
              <div className="px-4 py-3">
                <NewRevision documentId={doc.id} nextRev={nextRev(doc.revisions)} currentBody={doc.current?.body ?? null} mode={repo.mode} />
              </div>
            </Panel>
          )}
        </div>

        <aside className="space-y-4">
          <Panel>
            <PanelHeader eyebrow="History" title="Revisions" />
            <ol className="divide-y divide-line">
              {doc.revisions.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/documents/${doc.id}?rev=${r.id}${wo ? `&wo=${wo.id}` : ""}`}
                    className={cn("block px-4 py-2.5 hover:bg-panel-2", r.id === shownFull?.id && "bg-panel-2 shadow-[inset_2px_0_0_var(--brass)]")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">Rev {r.rev}</span>
                      <RevisionBadge status={r.status} />
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-tx-2">{r.change_summary}</p>
                    <p className="text-[11px] text-tx-3">
                      {r.effective_at ? `Effective ${formatDay(r.effective_at)}` : `Written ${formatDay(r.prepared_at)}`}
                      {r.superseded_at && `, superseded ${formatDay(r.superseded_at)}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Applies to" title={`${doc.assets.length} asset${doc.assets.length === 1 ? "" : "s"}`} />
            <div className="space-y-2 px-4 py-3">
              <ul className="space-y-1 text-sm">
                {doc.assets.map((a) => (
                  <li key={a.id}>
                    <Link href={`/assets/${a.id}`} className="hover:text-brass-bright">
                      <span className="font-mono text-xs text-tx-2">{a.floc}</span> <span className="text-tx-3">{a.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {author && doc.status === "active" && (
                <EditDocumentAssets documentId={doc.id} assets={assets.map((a) => ({ id: a.id, floc: a.floc, name: a.name }))} linked={doc.assets.map((a) => a.id)} />
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Work order record" title="Used on" />
            {doc.usage.length === 0 ? (
              <EmptyState>Not on any work order yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {doc.usage.map((u) => (
                  <li key={u.wo.id}>
                    <Link href={`/work-orders/${u.wo.id}`} className="block px-4 py-2 hover:bg-panel-2">
                      <div className="flex items-center gap-2">
                        <span className="whitespace-nowrap font-mono text-xs text-brass-bright">{u.wo.wo_number}</span>
                        <StageBadge stage="execution" status={u.wo.status} />
                      </div>
                      <p className="truncate text-xs text-tx-2">{u.wo.title}</p>
                      <p className="text-[11px] text-tx-3">{u.rev ? `Kept Rev ${u.rev} at close, ${formatDay(u.wo.closed_at)}` : "Open: follows the current revision"}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {canDoc("obsolete", profile.role) && doc.status === "active" && (
            <ObsoleteDocument documentId={doc.id} candidates={others.filter((o) => o.id !== doc.id).map((o) => ({ id: o.id, doc_number: o.doc_number, title: o.title }))} />
          )}
        </aside>
      </div>
    </div>
  );
}

function Notice({ tone, flush, children }: { tone: "warn" | "bad" | "info"; flush?: boolean; children: React.ReactNode }) {
  const cls = { warn: "border-warn/40 bg-warn/10 text-warn", bad: "border-bad/40 bg-bad/10 text-bad", info: "border-info/40 bg-info/10 text-info" }[tone];
  return (
    <div className={cn("flex gap-2 px-3 py-2 text-sm", flush ? "border-b" : "rounded-[3px] border", cls)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Opened from a work order: say which revision this is for that work. */
function WoNotice({ wo, shown, current }: { wo: { id: string; wo_number: string; status: string }; shown: DocumentRevision; current: DocumentRevision | null }) {
  if (wo.status !== "open") {
    return (
      <div className="rounded-[3px] border border-line-strong bg-panel-2 px-3 py-2 text-sm text-tx-2">
        Rev {shown.rev} is the revision kept with <span className="font-mono">{wo.wo_number}</span> when it closed.
        {current && current.id !== shown.id && ` Rev ${current.rev} is current now.`}
      </div>
    );
  }
  return (
    <div className="rounded-[3px] border border-good/40 bg-good/[0.07] px-3 py-2 text-sm text-tx-2">
      Opened from <span className="font-mono">{wo.wo_number}</span>: Rev {shown.rev}
      {shown.id === current?.id ? " is current. " : ". "}
      This view is logged on the work order, and the revision used is kept with it when it closes.
    </div>
  );
}

function RevisionContent({ rev }: { rev: DocumentRevision }) {
  if (rev.file) {
    const url = `/documents/file/${rev.id}`;
    const image = rev.file.mime.startsWith("image/");
    return (
      <div>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2 text-xs text-tx-3">
          <span className="font-mono text-tx-2">{rev.file.name}</span>
          <span>{formatBytes(rev.file.size)}</span>
          <a href={url} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center gap-1 text-brass hover:text-brass-bright">
            <ExternalLink className="size-3.5" aria-hidden /> Full screen
          </a>
          <a href={`${url}?download=1`} className="inline-flex min-h-9 items-center gap-1 text-brass hover:text-brass-bright">
            <Download className="size-3.5" aria-hidden /> Download
          </a>
        </div>
        <div className="bg-[#f4f1ea] p-2">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element -- documents are served by our own route, sized by the file
            <img src={url} alt={rev.file.name} className="mx-auto h-auto max-w-full" />
          ) : (
            <iframe src={url} title={rev.file.name} className="h-[75vh] w-full bg-white" />
          )}
        </div>
      </div>
    );
  }
  return <div className="px-4 py-4">{rev.body ? <DocBody source={rev.body} /> : <EmptyState>No content.</EmptyState>}</div>;
}
