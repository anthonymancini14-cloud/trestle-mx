import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AiStateBadge } from "@/components/audit/audit-badges";
import { RecordView } from "@/components/audit/record-view";
import { ReviewPanel } from "@/components/audit/review-panel";
import { Mono, Panel, PanelHeader } from "@/components/ui/primitives";
import { flagCount, SCRIPTED_PROVIDER } from "@/lib/ai/queue";
import { normalizeTag, worklogSchema } from "@/lib/ai/tasks/worklog-schema";
import { getViewer } from "@/lib/auth/viewer";
import { formatDateTime } from "@/lib/utils";
import { canReviewRun } from "@/lib/workflow";
import { AI_SOURCE_LABELS, AI_STATE_LABELS, AI_TASK_LABELS } from "@/types/domain";

export const metadata = { title: "AI audit" };

export default async function AuditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repo, profile } = await getViewer();
  const item = await repo.getAiQueueItem(id);
  if (!item) notFound();

  const run = item.run;
  const parsed = run?.output ? worklogSchema.safeParse(run.output) : null;
  const record = parsed?.success ? parsed.data : null;
  const correctedParse = item.review?.corrected_output ? worklogSchema.safeParse(item.review.corrected_output) : null;
  const corrected = correctedParse?.success ? correctedParse.data : null;
  const scripted = run?.provider === SCRIPTED_PROVIDER;
  const flags = flagCount(run);

  // A tag is only useful if it names something in the register. Matched in code, on the end of the FLOC.
  // A tag the checks flagged is not looked up until a reviewer has settled it, so an invented tag can't look confirmed.
  const tagFlagged = !corrected && (run?.issues ?? []).some((i) => i.field === "asset_tag" && i.severity === "flag");
  const tag = tagFlagged ? null : ((corrected ?? record)?.asset_tag ?? null);
  const matches = tag ? (await repo.listAssets()).filter((a) => normalizeTag(a.floc).endsWith(normalizeTag(tag))) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <Link href="/audit" className="inline-flex items-center gap-1 text-xs text-tx-3 hover:text-tx">
          <ArrowLeft className="size-3.5" aria-hidden /> AI audit
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">{AI_TASK_LABELS[item.task]}</h1>
          <AiStateBadge state={item.state} />
        </div>
        <p className="text-sm text-tx-3">
          {AI_SOURCE_LABELS[item.source]}
          {item.wo && (
            <>
              ,{" "}
              <Link href={`/work-orders/${item.wo.id}`} className="font-mono text-brass-bright hover:underline">
                {item.wo.wo_number}
              </Link>
            </>
          )}{" "}
          · added by {item.submitted_by_name ?? "someone no longer on the roster"}, {formatDateTime(item.created_at)}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <Panel>
            <PanelHeader eyebrow="Source" title="The entry as written" />
            <p className="whitespace-pre-wrap px-4 py-3 font-mono text-[13px] leading-relaxed text-tx">{item.input.text}</p>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Run" title={run ? (scripted ? "Scripted demo output" : run.model) : AI_STATE_LABELS[item.state]} />
            {run ? (
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 px-4 py-3 text-sm">
                <dt className="text-xs text-tx-3">Reached through</dt>
                <dd>{scripted ? "Not a model run. Written by hand for the demo." : run.provider}</dd>
                <dt className="text-xs text-tx-3">Prompt version</dt>
                <dd>
                  <Mono className="text-tx-2">{run.prompt_version}</Mono>
                </dd>
                <dt className="text-xs text-tx-3">Time taken</dt>
                <dd>{run.latency_ms === null ? "—" : `${(run.latency_ms / 1000).toFixed(1)} s`}</dd>
                <dt className="text-xs text-tx-3">Checks</dt>
                <dd>
                  {record
                    ? flags
                      ? `${flags} value${flags === 1 ? "" : "s"} flagged`
                      : "Nothing flagged. The checks only catch values missing from the text, so still compare it."
                    : "Not run"}
                </dd>
              </dl>
            ) : (
              <p className="px-4 py-3 text-sm text-tx-2">
                {item.state === "queued" ? "Waiting for the worker beside the local model to pick this up." : "The model is reading this entry."}
              </p>
            )}
            {item.state === "failed" && (
              <div className="border-t border-line px-4 py-3">
                <p className="text-sm text-bad">{item.error ?? "The run failed."}</p>
                {run?.raw_output && (
                  <details className="mt-2 text-xs text-tx-2">
                    <summary className="cursor-pointer text-tx-3">What the model returned</summary>
                    <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-[3px] border border-line bg-bg p-2 font-mono">{run.raw_output}</pre>
                  </details>
                )}
              </div>
            )}
          </Panel>

          {tag && (
            <Panel>
              <PanelHeader eyebrow="Asset register" title={`Tag ${tag}`} />
              {matches.length === 0 ? (
                <p className="px-4 py-3 text-sm text-tx-2">No asset at this site has a tag ending in {tag}. The tag may still be right; the register may be missing it.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {matches.map((a) => (
                    <li key={a.id}>
                      <Link href={`/assets/${a.id}`} className="flex items-baseline gap-3 px-4 py-2.5 hover:bg-panel-2">
                        <Mono>{a.floc}</Mono>
                        <span className="text-sm">{a.name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          {record && (
            <Panel>
              <PanelHeader eyebrow={scripted ? "Scripted output" : "What the model returned"} title="Extracted record" />
              <RecordView record={record} issues={run?.issues ?? []} />
            </Panel>
          )}

          {item.review && (
            <Panel>
              <PanelHeader
                eyebrow="Review"
                title={`${AI_STATE_LABELS[item.review.verdict]} by ${item.review.reviewer_name ?? "a past reviewer"}`}
                actions={<span className="text-xs text-tx-3">{formatDateTime(item.review.created_at)}</span>}
              />
              {item.review.note && <p className="border-b border-line px-4 py-2.5 text-sm text-tx-2">{item.review.note}</p>}
              {corrected && record ? (
                <RecordView record={corrected} compareTo={record} />
              ) : (
                <p className="px-4 py-3 text-sm text-tx-2">
                  {item.review.verdict === "accepted" ? "The record above stands as the model returned it." : "The record above is not used."}
                </p>
              )}
            </Panel>
          )}

          {record && (
            <Panel>
              <PanelHeader eyebrow={item.review ? "Review again" : "Your review"} title="Does the record match the entry?" />
              {canReviewRun(profile.role, item) ? (
                <ReviewPanel key={item.review?.id ?? "first"} jobId={item.id} record={corrected ?? record} reviewed={item.review !== null} />
              ) : (
                <p className="px-4 py-3 text-sm text-tx-3">Planners, supervisors and admins review runs.</p>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
