import { NewWorkOrderForm } from "@/components/work-orders/new-work-order-form";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";

export const metadata = { title: "Report a problem" };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const { asset } = await searchParams;
  const { repo } = await getViewer();
  const [assets, classes, areas] = await Promise.all([repo.listAssets(), repo.listAssetClasses(), repo.listAreas()]);
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const areaName = new Map(areas.map((a) => [a.id, `${a.code} ${a.name}`]));
  const options = assets
    .filter((a) => a.status !== "retired")
    .map((a) => ({
      id: a.id,
      floc: a.floc,
      name: a.name,
      className: (a.class_id && className.get(a.class_id)) || "Unclassified",
      area: areaName.get(a.area_id) ?? "",
    }));

  return (
    <div className="mx-auto max-w-2xl">
      <Panel>
        <PanelHeader eyebrow="Stage 1 · Identification" title="Report a problem" />
        <NewWorkOrderForm assets={options} defaultAssetId={asset} />
      </Panel>
    </div>
  );
}
