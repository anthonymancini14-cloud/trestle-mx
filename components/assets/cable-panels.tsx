import Link from "next/link";
import { Badge, Mono, Panel, PanelHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { AssetAttributes, CableSpec, InventoryItem, RouteStep } from "@/types/domain";

const str = (v: AssetAttributes[string] | undefined) => (v === undefined ? null : String(v));

/**
 * A cable's route from end A to end B through labeled tray sections, so the
 * crew knows exactly which tray to open up and work within.
 */
export function CableRoutePanel({ attributes, route, eyebrow = "Where to work" }: { attributes: AssetAttributes; route: RouteStep[]; eyebrow?: string }) {
  const endA = str(attributes.end_a);
  const endB = str(attributes.end_b);
  return (
    <Panel>
      <PanelHeader eyebrow={eyebrow} title="Cable route" actions={<span className="font-mono text-xs text-tx-3">{route.length} tray sections</span>} />
      <ol className="px-4 py-3 text-sm">
        <RouteEnd label="End A" value={endA} />
        {route.map((step) => (
          <li key={step.seq} className="relative border-l-2 border-brass/60 py-2 pl-4">
            <span className="absolute -left-[5px] top-3.5 size-2 rounded-full bg-brass" aria-hidden />
            <Link href={`/assets/${step.pathway.id}`} className="group block">
              <div className="flex flex-wrap items-baseline gap-2">
                <Mono className="text-xs group-hover:underline">{step.pathway.floc}</Mono>
                <span className="text-tx">{step.pathway.name}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1.5">
                {str(step.pathway.attributes.tray_type) && <Badge className="border-line-strong text-tx-2">{str(step.pathway.attributes.tray_type)}</Badge>}
                {step.pathway.attributes.width !== undefined && (
                  <Badge className="border-line-strong text-tx-2">
                    {String(step.pathway.attributes.width)} × {String(step.pathway.attributes.depth ?? "?")} in
                  </Badge>
                )}
                {str(step.pathway.attributes.service) && <Badge className="border-line-strong text-tx-2">{str(step.pathway.attributes.service)}</Badge>}
              </div>
              {str(step.pathway.attributes.location) && <div className="mt-1 text-xs text-tx-3">{str(step.pathway.attributes.location)}</div>}
              {step.note && <div className="mt-1 text-xs text-brass-bright">{step.note}</div>}
            </Link>
          </li>
        ))}
        {route.length === 0 && <li className="border-l-2 border-line py-2 pl-4 text-xs text-tx-3">No tray route recorded (in-cabinet or direct run).</li>}
        <RouteEnd label="End B" value={endB} />
      </ol>
    </Panel>
  );
}

function RouteEnd({ label, value }: { label: string; value: string | null }) {
  return (
    <li className="py-1">
      <div className="text-[11px] uppercase tracking-wider text-tx-3">{label}</div>
      <div className={cn("font-mono text-xs", value ? "text-tx" : "text-warn")}>{value ?? "Not recorded"}</div>
    </li>
  );
}

/** The storeroom item that replaces this cable, with its spec and stock. */
export function CableSpecPanel({ partNumber, item }: { partNumber: string | null; item: InventoryItem | undefined }) {
  const spec = item?.part.specs?.kind === "cable" ? item.part.specs : null;
  return (
    <Panel>
      <PanelHeader eyebrow="Replacement" title="Storeroom cable" />
      {!item ? (
        <p className="px-4 py-3 text-sm text-warn">{partNumber ? `${partNumber} is not stocked at this site.` : "No storeroom part recorded for this cable."}</p>
      ) : (
        <div className="px-4 py-3 text-sm">
          <Mono className="text-xs">{item.part.part_number}</Mono>
          <div className="text-tx">{item.part.description}</div>
          {spec && <CableSpecList spec={spec} />}
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className={cn(item.on_hand - item.reserved > 0 ? "text-good" : "text-bad")}>
              {item.on_hand - item.reserved} available
            </span>
            <span className="text-tx-3">
              ({item.on_hand} on hand, {item.reserved} reserved) · bin <span className="font-mono">{item.bin}</span>
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function CableSpecList({ spec, compact }: { spec: CableSpec; compact?: boolean }) {
  const rows: [string, string][] = [
    ["Type", spec.cable_type],
    [spec.media === "Fiber" ? "Fibers" : "Conductors", `${spec.count} · ${spec.gauge}`],
    ["Length", spec.length_m === null ? "Bulk (cut to length)" : `${spec.length_m} m`],
    ["Outer diameter", `${spec.outer_diameter_mm} mm`],
    ["Jacket", spec.jacket],
    ["End A", spec.termination_a],
    ["End B", spec.termination_b],
    ...(spec.polarity ? ([["Polarity", spec.polarity]] as [string, string][]) : []),
  ];
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs", compact ? "mt-1" : "mt-2")}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-tx-3">{k}</dt>
          <dd className="text-tx-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** For a tray section: the cables routed through it. */
export function CarriedCablesPanel({ cables }: { cables: { id: string; floc: string; name: string; attributes: AssetAttributes }[] }) {
  return (
    <Panel>
      <PanelHeader eyebrow="Pathway" title="Cables in this tray" actions={<span className="font-mono text-xs text-tx-3">{cables.length}</span>} />
      {cables.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-tx-3">No cables routed through this section.</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {cables.map((c) => (
            <li key={c.id}>
              <Link href={`/assets/${c.id}`} className="flex items-center gap-3 px-4 py-2 hover:bg-panel-2">
                <div className="min-w-0 flex-1">
                  <Mono className="text-xs">{c.floc}</Mono>
                  <div className="truncate text-sm text-tx-2">{c.name}</div>
                </div>
                {str(c.attributes.media) && <Badge className="border-line-strong text-tx-2">{str(c.attributes.media)}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
