import { loadPrompt } from "../prompts/load";
import type { AiTask, Shot } from "../types";
import { checkWorklog, WORKLOG_SCHEMA_VERSION, worklogSchema, type WorklogInput, type WorklogRecord } from "./worklog-schema";

/**
 * Work-log extraction: one free-text maintenance log entry in, one structured
 * record out. A small local model (tier T1) does the reading; the schema, the
 * checks and a person's review decide what is kept.
 */
const logEntry = (text: string) => `<log_entry>\n${text.trim()}\n</log_entry>`;

export const worklogExtractTask: AiTask<WorklogInput, WorklogRecord> = {
  name: "worklog.extract",
  tier: "T1",
  outputSchema: worklogSchema,
  maxOutputTokens: 1200,
  async buildPrompt(input, shots: Shot<WorklogInput, WorklogRecord>[] = []) {
    const prompt = await loadPrompt("worklog-extract.md");
    const examples = shots.length
      ? `\n\n## Examples\n\n${shots.map((s) => `${logEntry(s.input.text)}\n${JSON.stringify(s.output)}`).join("\n\n")}`
      : "";
    return {
      system: `${prompt.text}${examples}`,
      user: logEntry(input.text),
      version: `${WORKLOG_SCHEMA_VERSION}-${prompt.hash}${shots.length ? `-${shots.length}shot` : ""}`,
    };
  },
  check: checkWorklog,
};
