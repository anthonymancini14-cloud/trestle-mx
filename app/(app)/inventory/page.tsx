import { StockBadge } from "@/components/status";
import { Mono, Panel, Table, Td, Th } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { currency } from "@/lib/utils";
import type { CableSpec, InventoryItem } from "@/types/domain";

export const metadata = { title: "Storeroom" };

export default async function InventoryPage() {
  const { repo } = await getViewer();
  const items = await repo.listInventory();
  const value = items.reduce((s, i) => s + i.on_hand * i.part.unit_cost, 0);
  const reservedLines = items.filter((i) => i.reserved > 0).length;
  const below = items.filter((i) => i.on_hand - i.reserved < i.min_qty).length;
  const cables = items.filter((i) => i.part.specs?.kind === "cable");
  const categories = [...new Set(items.filter((i) => !cables.includes(i)).map((i) => i.part.category))].sort();

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Storeroom</h1>
          <p className="text-sm text-tx-3">Available = on hand minus reserved for planned work.</p>
        </div>
        <dl className="flex gap-6 text-right">
          <Stat label="Stock value" value={currency(value)} />
          <Stat label="Reserved lines" value={String(reservedLines)} />
          <Stat label="Below min" value={String(below)} warn={below > 0} />
        </dl>
      </div>

      {cables.length > 0 && <CableTable items={cables} />}

      {categories.map((cat) => (
        <Panel key={cat}>
          <div className="border-b border-line px-4 py-2 font-display text-sm font-semibold uppercase tracking-wider">{cat}</div>
          <Table>
            <thead>
              <tr>
                <Th className="w-40">Part</Th>
                <Th>Description</Th>
                <Th>Bin</Th>
                <Th className="text-right">On hand</Th>
                <Th className="text-right">Reserved</Th>
                <Th className="text-right">Min / max</Th>
                <Th>Available</Th>
                <Th className="text-right">Unit cost</Th>
              </tr>
            </thead>
            <tbody>
              {items
                .filter((i) => i.part.category === cat)
                .map((i) => (
                  <tr key={i.id} className="hover:bg-panel-2">
                    <Td>
                      <Mono className="text-xs">{i.part.part_number}</Mono>
                    </Td>
                    <Td className="min-w-64 text-tx-2">
                      {i.part.description}
                      {i.part.manufacturer && <span className="text-tx-3"> · {i.part.manufacturer} {i.part.mfr_part_number}</span>}
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-xs text-tx-3">{i.bin}</Td>
                    <Td className="text-right font-mono text-xs">{i.on_hand}</Td>
                    <Td className="text-right font-mono text-xs text-info">{i.reserved || "—"}</Td>
                    <Td className="text-right font-mono text-xs text-tx-3">
                      {i.min_qty} / {i.max_qty}
                    </Td>
                    <Td>
                      <StockBadge available={i.on_hand - i.reserved} min={i.min_qty} />
                    </Td>
                    <Td className="text-right font-mono text-xs">{currency(i.part.unit_cost)}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Panel>
      ))}
    </div>
  );
}

/** Cable stock: type, dimensions and both terminations, so the right replacement is picked first time. */
function CableTable({ items }: { items: InventoryItem[] }) {
  return (
    <Panel>
      <div className="flex items-baseline justify-between border-b border-line px-4 py-2">
        <span className="font-display text-sm font-semibold uppercase tracking-wider">Cable</span>
        <span className="text-xs text-tx-3">Type, dimensions and terminations</span>
      </div>
      <Table>
        <thead>
          <tr>
            <Th className="w-44">Part</Th>
            <Th>Cable</Th>
            <Th className="text-right">Length</Th>
            <Th className="text-right">OD</Th>
            <Th>Jacket</Th>
            <Th>End A</Th>
            <Th>End B</Th>
            <Th>Bin</Th>
            <Th>Available</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const s = i.part.specs as CableSpec;
            return (
              <tr key={i.id} className="hover:bg-panel-2">
                <Td>
                  <Mono className="text-xs">{i.part.part_number}</Mono>
                </Td>
                <Td className="min-w-56">
                  <div className="text-tx">{s.cable_type}</div>
                  <div className="text-xs text-tx-3">
                    {s.count} {s.media === "Fiber" ? "fibers" : "conductors"} · {s.gauge}
                    {s.polarity ? ` · ${s.polarity}` : ""}
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-right font-mono text-xs">{s.length_m === null ? "Bulk" : `${s.length_m} m`}</Td>
                <Td className="whitespace-nowrap text-right font-mono text-xs">{s.outer_diameter_mm} mm</Td>
                <Td className="text-xs text-tx-2">{s.jacket}</Td>
                <Td className="min-w-36 text-xs text-tx-2">{s.termination_a}</Td>
                <Td className="min-w-36 text-xs text-tx-2">{s.termination_b}</Td>
                <Td className="whitespace-nowrap font-mono text-xs text-tx-3">{i.bin}</Td>
                <Td>
                  <StockBadge available={i.on_hand - i.reserved} min={i.min_qty} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Panel>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-tx-3">{label}</dt>
      <dd className={warn ? "font-display text-2xl font-semibold text-warn" : "font-display text-2xl font-semibold"}>{value}</dd>
    </div>
  );
}
