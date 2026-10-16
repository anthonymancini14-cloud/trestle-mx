import { StockBadge } from "@/components/status";
import { Mono, Panel, Table, Td, Th } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { currency } from "@/lib/utils";

export const metadata = { title: "Storeroom" };

export default async function InventoryPage() {
  const { repo } = await getViewer();
  const items = await repo.listInventory();
  const value = items.reduce((s, i) => s + i.on_hand * i.part.unit_cost, 0);
  const reservedLines = items.filter((i) => i.reserved > 0).length;
  const below = items.filter((i) => i.on_hand - i.reserved < i.min_qty).length;
  const categories = [...new Set(items.map((i) => i.part.category))].sort();

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
                    <Td className="font-mono text-xs text-tx-3">{i.bin}</Td>
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

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-tx-3">{label}</dt>
      <dd className={warn ? "font-display text-2xl font-semibold text-warn" : "font-display text-2xl font-semibold"}>{value}</dd>
    </div>
  );
}
