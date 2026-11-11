import { AlertTriangle, Info } from "lucide-react";
import { enumLabel, WORKLOG_FIELD_LABELS, type WorklogRecord } from "@/lib/ai/tasks/worklog-schema";
import { cn } from "@/lib/utils";
import type { AiIssue } from "@/types/domain";

const EMPTY = <span className="text-tx-3">Not in the text</span>;

function IssueLine({ issue }: { issue: AiIssue }) {
  const flag = issue.severity === "flag";
  const Icon = flag ? AlertTriangle : Info;
  return (
    <p className={cn("mt-1 flex items-start gap-1.5 text-xs", flag ? "text-bad" : "text-tx-2")}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold">{flag ? "Check: " : "Note: "}</span>
        {issue.message}
      </span>
    </p>
  );
}

/**
 * One work-log record, field by field, with whatever the checks found beside
 * the field it concerns. `compareTo` marks the fields a reviewer changed.
 */
export function RecordView({ record, issues = [], compareTo }: { record: WorklogRecord; issues?: AiIssue[]; compareTo?: WorklogRecord }) {
  const issuesFor = (field: keyof WorklogRecord) => issues.filter((i) => i.field === field || i.field.startsWith(`${field}.`));
  const changed = (field: keyof WorklogRecord) => compareTo !== undefined && JSON.stringify(compareTo[field]) !== JSON.stringify(record[field]);

  const values: Record<keyof WorklogRecord, React.ReactNode> = {
    asset_tag: record.asset_tag ? <span className="font-mono text-brass-bright">{record.asset_tag}</span> : EMPTY,
    asset_type: record.asset_type ? enumLabel(record.asset_type) : EMPTY,
    symptom: record.symptom ?? EMPTY,
    failure_mode: record.failure_mode ? enumLabel(record.failure_mode) : EMPTY,
    cause: record.cause ?? EMPTY,
    action: record.action ?? EMPTY,
    parts:
      record.parts.length === 0 ? (
        <span className="text-tx-3">None</span>
      ) : (
        <ul className="space-y-0.5">
          {record.parts.map((p, i) => (
            <li key={i}>
              <span className="font-mono text-tx-2">{p.qty ?? "?"} ×</span> {p.name}
            </li>
          ))}
        </ul>
      ),
    readings:
      record.readings.length === 0 ? (
        <span className="text-tx-3">None</span>
      ) : (
        <ul className="space-y-0.5">
          {record.readings.map((r, i) => (
            <li key={i}>
              {r.name}:{" "}
              <span className="font-mono text-brass-bright">
                {r.value}
                {r.unit ? ` ${r.unit}` : ""}
              </span>{" "}
              <span className="text-xs text-tx-3">{enumLabel(r.state)}</span>
            </li>
          ))}
        </ul>
      ),
    loto_applied: record.loto_applied === null ? <span className="text-tx-3">Not mentioned</span> : record.loto_applied ? "Yes" : "No",
    follow_up_needed: record.follow_up_needed ? "Yes" : "No",
    follow_up_note: record.follow_up_note ?? EMPTY,
    status: enumLabel(record.status),
  };

  return (
    <dl className="divide-y divide-line/60">
      {(Object.keys(WORKLOG_FIELD_LABELS) as (keyof WorklogRecord)[]).map((field) => {
        const found = issuesFor(field);
        return (
          <div key={field} className={cn("grid grid-cols-[9.5rem_1fr] gap-3 px-4 py-2 text-sm", found.some((i) => i.severity === "flag") && "bg-bad/[0.06]")}>
            <dt className="text-xs font-medium text-tx-3">
              {WORKLOG_FIELD_LABELS[field]}
              {changed(field) && <span className="ml-1.5 rounded-[2px] bg-warn/15 px-1 text-[10px] font-semibold uppercase tracking-wide text-warn">Changed</span>}
            </dt>
            <dd className="min-w-0 break-words">
              {values[field]}
              {found.map((issue, i) => (
                <IssueLine key={i} issue={issue} />
              ))}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
