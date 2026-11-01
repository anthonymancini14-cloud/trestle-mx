import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DataQualityBadge } from "@/components/assets/data-quality";
import { CriticalityBadge } from "@/components/status";
import { Badge, EmptyState, Mono, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { assessAsset, formatAttribute } from "@/lib/taxonomy/assess";
import { VERTICAL_LABELS, type AttributeSpec } from "@/types/domain";

function typeLabel(spec: AttributeSpec): string {
  if (spec.type === "enum") return spec.options?.join(" · ") ?? "List";
  if (spec.type === "number") return spec.unit ? `Number (${spec.unit})` : "Number";
  if (spec.type === "boolean") return "Yes / no";
  return "Text";
}

export default async function AssetClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo } = await getViewer();
  const [classes, assets, { site }] = await Promise.all([repo.listAssetClasses(), repo.listAssets(), repo.getSite()]);
  const cls = classes.find((c) => c.id === id);
  if (!cls) notFound();
  const members = assets.filter((a) => a.class_id === cls.id);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/asset-classes" className="inline-flex items-center gap-1 text-xs text-tx-3 hover:text-tx-2">
        <ArrowLeft className="size-3" aria-hidden /> Class library
      </Link>
      <header>
        <Mono className="text-sm">{cls.code}</Mono>
        <h1 className="font-display text-3xl font-semibold tracking-wide">{cls.name}</h1>
        <div className="mt-1 flex flex-wrap gap-2">
          <Badge className="border-line-strong text-tx-2">{cls.category}</Badge>
          {cls.verticals.map((v) => (
            <Badge key={v} className="border-brass/40 text-brass-bright">
              {VERTICAL_LABELS[v]}
            </Badge>
          ))}
        </div>
        <p className="mt-2 max-w-3xl text-sm text-tx-2">{cls.description}</p>
      </header>

      <Panel>
        <PanelHeader eyebrow="Data standard" title="Required and optional fields" actions={<span className="font-mono text-xs text-tx-3">{cls.attributes.length}</span>} />
        <Table>
          <thead>
            <tr>
              <Th>Field</Th>
              <Th>Values</Th>
              <Th className="w-24">Required</Th>
            </tr>
          </thead>
          <tbody>
            {cls.attributes.map((a) => (
              <tr key={a.key}>
                <Td className="font-medium">{a.label}</Td>
                <Td className="text-xs text-tx-2">{typeLabel(a)}</Td>
                <Td>{a.required ? <Badge className="border-brass/40 text-brass-bright">Required</Badge> : <span className="text-xs text-tx-3">Optional</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel>
        <PanelHeader eyebrow="ISO 14224 style" title="Failure modes" actions={<span className="font-mono text-xs text-tx-3">{cls.failure_modes.length}</span>} />
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

      <Panel>
        <PanelHeader eyebrow={site.name} title="Assets in this class" actions={<span className="font-mono text-xs text-tx-3">{members.length}</span>} />
        {members.length === 0 ? (
          <EmptyState>No assets at {site.code} use this class.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Asset</Th>
                {cls.attributes
                  .filter((a) => a.required)
                  .slice(0, 3)
                  .map((a) => (
                    <Th key={a.key} className="hidden md:table-cell">
                      {a.label}
                    </Th>
                  ))}
                <Th className="w-36 text-right">Data</Th>
              </tr>
            </thead>
            <tbody>
              {members.map((a) => (
                <tr key={a.id} className="hover:bg-panel-2">
                  <Td>
                    <Link href={`/assets/${a.id}`} className="block">
                      <Mono className="text-xs">{a.floc}</Mono>
                      <div className="flex items-center gap-2 text-sm text-tx-2">
                        {a.name} <CriticalityBadge criticality={a.criticality} />
                      </div>
                    </Link>
                  </Td>
                  {cls.attributes
                    .filter((s) => s.required)
                    .slice(0, 3)
                    .map((s) => (
                      <Td key={s.key} className="hidden text-xs md:table-cell">
                        {a.attributes[s.key] === undefined ? <span className="text-warn">Missing</span> : formatAttribute(s, a.attributes[s.key])}
                      </Td>
                    ))}
                  <Td className="text-right">
                    <DataQualityBadge assessment={assessAsset(a, cls)} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
