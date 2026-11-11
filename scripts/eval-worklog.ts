/**
 * Score work-log extraction on a local model.
 *
 *   LOCAL_AI_BASE_URL=http://localhost:1234 LOCAL_AI_MODEL=<model> pnpm eval:worklog -- --data eval_set_v0.1.jsonl --split dev
 *
 * Options:
 *   --data <file.jsonl>   rows of {id, text, answer, site?, trade?, quality?, split?}. Without it, the eleven demo entries are used (a smoke test, not an eval set).
 *   --split <name>        score only rows with this split
 *   --shots <n>           use the first n rows as worked examples (they are not scored)
 *   --limit <n>           score at most n rows
 *   --out <file.jsonl>    write each prediction, its score and what the checks found
 */
import { readFileSync, writeFileSync } from "node:fs";
import { scoreRow, summarize, SCORED_FIELDS, type RowScore, type WorklogEvalRow } from "../lib/ai/eval/worklog-score";
import { localProvider } from "../lib/ai/providers";
import { runTask } from "../lib/ai/run";
import { worklogExtractTask } from "../lib/ai/tasks/worklog-extract";
import { worklogSchema } from "../lib/ai/tasks/worklog-schema";
import { WORKLOG_SAMPLES } from "../lib/demo/seed-worklogs";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function loadRows(file: string | undefined): WorklogEvalRow[] {
  if (!file) return WORKLOG_SAMPLES;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const row = JSON.parse(line) as WorklogEvalRow;
      const answer = worklogSchema.safeParse(row.answer);
      if (!row.id || !row.text || !answer.success) throw new Error(`${file} line ${i + 1}: needs id, text and an answer that matches schema v0.2.`);
      return { ...row, answer: answer.data };
    });
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const provider = localProvider();
  if (!provider) {
    console.error("Set LOCAL_AI_BASE_URL and LOCAL_AI_MODEL to the local model to score.");
    process.exit(1);
  }
  const split = arg("split");
  const shotCount = Number(arg("shots") ?? 0);
  const limit = Number(arg("limit") ?? Infinity);
  const all = loadRows(arg("data")).filter((r) => !split || r.split === split);
  const shots = all.slice(0, shotCount).map((r) => ({ input: { text: r.text }, output: r.answer }));
  const rows = all.slice(shotCount, shotCount + limit);
  if (rows.length === 0) {
    console.error("No rows to score.");
    process.exit(1);
  }

  console.log(`${provider.model} through ${provider.name}: ${rows.length} rows${shotCount ? `, ${shotCount} worked examples` : ""}${arg("data") ? "" : " (demo entries: a smoke test, not an eval set)"}`);
  const scores: RowScore[] = [];
  const lines: string[] = [];
  let flagged = 0;
  let promptVersion = "";
  for (const row of rows) {
    const outcome = await runTask(worklogExtractTask, { text: row.text }, provider, { shots });
    promptVersion = outcome.prompt_version;
    const score = scoreRow(row.id, outcome.output, row.answer);
    scores.push(score);
    if (outcome.issues.some((i) => i.severity === "flag")) flagged += 1;
    lines.push(JSON.stringify({ id: row.id, prediction: outcome.output, error: outcome.error, issues: outcome.issues, score: score.score, hallucinations: score.hallucinations, latency_ms: outcome.latency_ms }));
    process.stdout.write(outcome.error ? "x" : ".");
  }
  process.stdout.write("\n\n");

  const report = summarize(rows, scores);
  console.log(`Prompt ${promptVersion}`);
  console.log(`Score ${pct(report.score)}   failed runs ${report.failed}/${report.rows}   rows with a hallucination ${pct(report.hallucinationRate)} (${report.hallucinations} values)   rows flagged by the checks ${flagged}`);
  console.log("\nBy field");
  for (const field of SCORED_FIELDS) console.log(`  ${field.padEnd(18)} ${pct(report.fields[field])}`);
  for (const cut of ["quality", "site", "trade"] as const) {
    const groups = Object.entries(report.by[cut]);
    if (groups.length < 2) continue;
    console.log(`\nBy ${cut}`);
    for (const [name, g] of groups.sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  ${name.padEnd(18)} ${pct(g.score).padStart(6)}   hallucination rows ${pct(g.hallucinationRate).padStart(6)}   n=${g.rows}`);
    }
  }
  const out = arg("out");
  if (out) {
    writeFileSync(out, `${lines.join("\n")}\n`);
    console.log(`\nPredictions written to ${out}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
