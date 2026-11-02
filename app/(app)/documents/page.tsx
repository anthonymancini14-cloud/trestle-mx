import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { DocumentTable } from "@/components/documents/document-table";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { buttonVariants } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/viewer";
import { formatDay } from "@/lib/utils";
import { canDoc } from "@/lib/workflow";
import { DOC_TYPE_LABELS } from "@/types/domain";

export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const { repo, profile } = await getViewer();
  const [docs, profiles] = await Promise.all([repo.listDocuments({ includeObsolete: true }), repo.listProfiles()]);
  const pending = docs.filter((d) => d.pending && d.status === "active");
  const nameOf = (id: string | null) => profiles.find((p) => p.id === id)?.full_name ?? "—";
  const reviewer = canDoc("review", profile.role);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Documents</h1>
          <p className="text-sm text-tx-3">
            Controlled OEM manuals, drawings, specifications, procedures and MOCs. Work orders keep the revision they used.
          </p>
        </div>
        {canDoc("author", profile.role) && (
          <Link href="/documents/new" className={buttonVariants({ variant: "primary" })}>
            <FilePlus2 aria-hidden /> New document
          </Link>
        )}
      </div>

      {pending.length > 0 && (
        <Panel>
          <PanelHeader eyebrow={reviewer ? "Needs your review" : "Waiting for review"} title={`${pending.length} draft revision${pending.length === 1 ? "" : "s"}`} />
          <ul className="divide-y divide-line">
            {pending.map((d) => (
              <li key={d.id}>
                <Link href={`/documents/${d.id}?rev=${d.pending!.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 hover:bg-panel-2">
                  <span className="whitespace-nowrap font-mono text-sm text-brass-bright">
                    {d.doc_number} Rev {d.pending!.rev}
                  </span>
                  <span className="text-sm">{d.title}</span>
                  <span className="text-xs text-tx-3">
                    {DOC_TYPE_LABELS[d.doc_type]} · {d.pending!.change_summary} · {nameOf(d.pending!.prepared_by)}, {formatDay(d.pending!.prepared_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <DocumentTable docs={docs} />
    </div>
  );
}
