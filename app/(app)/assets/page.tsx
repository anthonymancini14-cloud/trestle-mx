import Link from "next/link";
import { DataQualityBadge, QualityStat, qualityTone } from "@/components/assets/data-quality";
import { CriticalityBadge } from "@/components/status";
import { Badge, Mono, Panel, PanelHeader } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { assessAsset, assessRegister, statusLabel, type AssetAssessment } from "@/lib/taxonomy/assess";
import { cn } from "@/lib/utils";
import type { Asset } from "@/types/domain";

export const metadata = { title: "Assets" };

export default async function AssetsPage() {
  const { repo } = await getViewer();
  const [assets, areas, workOrders, classes] = await Promise.all([
    repo.listAssets(),
    repo.listAreas(),
    repo.listWorkOrders({ status: "open" }),
    repo.listAssetClasses(),
  ]);
  const classById = new Map(classes.map((c) => [c.id, c]));
  const quality = assessRegister(assets, classes);
  const assessments = new Map(assets.map((a) => [a.id, assessAsset(a, a.class_id ? classById.get(a.class_id) ?? null : null)]));
  const classNames = new Map(classes.map((c) => [c.id, c.name]));
  const classCodes = new Map(classes.map((c) => [c.id, c.code]));
  const openByAsset = new Map<string, number>();
  for (const w of workOrders) if (w.asset_id) openByAsset.set(w.asset_id, (openByAsset.get(w.asset_id) ?? 0) + 1);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Asset registry</h1>
        <p className="text-sm text-tx-3">
          Functional locations by area. Child equipment is indented under its parent. Every asset is held to its class standard in the{" "}
          <Link href="/asset-classes" className="text-brass-bright hover:underline">
            class library
          </Link>
          .
        </p>
      </div>
      <section aria-label="Register data quality" className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line bg-line sm:grid-cols-4">
        <QualityStat label="Assets" value={String(quality.total)} detail={`${classes.length} classes in library`} />
        <QualityStat
          label="Classified"
          value={`${quality.classified}/${quality.total}`}
          tone={quality.classified === quality.total ? "good" : "bad"}
        />
        <QualityStat label="Data complete" value={`${quality.completePct}%`} detail={`${quality.complete} of ${quality.total} assets`} tone={qualityTone(quality.completePct)} />
        <QualityStat label="Required fields filled" value={`${quality.attributeFillPct}%`} tone={qualityTone(quality.attributeFillPct)} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {areas.map((area) => {
          const inArea = assets.filter((a) => a.area_id === area.id);
          const roots = inArea.filter((a) => !a.parent_id || !inArea.some((p) => p.id === a.parent_id));
          return (
            <Panel key={area.id}>
              <PanelHeader eyebrow={<span className="font-mono">{area.code}</span>} title={area.name} actions={<span className="font-mono text-xs text-tx-3">{inArea.length}</span>} />
              <ul className="divide-y divide-line/60">
                {roots.map((a) => (
                  <AssetRow key={a.id} asset={a} all={inArea} depth={0} openByAsset={openByAsset} assessments={assessments} classNames={classNames} classCodes={classCodes} />
                ))}
              </ul>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

interface RowProps {
  asset: Asset;
  all: Asset[];
  depth: number;
  openByAsset: Map<string, number>;
  assessments: Map<string, AssetAssessment>;
  classNames: Map<string, string>;
  classCodes: Map<string, string>;
}

function AssetRow({ asset, all, depth, openByAsset, assessments, classNames, classCodes }: RowProps) {
  const assessment = assessments.get(asset.id)!;
  const children = all.filter((a) => a.parent_id === asset.id);
  const open = openByAsset.get(asset.id) ?? 0;
  return (
    <>
      <li>
        <Link href={`/assets/${asset.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-panel-2" style={{ paddingLeft: `${1 + depth * 1.25}rem` }}>
          {depth > 0 && <span className="text-tx-3" aria-hidden>└</span>}
          <div className="min-w-0 flex-1">
            <Mono className="text-xs">{asset.floc}</Mono>
            <div className="truncate text-sm text-tx-2">{asset.name}</div>
            <div className="truncate text-xs text-tx-3">{(asset.class_id && classNames.get(asset.class_id)) ?? "Unclassified"}</div>
          </div>
          {!assessment.complete && <DataQualityBadge assessment={assessment} />}
          {open > 0 && <Badge className="border-brass/40 text-brass-bright">{open} open</Badge>}
          <Badge className={cn(asset.status === "running" ? "border-good/40 text-good" : asset.status === "down" ? "border-bad/50 text-bad" : "border-line-strong text-tx-3")}>
            {statusLabel(asset.status, asset.class_id ? classCodes.get(asset.class_id) : null)}
          </Badge>
          <CriticalityBadge criticality={asset.criticality} />
        </Link>
      </li>
      {children.map((c) => (
        <AssetRow key={c.id} asset={c} all={all} depth={depth + 1} openByAsset={openByAsset} assessments={assessments} classNames={classNames} classCodes={classCodes} />
      ))}
    </>
  );
}
