import Link from "next/link";
import { AiStateBadge, FlagBadge } from "@/components/audit/audit-badges";
import { IntakeForm } from "@/components/audit/intake-form";
import { EmptyState, Mono, Panel, PanelHeader, Table, Td, Th } from "@/components/ui/primitives";
import { hasLocalModel, localAiSettings } from "@/lib/ai/config";
import { flagCount, SCRIPTED_PROVIDER, summarizeQueue } from "@/lib/ai/queue";
import { getViewer } from "@/lib/auth/viewer";
import { cn, formatDateTime } from "@/lib/utils";
import { canAi } from "@/lib/workflow";
import { AI_SOURCE_LABELS, AI_TASK_LABELS } from "@/types/domain";

export const metadata = { title: "AI audit" };

export default async function AuditPage() {
  const { repo, profile } = await getViewer();
  const items = await repo.listAiQueue();
  const summary = summarizeQueue(items);
  const canSubmit = canAi("submit", profile.role);
  const local = localAiSettings();

  // Why a new entry can't be taken right now, if it can't.
  const blocked = !canSubmit
    ? "Planners, supervisors and admins add entries."
    : repo.mode === "demo" && !hasLocalModel()
      ? "This demo shows scripted runs. Start the app with a local model (LOCAL_AI_BASE_URL and LOCAL_AI_MODEL) to extract new entries."
      : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">AI audit</h1>
        <p className="max-w-3xl text-sm text-tx-3">
          A local model reads free-text log entries into structured records. Nothing it returns counts until a person has accepted or corrected it, and every correction is kept
          as an example of what right looks like.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Needs review" value={String(summary.needsReview)} note={summary.waiting ? `${summary.waiting} still with the model` : "Finished runs waiting on a person"} tone={summary.needsReview ? "brass" : "neutral"} />
        <Tile label="Flagged by checks" value={String(summary.flagged)} note="A value that may not be in the text" tone={summary.flagged ? "bad" : "neutral"} />
        <Tile label="Reviewed" value={String(summary.reviewed)} note={summary.failed ? `${summary.failed} run${summary.failed === 1 ? "" : "s"} failed` : "Accepted, corrected or rejected"} />
        <Tile
          label="Accepted unchanged"
          value={summary.acceptedShare === null ? "—" : `${Math.round(summary.acceptedShare * 100)}%`}
          note={summary.reviewed ? `Of ${summary.reviewed} reviewed` : "No reviews yet"}
        />
      </div>

      <Panel>
        <PanelHeader
          eyebrow={AI_TASK_LABELS["worklog.extract"]}
          title="Add a log entry"
          actions={
            <span className="text-xs text-tx-3">
              {local ? (
                <>
                  Local model <Mono>{local.model}</Mono>
                </>
              ) : repo.mode === "demo" ? (
                "No local model connected"
              ) : (
                "Runs on the worker"
              )}
            </span>
          }
        />
        <IntakeForm blocked={blocked} mode={repo.mode} />
      </Panel>

      <Panel>
        <PanelHeader title="Queue" eyebrow={`${items.length} entr${items.length === 1 ? "y" : "ies"} at this site`} />
        {items.length === 0 ? (
          <EmptyState>Nothing in the queue yet.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-32">State</Th>
                <Th className="min-w-64">Entry</Th>
                <Th className="w-28">Checks</Th>
                <Th className="w-44">Model</Th>
                <Th className="w-40">Reviewed by</Th>
                <Th className="w-36">Added</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-panel-2">
                  <Td>
                    <AiStateBadge state={item.state} />
                  </Td>
                  <Td>
                    <Link href={`/audit/${item.id}`} className="line-clamp-2 font-mono text-[12.5px] leading-snug text-tx hover:text-brass-bright">
                      {item.input.text}
                    </Link>
                    <div className="mt-0.5 text-xs text-tx-3">
                      {item.wo ? (
                        <>
                          {AI_SOURCE_LABELS[item.source]}, <Mono>{item.wo.wo_number}</Mono>
                        </>
                      ) : (
                        AI_SOURCE_LABELS[item.source]
                      )}
                    </div>
                  </Td>
                  <Td>{item.run?.output ? <FlagBadge count={flagCount(item.run)} /> : <span className="text-xs text-tx-3">—</span>}</Td>
                  <Td className="text-xs text-tx-2">{item.run ? (item.run.provider === SCRIPTED_PROVIDER ? "Scripted demo output" : <span className="font-mono">{item.run.model}</span>) : "—"}</Td>
                  <Td className="text-xs text-tx-2">{item.review?.reviewer_name ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-xs text-tx-3">{formatDateTime(item.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function Tile({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: "neutral" | "brass" | "bad" }) {
  return (
    <div className="rounded-[3px] border border-line bg-panel px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-wider text-tx-3">{label}</div>
      <div className={cn("mt-1 font-display text-3xl font-semibold leading-none", tone === "brass" && "text-brass-bright", tone === "bad" && "text-bad")}>{value}</div>
      <div className="mt-1.5 truncate text-xs text-tx-3">{note}</div>
    </div>
  );
}
