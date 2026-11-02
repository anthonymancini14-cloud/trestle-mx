import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DataQualityBadge } from "@/components/assets/data-quality";
import { intervalLabel, StrategyBadge } from "@/components/pm/pm-badges";
import { CriticalityBadge } from "@/components/status";
import { Badge, EmptyState, Mono, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { checkSpares, coverage, type CoverageState } from "@/lib/pm/program";
import { assessAsset, formatAttribute } from "@/lib/taxonomy/assess";
import { cn } from "@/lib/utils";
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
  const [classes, assets, inventory, { site }] = await Promise.all([repo.listAssetClasses(), repo.listAssets(), repo.listInventory(), repo.getSite()]);
  const cls = classes.find((c) => c.id === id);
  if (!cls) notFound();
  const members = assets.filter((a) => a.class_id === cls.id);
  const matrix = coverage(cls);
  const uncovered = matrix.filter((m) => m.byCriticality.A.state === "uncovered" || m.byCriticality.B.state === "uncovered").length;
  const spares = checkSpares(cls, assets, inventory);

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
        <PanelHeader
          eyebrow="Maintenance strategy"
          title="PM program"
          actions={<span className="font-mono text-xs text-tx-3">{cls.pm_tasks.length} tasks</span>}
        />
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line px-4 py-2 text-xs text-tx-3">
          <span>
            Run to failure:{" "}
            <span className="text-tx-2">{cls.run_to_failure.length ? `crit ${cls.run_to_failure.join(", ")}` : "never"}</span>
          </span>
          <span>
            Repeat-failure window: <span className="text-tx-2">{cls.repeat_window_days ? `${cls.repeat_window_days} days` : "off"}</span>
          </span>
          {cls.pm_tasks.some((t) => t.is_starter_default) && <span>Intervals are starter defaults: tune to OEM guidance and your failure history.</span>}
        </div>
        {cls.pm_tasks.length === 0 ? (
          <EmptyState>No PM tasks. This class is maintained on condition or run to failure.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-36">Code</Th>
                <Th>Task</Th>
                <Th className="w-24">For crit</Th>
                <Th className="w-28">Interval</Th>
                <Th className="hidden w-32 md:table-cell">Addresses</Th>
              </tr>
            </thead>
            <tbody>
              {cls.pm_tasks.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Mono className="text-xs">{t.code}</Mono>
                  </Td>
                  <Td>
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-tx-3">
                      <StrategyBadge strategy={t.strategy} />
                      <span className="capitalize">{t.craft}</span>
                      <span>
                        {t.crew_size > 1 ? `${t.crew_size} × ` : ""}
                        {t.est_hours} h
                      </span>
                      {t.requires_shutdown && <span className="text-warn">Out of service</span>}
                    </div>
                  </Td>
                  <Td className="font-mono text-xs">{t.criticalities.join(" ")}</Td>
                  <Td className="text-xs">
                    {intervalLabel(t.interval_days)}
                    {t.interval_days_crit_a && <div className="text-tx-3">Crit A: {intervalLabel(t.interval_days_crit_a)}</div>}
                  </Td>
                  <Td className="hidden font-mono text-xs text-tx-2 md:table-cell">{t.failure_mode_codes.join(" ")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          eyebrow="Defend every task"
          title="Failure mode coverage"
          actions={
            <span className={cn("text-xs", uncovered ? "text-warn" : "text-good")}>
              {uncovered ? `${uncovered} not covered for crit A or B` : "All covered or run to failure"}
            </span>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Failure mode</Th>
              {(["A", "B", "C"] as const).map((c) => (
                <Th key={c} className="w-40">
                  Crit {c}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((m) => (
              <tr key={m.code}>
                <Td>
                  <Mono className="text-xs">{m.code}</Mono> <span className="text-sm">{m.name}</span>
                </Td>
                {(["A", "B", "C"] as const).map((c) => (
                  <Td key={c}>
                    <CoverageCell state={m.byCriticality[c].state} tasks={m.byCriticality[c].tasks} />
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="border-t border-line px-4 py-2 text-xs text-tx-3">
          A failure mode with no task is either accepted (found by alarms or operator rounds) or a gap to close. A task that addresses no failure mode
          shouldn&apos;t exist.
        </p>
      </Panel>

      <Panel>
        <PanelHeader eyebrow={site.name} title="Critical spares" actions={<span className="font-mono text-xs text-tx-3">{spares.length}</span>} />
        {cls.spares.length === 0 ? (
          <EmptyState>No critical spares defined for this class.</EmptyState>
        ) : spares.length === 0 ? (
          <EmptyState>No crit A assets of this class at {site.code} need the defined spares.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Part</Th>
                <Th className="hidden md:table-cell">Protects</Th>
                <Th className="w-24 text-right">Required</Th>
                <Th className="w-24 text-right">Available</Th>
                <Th className="w-28">Status</Th>
              </tr>
            </thead>
            <tbody>
              {spares.map((s) => (
                <tr key={s.spare.id}>
                  <Td>
                    <Mono className="text-xs">{s.part_number}</Mono>
                    <div className="text-xs text-tx-2">{s.description}</div>
                    {s.spare.model && <div className="text-xs text-tx-3">Model {s.spare.model}</div>}
                  </Td>
                  <Td className="hidden font-mono text-xs text-tx-2 md:table-cell">{s.protects.map((a) => a.floc).join(", ")}</Td>
                  <Td className="text-right font-mono text-xs">{s.spare.qty}</Td>
                  <Td className="text-right font-mono text-xs">{s.available}</Td>
                  <Td>
                    <span className={cn("text-xs", s.state === "ok" ? "text-good" : "text-bad")}>
                      {s.state === "ok" ? "On the shelf" : s.state === "short" ? "Short" : "Not stocked"}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
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

function CoverageCell({ state, tasks }: { state: CoverageState; tasks: string[] }) {
  if (state === "covered") return <span className="font-mono text-[11px] text-good">{tasks.map((t) => t.replace(/^.*-(PM\d+)$/, "$1")).join(" ")}</span>;
  if (state === "run_to_failure") return <span className="text-xs text-tx-3">Run to failure</span>;
  return <span className="text-xs text-warn">No task</span>;
}
