import { NewWorkOrderForm } from "@/components/work-orders/new-work-order-form";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";

export const metadata = { title: "Report a problem" };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const { asset } = await searchParams;
  const { repo } = await getViewer();
  const assets = await repo.listAssets();

  return (
    <div className="mx-auto max-w-2xl">
      <Panel>
        <PanelHeader eyebrow="Stage 1 · Identification" title="Report a problem" />
        <NewWorkOrderForm assets={assets.map((a) => ({ id: a.id, label: `${a.floc} · ${a.name}` }))} defaultAssetId={asset} />
      </Panel>
    </div>
  );
}
