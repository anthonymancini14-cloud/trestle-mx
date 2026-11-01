import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CableRoutePanel, CableSpecPanel, CarriedCablesPanel } from "@/components/assets/cable-panels";
import { DataQualityBadge } from "@/components/assets/data-quality";
import { CriticalityBadge, PriorityBadge, StageBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Mono, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { assessAsset, formatAttribute, statusLabel } from "@/lib/taxonomy/assess";
import { formatDate, formatHours } from "@/lib/utils";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo } = await getViewer();
  const asset = await repo.getAsset(id);
  if (!asset) notFound();

  const cls = asset.asset_class;
  const isCable = cls?.code === "CABLE";
  const isTray = cls?.code === "CABLE-TRAY";
  const partNumber = typeof asset.attributes.part_number === "string" ? asset.attributes.part_number : null;
  const cableStock = isCable && partNumber ? (await repo.listInventory()).find((i) => i.part.part_number === partNumber) : undefined;
  const assessment = assessAsset(asset, cls);
  const issueByKey = new Map(assessment.issues.map((i) => [i.spec.key, i]));

  const fields: [string, string | null][] = [
    ["Area", `${asset.area.code} · ${asset.area.name}`],
    ["Make / model", [asset.manufacturer, asset.model].filter(Boolean).join(" ") || null],
    ["Serial", asset.serial_number],
    ["Installed", asset.install_date?.slice(0, 4) ?? null],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/assets" className="inline-flex items-center gap-1 text-xs text-tx-3 hover:text-tx-2">
        <ArrowLeft className="size-3" aria-hidden /> Asset registry
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Mono className="text-sm">{asset.floc}</Mono>
          <h1 className="font-display text-3xl font-semibold tracking-wide">{asset.name}</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            <CriticalityBadge criticality={asset.criticality} />
            <Badge className="border-line-strong text-tx-2">{statusLabel(asset.status, cls?.code)}</Badge>
            <DataQualityBadge assessment={assessment} />
          </div>
        </div>
        <Button asChild size="sm">
          <Link href={`/work-orders/new?asset=${asset.id}`}>Report a problem on this asset</Link>
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Nameplate" />
            <dl className="space-y-2 px-4 py-3 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-tx-3">Class</dt>
                <dd>
                  {cls ? (
                    <Link href={`/asset-classes/${cls.id}`} className="hover:text-brass-bright">
                      {cls.name} <Mono className="text-xs">{cls.code}</Mono>
                    </Link>
                  ) : (
                    <span className="text-bad">Unclassified</span>
                  )}
                </dd>
              </div>
              {fields.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] uppercase tracking-wider text-tx-3">{k}</dt>
                  <dd>{v ?? "—"}</dd>
                </div>
              ))}
              {asset.notes && (
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-tx-3">Notes</dt>
                  <dd className="text-tx-2">{asset.notes}</dd>
                </div>
              )}
            </dl>
            {(asset.parent || asset.children.length > 0) && (
              <div className="border-t border-line px-4 py-3 text-sm">
                <div className="text-[11px] uppercase tracking-wider text-tx-3">Hierarchy</div>
                {asset.parent && (
                  <Link href={`/assets/${asset.parent.id}`} className="mt-1 block font-mono text-xs text-tx-2 hover:text-brass-bright">
                    ↑ {asset.parent.floc}
                  </Link>
                )}
                {asset.children.map((c) => (
                  <Link key={c.id} href={`/assets/${c.id}`} className="mt-1 block font-mono text-xs text-tx-2 hover:text-brass-bright">
                    ↓ {c.floc}
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {cls && (
            <Panel>
              <PanelHeader eyebrow={cls.code} title="Class attributes" actions={<DataQualityBadge assessment={assessment} />} />
              <dl className="divide-y divide-line/60 text-sm">
                {cls.attributes.map((spec) => {
                  const issue = issueByKey.get(spec.key);
                  return (
                    <div key={spec.key} className="flex items-baseline justify-between gap-3 px-4 py-2">
                      <dt className="text-tx-3">
                        {spec.label}
                        {spec.required && <span className="text-tx-3"> *</span>}
                      </dt>
                      <dd className={issue ? "text-warn" : undefined}>
                        {issue?.problem === "missing" ? "Missing" : formatAttribute(spec, asset.attributes[spec.key])}
                        {issue && issue.problem !== "missing" && <span className="ml-1 text-xs">(invalid)</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className="border-t border-line px-4 py-2 text-xs text-tx-3">* Required by the class standard.</p>
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          {isCable && (
            <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
              <CableRoutePanel attributes={asset.attributes} route={asset.route} eyebrow="Pathway" />
              <CableSpecPanel partNumber={partNumber} item={cableStock} />
            </div>
          )}
          {isTray && <CarriedCablesPanel cables={asset.carried_cables} />}
          <Panel>
            <PanelHeader eyebrow="Work history" title="Work orders" actions={<span className="font-mono text-xs text-tx-3">{asset.history.length}</span>} />
            {asset.history.length === 0 ? (
              <EmptyState>No work recorded on this asset.</EmptyState>
            ) : (
              <ul className="divide-y divide-line/60">
                {asset.history.map((w) => (
                  <li key={w.id}>
                    <Link href={`/work-orders/${w.id}`} className="block px-4 py-2.5 hover:bg-panel-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Mono className="text-xs">{w.wo_number}</Mono>
                        <PriorityBadge priority={w.priority} compact />
                        <StageBadge stage={w.stage} status={w.status} />
                        <span className="ml-auto text-xs text-tx-3">
                          {formatDate(w.closed_at ?? w.created_at)} · {formatHours(w.actual_hours ?? w.estimated_hours)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm">{w.title}</div>
                      {w.debrief && <p className="mt-1 line-clamp-2 text-xs text-tx-3">{w.debrief}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {cls && cls.failure_modes.length > 0 && (
            <Panel>
              <PanelHeader eyebrow={cls.name} title="Known failure modes" actions={<span className="font-mono text-xs text-tx-3">{cls.failure_modes.length}</span>} />
              <Table>
                <thead>
                  <tr>
                    <Th className="w-16">Code</Th>
                    <Th>Failure mode</Th>
                    <Th className="hidden sm:table-cell">How it is detected</Th>
                  </tr>
                </thead>
                <tbody>
                  {cls.failure_modes.map((m) => (
                    <tr key={m.id}>
                      <Td>
                        <Mono className="text-xs">{m.code}</Mono>
                      </Td>
                      <Td>
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-tx-3">{m.description}</div>
                      </Td>
                      <Td className="hidden text-xs text-tx-2 sm:table-cell">{m.detection}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
