import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DocumentForm } from "@/components/documents/document-form";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { canDoc } from "@/lib/workflow";
import { DOC_TYPES, type DocType } from "@/types/domain";

export const metadata = { title: "New document" };

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ asset?: string; type?: string }> }) {
  const { asset, type } = await searchParams;
  const { repo, profile } = await getViewer();
  if (!canDoc("author", profile.role)) redirect("/documents");
  const assets = (await repo.listAssets()).map((a) => ({ id: a.id, floc: a.floc, name: a.name }));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/documents" className="inline-flex items-center gap-1 text-xs text-tx-3 hover:text-tx-2">
        <ArrowLeft className="size-3" aria-hidden /> Documents
      </Link>
      <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">New document</h1>
      <Panel>
        <PanelHeader eyebrow="Document control" title="Revision A" />
        <div className="px-4 py-4">
          <DocumentForm
            kind="new"
            mode={repo.mode}
            assets={assets}
            defaultAssetId={asset}
            defaultType={DOC_TYPES.includes(type as DocType) ? (type as DocType) : undefined}
          />
        </div>
      </Panel>
    </div>
  );
}
