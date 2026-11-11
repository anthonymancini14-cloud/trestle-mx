/**
 * The AI worker: runs queued AI jobs on a local model and writes the results
 * back for review. It runs on the machine that has the model (or one that can
 * reach it) and only makes outbound connections, so the site opens no ports.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   LOCAL_AI_BASE_URL=http://localhost:1234 LOCAL_AI_MODEL=<model> pnpm ai:worker
 *
 * Add `--once` to run a single job and exit. The service role key stays on
 * this machine; never ship it to the browser.
 */
import { createClient } from "@supabase/supabase-js";
import { localProvider } from "../lib/ai/providers";
import { AI_TASK_REGISTRY } from "../lib/ai/registry";
import { processNextJob, type JobQueue } from "../lib/ai/worker";
import type { AiJob } from "../types/domain";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const provider = localProvider();

if (!url || !serviceKey || !provider) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOCAL_AI_BASE_URL and LOCAL_AI_MODEL.");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const tasks = Object.keys(AI_TASK_REGISTRY);

const queue: JobQueue = {
  async claim() {
    const { data, error } = await db.rpc("claim_ai_job", { p_tasks: tasks });
    if (error) throw new Error(`claim_ai_job: ${error.message}`);
    return ((data ?? []) as AiJob[])[0] ?? null;
  },
  async complete(jobId, outcome) {
    const { error } = await db.rpc("complete_ai_job", { p_job_id: jobId, p_run: outcome });
    if (error) throw new Error(`complete_ai_job: ${error.message}`);
  },
};

const IDLE_WAIT_MS = 5_000;
const once = process.argv.includes("--once");
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
  console.log("Finishing the current job, then stopping.");
});

async function main() {
  console.log(`Worker started: ${provider!.model} through ${provider!.name}. Tasks: ${tasks.join(", ")}.`);
  while (!stopping) {
    let result: Awaited<ReturnType<typeof processNextJob>>;
    try {
      result = await processNextJob(queue, provider!);
    } catch (error) {
      // The database was unreachable or refused. Wait and try again rather than dying.
      console.error(error instanceof Error ? error.message : error);
      result = "idle";
    }
    if (result !== "idle") console.log(`${new Date().toISOString()} job ${result}`);
    if (once) break;
    if (result === "idle") await new Promise((resolve) => setTimeout(resolve, IDLE_WAIT_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
