import Link from "next/link";
import { QualityStat, qualityTone } from "@/components/assets/data-quality";
import { Badge, Mono, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { assessRegister } from "@/lib/taxonomy/assess";
import { cn } from "@/lib/utils";
import { CLASS_CATEGORIES, VERTICAL_LABELS } from "@/types/domain";

export const metadata = { title: "Class library" };

export default async function AssetClassesPage() {
  const { repo } = await getViewer();
  const [classes, assets, { site, org }] = await Promise.all([repo.listAssetClasses(), repo.listAssets(), repo.getSite()]);
  const quality = assessRegister(assets, classes);
  const inUse = classes.filter((c) => quality.byClass.has(c.id)).length;
  const modes = classes.reduce((n, c) => n + c.failure_modes.length, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Asset class library</h1>
        <p className="max-w-3xl text-sm text-tx-3">
          One standard for every site in {org.name}. Each class sets the nameplate fields an asset must carry and the failure modes it is known for, so
          equipment can be compared site to site and every PM task can point back to the failure it prevents. Failure mode codes follow ISO 14224 style.
        </p>
      </div>

      <section aria-label="Library summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line bg-line sm:grid-cols-4">
        <QualityStat label="Classes" value={String(classes.length)} detail={`${inUse} in use at ${site.code}`} />
        <QualityStat label="Failure modes" value={String(modes)} />
        <QualityStat label={`${site.code} assets classified`} value={`${quality.classified}/${quality.total}`} tone={quality.classified === quality.total ? "good" : "bad"} />
        <QualityStat label={`${site.code} data complete`} value={`${quality.completePct}%`} tone={qualityTone(quality.completePct)} />
      </section>

      {CLASS_CATEGORIES.map((category) => {
        const inCategory = classes.filter((c) => c.category === category);
        if (!inCategory.length) return null;
        return (
          <Panel key={category}>
            <PanelHeader title={category} actions={<span className="font-mono text-xs text-tx-3">{inCategory.length}</span>} />
            <Table className="min-w-[560px] table-fixed">
              <thead>
                <tr>
                  <Th className="w-32">Code</Th>
                  <Th>Class</Th>
                  <Th className="hidden w-48 md:table-cell">Verticals</Th>
                  <Th className="w-20 text-right">Fields</Th>
                  <Th className="w-20 text-right">Modes</Th>
                  <Th className="w-32 text-right">{site.code} assets</Th>
                </tr>
              </thead>
              <tbody>
                {inCategory.map((c) => {
                  const use = quality.byClass.get(c.id);
                  return (
                    <tr key={c.id} className="hover:bg-panel-2">
                      <Td>
                        <Link href={`/asset-classes/${c.id}`}>
                          <Mono className="text-xs">{c.code}</Mono>
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/asset-classes/${c.id}`} className="font-medium hover:text-brass-bright">
                          {c.name}
                        </Link>
                        <div className="line-clamp-1 text-xs text-tx-3">{c.description}</div>
                      </Td>
                      <Td className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {c.verticals.map((v) => (
                            <Badge key={v} className="border-line-strong text-tx-2">
                              {VERTICAL_LABELS[v]}
                            </Badge>
                          ))}
                        </div>
                      </Td>
                      <Td className="text-right tabular-nums">
                        {c.attributes.filter((a) => a.required).length}
                        <span className="text-tx-3">/{c.attributes.length}</span>
                      </Td>
                      <Td className="text-right tabular-nums">{c.failure_modes.length}</Td>
                      <Td className="text-right tabular-nums">
                        {use ? (
                          <span className={cn(use.complete < use.assets && "text-warn")}>
                            {use.complete}/{use.assets} complete
                          </span>
                        ) : (
                          <span className="text-tx-3">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Panel>
        );
      })}
    </div>
  );
}
