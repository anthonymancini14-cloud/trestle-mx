import { beforeEach, describe, expect, it } from "vitest";
import { localAiSettings } from "@/lib/ai/config";
import { scoreRow, summarize, tokenF1 } from "@/lib/ai/eval/worklog-score";
import { loadPrompt } from "@/lib/ai/prompts/load";
import { localProvider } from "@/lib/ai/providers";
import { flagCount, newest, queueState, SCRIPTED_PROVIDER, summarizeQueue } from "@/lib/ai/queue";
import { AI_TASK_REGISTRY, getTask } from "@/lib/ai/registry";
import { extractJson, outputJsonSchema, runTask } from "@/lib/ai/run";
import { worklogExtractTask } from "@/lib/ai/tasks/worklog-extract";
import { ASSET_TYPES, checkWorklog, numbersIn, READING_STATES, WORKLOG_FAILURE_MODES, WORKLOG_STATUSES, worklogSchema, type WorklogRecord } from "@/lib/ai/tasks/worklog-schema";
import type { ChatProvider, ChatRequest, RunOutcome } from "@/lib/ai/types";
import { processNextJob, type JobQueue } from "@/lib/ai/worker";
import { DemoRepository, resetDemoStore } from "@/lib/data/demo-repository";
import { buildDataset, personId } from "@/lib/demo/dataset";
import { SITE } from "@/lib/demo/seed";
import { DC_SITE } from "@/lib/demo/seed-datacenter";
import { WORKLOG_SAMPLES } from "@/lib/demo/seed-worklogs";
import { canAi, canReviewRun } from "@/lib/workflow";
import { AI_TASKS, ROLES } from "@/types/domain";

const EMPTY: WorklogRecord = {
  asset_tag: null,
  asset_type: null,
  symptom: null,
  failure_mode: null,
  cause: null,
  action: null,
  parts: [],
  readings: [],
  loto_applied: null,
  follow_up_needed: false,
  follow_up_note: null,
  status: "complete",
};

/** A provider that answers with fixed text and remembers what it was asked. */
function fakeProvider(reply: string | Error): ChatProvider & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    name: "fake",
    model: "fake-model",
    requests,
    async complete(request) {
      requests.push(request);
      if (reply instanceof Error) throw reply;
      return { text: reply, model: "fake-model-q4", inputTokens: 100, outputTokens: 20 };
    },
  };
}

/** A fetch that returns one JSON body and records the call. */
function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

describe("work-log checks", () => {
  const text = "CRAH-02 high supply air temp. dp 1.4 inwc as found, swapped 6 filters, dp 0.5 as left.";

  it("passes a record that only says what the text says", () => {
    const record: WorklogRecord = {
      ...EMPTY,
      asset_tag: "CRAH-02",
      parts: [{ name: "filter", qty: 6 }],
      readings: [
        { name: "dp", value: 1.4, unit: "inwc", state: "as_found" },
        { name: "dp", value: 0.5, unit: "inwc", state: "as_left" },
      ],
    };
    expect(checkWorklog({ text }, record)).toEqual([]);
  });

  it("matches a tag on case and spacing only", () => {
    expect(checkWorklog({ text: "crah 02 tripped" }, { ...EMPTY, asset_tag: "CRAH-02" })).toEqual([]);
    // A short tag expanded to a longer one is not in the text.
    expect(checkWorklog({ text }, { ...EMPTY, asset_tag: "CFD-DH1-CRAH-02" })[0]).toMatchObject({ field: "asset_tag", severity: "flag" });
    expect(checkWorklog({ text: "the east fan is noisy" }, { ...EMPTY, asset_tag: "east fan" })[0].message).toMatch(/not a tag-like ID/);
  });

  it("flags a reading or quantity that isn't written", () => {
    const issues = checkWorklog({ text }, { ...EMPTY, parts: [{ name: "filter", qty: 8 }], readings: [{ name: "dp", value: 1.5, unit: "inwc", state: "as_found" }] });
    expect(issues.map((i) => i.field)).toEqual(["readings.0", "parts.0"]);
    expect(issues.every((i) => i.severity === "flag")).toBe(true);
  });

  it("reads numbers written with commas, leading dots and as words", () => {
    expect([...numbersIn("1,750 rpm, .05 in, two belts, 3.0 A")].sort((a, b) => a - b)).toEqual([0.05, 2, 3, 1750]);
    // A singular noun gives a quantity of 1 with no number in the text.
    expect(checkWorklog({ text: "replaced the belt" }, { ...EMPTY, parts: [{ name: "belt", qty: 1 }] })).toEqual([]);
    expect(checkWorklog({ text: "replaced two belts" }, { ...EMPTY, parts: [{ name: "belt", qty: 2 }] })).toEqual([]);
  });

  it("flags a lockout the text never mentions, and accepts the ways people write one", () => {
    expect(checkWorklog({ text: "closed the suction valve and opened the breaker" }, { ...EMPTY, loto_applied: true })[0]).toMatchObject({ field: "loto_applied", severity: "flag" });
    for (const said of ["LOTO applied", "locked out at MCC", "lockout hung", "tagged out", "locked and tagged", "locks on"]) {
      expect(checkWorklog({ text: `P-101 ${said}, replaced seal` }, { ...EMPTY, loto_applied: true }), said).toEqual([]);
    }
    expect(checkWorklog({ text: "replaced seal" }, { ...EMPTY, loto_applied: false })[0].severity).toBe("note");
  });

  it("notes fields that disagree with each other", () => {
    const fields = (r: WorklogRecord) => checkWorklog({ text: "x" }, r).map((i) => `${i.severity}:${i.field}`);
    expect(fields({ ...EMPTY, status: "request", action: "reset it" })).toEqual(["note:status"]);
    expect(fields({ ...EMPTY, follow_up_note: "order a spare" })).toEqual(["note:follow_up_needed"]);
    expect(fields({ ...EMPTY, status: "no_fault_found" })).toEqual(["note:failure_mode"]);
  });
});

describe("the extraction prompt", () => {
  it("names every enum value the schema accepts", async () => {
    const { text } = await loadPrompt("worklog-extract.md");
    for (const value of [...ASSET_TYPES, ...WORKLOG_FAILURE_MODES, ...READING_STATES, ...WORKLOG_STATUSES]) {
      expect(text, value).toContain(`\`${value}\``);
    }
    for (const field of Object.keys(worklogSchema.shape)) expect(text, field).toContain(`\`${field}\``);
  });

  it("versions the prompt by its text and the number of examples", async () => {
    const plain = await worklogExtractTask.buildPrompt({ text: "P-101 seal leaking" });
    const again = await worklogExtractTask.buildPrompt({ text: "something else" });
    const shot = await worklogExtractTask.buildPrompt({ text: "P-101 seal leaking" }, [{ input: { text: "G-02 monthly run" }, output: EMPTY }]);
    expect(plain.version).toMatch(/^v0\.2-[0-9a-f]{8}$/);
    expect(again.version).toBe(plain.version);
    expect(shot.version).toBe(`${plain.version}-1shot`);
    expect(plain.user).toBe("<log_entry>\nP-101 seal leaking\n</log_entry>");
    expect(shot.system).toContain("G-02 monthly run");
  });

  it("registers every task under its own name", () => {
    expect(Object.keys(AI_TASK_REGISTRY).sort()).toEqual([...AI_TASKS].sort());
    for (const name of AI_TASKS) expect(getTask(name)?.name).toBe(name);
    expect(getTask("no.such.task")).toBeNull();
  });
});

describe("running a task", () => {
  const good = JSON.stringify({ ...EMPTY, asset_tag: "P-101", symptom: "seal leaking" });
  const input = { text: "P-101 seal leaking" };

  it("finds the JSON in a reply that wraps it", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here is the record:\n{"a":{"b":2}}\nDone.')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("I could not read that.")).toThrow();
  });

  it("returns the parsed output, the model that answered and the checks", async () => {
    const provider = fakeProvider(good);
    const outcome = await runTask(worklogExtractTask, input, provider);
    expect(outcome).toMatchObject({ provider: "fake", model: "fake-model-q4", error: null, issues: [], input_tokens: 100 });
    expect(outcome.output?.asset_tag).toBe("P-101");
    // The schema goes with the request so a server can constrain the reply to it.
    expect(provider.requests[0].jsonSchema).toEqual(outputJsonSchema(worklogExtractTask));
    expect(provider.requests[0].jsonSchema?.name).toBe("worklog_extract");
    expect(provider.requests[0].temperature).toBe(0);
  });

  it("runs the checks on what the model returned", async () => {
    const invented = JSON.stringify({ ...EMPTY, asset_tag: "P-102" });
    expect((await runTask(worklogExtractTask, input, fakeProvider(invented))).issues[0]).toMatchObject({ field: "asset_tag", severity: "flag" });
  });

  it("never throws: a bad reply or a failed call is an outcome with an error", async () => {
    const notJson = await runTask(worklogExtractTask, input, fakeProvider("Sorry, I can't."));
    expect(notJson).toMatchObject({ output: null, raw_output: "Sorry, I can't.", error: "The model's reply was not JSON." });
    const wrongShape = await runTask(worklogExtractTask, input, fakeProvider(JSON.stringify({ ...EMPTY, status: "done" })));
    expect(wrongShape.output).toBeNull();
    expect(wrongShape.error).toMatch(/did not match the output format \(status/);
    const down = await runTask(worklogExtractTask, input, fakeProvider(new Error("connect ECONNREFUSED")));
    expect(down).toMatchObject({ output: null, raw_output: null, error: "connect ECONNREFUSED" });
  });
});

describe("local model providers", () => {
  const request: ChatRequest = { system: "sys", user: "usr", jsonSchema: { name: "worklog_extract", schema: { type: "object" } }, maxOutputTokens: 500, temperature: 0 };

  it("is off unless both a URL and a model are set", () => {
    expect(localAiSettings({})).toBeNull();
    expect(localAiSettings({ LOCAL_AI_BASE_URL: "http://localhost:1234" })).toBeNull();
    expect(localProvider({ LOCAL_AI_MODEL: "m" })).toBeNull();
    expect(localAiSettings({ LOCAL_AI_BASE_URL: "http://localhost:1234/v1/", LOCAL_AI_MODEL: " m " })).toEqual({ baseUrl: "http://localhost:1234", model: "m", api: "openai", reasoning: "off", apiKey: null });
  });

  it("asks an OpenAI-style server for schema-constrained JSON", async () => {
    const { fn, calls } = fakeFetch({ model: "m-q4", choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 9, completion_tokens: 3 } });
    const provider = localProvider({ LOCAL_AI_BASE_URL: "http://box:8000/v1", LOCAL_AI_MODEL: "m", LOCAL_AI_API_KEY: "k" }, fn)!;
    expect(await provider.complete(request)).toEqual({ text: '{"ok":true}', model: "m-q4", inputTokens: 9, outputTokens: 3 });
    expect(calls[0].url).toBe("http://box:8000/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe("Bearer k");
    expect(calls[0].body).toMatchObject({
      model: "m",
      max_tokens: 500,
      stream: false,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
      response_format: { type: "json_schema", json_schema: { name: "worklog_extract", strict: true, schema: { type: "object" } } },
    });
  });

  it("explains an empty reply and a refused request", async () => {
    const empty = fakeFetch({ choices: [{ message: { content: "" }, finish_reason: "length" }] });
    await expect(localProvider({ LOCAL_AI_BASE_URL: "http://x", LOCAL_AI_MODEL: "m" }, empty.fn)!.complete(request)).rejects.toThrow(/no text \(finish reason: length\).*LOCAL_AI_API=lmstudio/);
    const refused = fakeFetch({ error: "model not loaded" }, 404);
    await expect(localProvider({ LOCAL_AI_BASE_URL: "http://x", LOCAL_AI_MODEL: "m" }, refused.fn)!.complete(request)).rejects.toThrow(/404/);
  });

  it("uses LM Studio's own API with reasoning off, and keeps only the message text", async () => {
    const { fn, calls } = fakeFetch({
      model_instance_id: "qwen-9b",
      output: [
        { type: "reasoning", content: "thinking…" },
        { type: "message", content: '{"ok":' },
        { type: "message", content: "true}" },
      ],
      stats: { input_tokens: 12, total_output_tokens: 4 },
    });
    const env = { LOCAL_AI_BASE_URL: "http://localhost:1234", LOCAL_AI_MODEL: "qwen", LOCAL_AI_API: "lmstudio" };
    const provider = localProvider(env, fn)!;
    expect(provider.name).toBe("lmstudio");
    expect(await provider.complete(request)).toEqual({ text: '{"ok":true}', model: "qwen-9b", inputTokens: 12, outputTokens: 4 });
    expect(calls[0].url).toBe("http://localhost:1234/api/v1/chat");
    expect(calls[0].body).toEqual({ model: "qwen", system_prompt: "sys", input: "usr", temperature: 0, max_output_tokens: 500, store: false, reasoning: "off" });
    // Some models have no reasoning setting, and LM Studio refuses the request if one is sent.
    await localProvider({ ...env, LOCAL_AI_REASONING: "auto" }, fn)!.complete(request);
    expect(calls[1].body).not.toHaveProperty("reasoning");
  });
});

describe("scoring against a key", () => {
  const key: WorklogRecord = {
    ...EMPTY,
    asset_tag: "P-201A",
    asset_type: "pump",
    symptom: "high vibration on outboard bearing",
    failure_mode: "bearing_wear",
    action: "replaced outboard bearing",
    parts: [{ name: "bearing 6313", qty: 1 }],
    readings: [
      { name: "vibration", value: 0.42, unit: "in/s", state: "as_found" },
      { name: "vibration", value: 0.08, unit: "in/s", state: "as_left" },
    ],
    loto_applied: true,
  };

  it("scores a perfect record 1 with no hallucinations", () => {
    expect(scoreRow("r1", key, key)).toMatchObject({ score: 1, hallucinations: 0, failed: false });
    // Tag case and spacing, and reading names, don't count against it.
    const loose = { ...key, asset_tag: "p 201a", readings: key.readings.map((r) => ({ ...r, name: "vib" })) };
    expect(scoreRow("r1", loose, key).score).toBe(1);
  });

  it("counts every value given where the key has none", () => {
    const pred: WorklogRecord = { ...key, cause: "misalignment", follow_up_note: "check alignment", readings: [...key.readings, { name: "temp", value: 140, unit: "F", state: "single" }], parts: [...key.parts, { name: "seal", qty: 1 }] };
    const s = scoreRow("r1", pred, key);
    expect(s.hallucinations).toBe(4);
    expect(s.fields.cause).toBe(0);
    expect(s.fields.readings).toBeCloseTo(0.8);
    expect(s.fields.parts).toBeCloseTo(2 / 3);
  });

  it("compares numbers exactly and free text by shared words", () => {
    const off = { ...key, readings: [{ ...key.readings[0], value: 0.4 }, key.readings[1]], symptom: "high vibration" };
    const s = scoreRow("r1", off, key);
    expect(s.fields.readings).toBe(0.5);
    expect(s.fields.symptom).toBeCloseTo(tokenF1("high vibration", key.symptom));
    expect(tokenF1("high vibration", "high vibration on outboard bearing")).toBeCloseTo(4 / 7);
    expect(tokenF1(null, null)).toBe(1);
    expect(tokenF1("something", null)).toBe(0);
  });

  it("scores a failed run zero and reports by quality", () => {
    const rows = [
      { id: "a", text: "t", answer: key, quality: "good" },
      { id: "b", text: "t", answer: key, quality: "terse" },
    ];
    const report = summarize(rows, [scoreRow("a", key, key), scoreRow("b", null, key)]);
    expect(report).toMatchObject({ rows: 2, failed: 1, score: 0.5, hallucinationRate: 0 });
    expect(report.by.quality).toEqual({ good: { rows: 1, score: 1, hallucinationRate: 0 }, terse: { rows: 1, score: 0, hallucinationRate: 0 } });
    expect(report.by.site).toEqual({ unlabeled: { rows: 2, score: 0.5, hallucinationRate: 0 } });
  });
});

describe("audit queue rules", () => {
  it("lets planners, supervisors and admins submit and review", () => {
    const allowed = ROLES.filter((r) => canAi("review", r));
    expect([...allowed].sort()).toEqual(["admin", "planner", "supervisor"]);
    expect(ROLES.filter((r) => canAi("submit", r))).toEqual(allowed);
  });

  it("reviews only a run that has an output", () => {
    for (const state of ["needs_review", "accepted", "corrected", "rejected"]) expect(canReviewRun("planner", { state }), state).toBe(true);
    for (const state of ["queued", "running", "failed"]) expect(canReviewRun("planner", { state }), state).toBe(false);
    expect(canReviewRun("technician", { state: "needs_review" })).toBe(false);
  });

  it("derives the state from the job and its newest review", () => {
    expect(queueState({ status: "queued" }, null)).toBe("queued");
    expect(queueState({ status: "failed" }, null)).toBe("failed");
    expect(queueState({ status: "done" }, null)).toBe("needs_review");
    expect(queueState({ status: "done" }, { verdict: "corrected" })).toBe("corrected");
    const rows = [
      { id: "a", created_at: "2026-11-01T10:00:00Z" },
      { id: "c", created_at: "2026-11-02T10:00:00Z" },
      { id: "b", created_at: "2026-11-02T10:00:00Z" },
    ];
    expect(newest(rows)?.id).toBe("c");
    expect(newest([])).toBeNull();
  });
});

describe("demo audit queue", () => {
  const db = buildDataset(new Date("2026-11-11T12:00:00Z"));

  it("seeds valid records whose correct answers pass every check", () => {
    expect(WORKLOG_SAMPLES.length).toBe(db.aiJobs.length);
    for (const row of WORKLOG_SAMPLES) {
      expect(worklogSchema.safeParse(row.answer).success, row.id).toBe(true);
      expect(checkWorklog({ text: row.text }, row.answer).filter((i) => i.severity === "flag"), row.id).toEqual([]);
    }
    for (const run of db.aiRuns) {
      expect(worklogSchema.safeParse(run.output).success).toBe(true);
      expect(run.provider).toBe(SCRIPTED_PROVIDER);
    }
  });

  it("shows the checks catching an invented tag, a lockout nobody mentioned and a mistyped reading", () => {
    const flagged = db.aiRuns.flatMap((r) => r.issues.filter((i) => i.severity === "flag").map((i) => i.field));
    expect(flagged.sort()).toEqual(["asset_tag", "loto_applied", "readings.2"]);
    // The part that was ordered, not installed, passes the checks. A person caught it.
    const corrected = db.aiReviews.find((v) => v.verdict === "corrected")!;
    const run = db.aiRuns.find((r) => r.id === corrected.run_id)!;
    expect(flagCount(run)).toBe(0);
    expect((corrected.corrected_output as WorklogRecord).parts).toEqual([]);
    expect((run.output as WorklogRecord).parts).toHaveLength(1);
  });

  it("keeps every row tied to a real site, person and run", () => {
    const sites = new Set(db.sites.map((s) => s.id));
    const people = new Set(db.profiles.map((p) => p.id));
    const jobs = new Set(db.aiJobs.map((j) => j.id));
    const runs = new Set(db.aiRuns.map((r) => r.id));
    for (const j of db.aiJobs) expect(sites.has(j.site_id) && people.has(j.created_by!)).toBe(true);
    for (const r of db.aiRuns) expect(jobs.has(r.job_id)).toBe(true);
    for (const v of db.aiReviews) expect(runs.has(v.run_id) && people.has(v.reviewed_by!)).toBe(true);
    const ids = [...db.aiJobs, ...db.aiRuns, ...db.aiReviews].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const j of db.aiJobs) expect(Date.parse(j.created_at)).toBeLessThanOrEqual(Date.parse("2026-11-11T12:00:00Z"));
  });
});

describe("audit queue in the demo repository", () => {
  beforeEach(() => resetDemoStore());
  const dc = () => new DemoRepository(DC_SITE.id);
  const plant = () => new DemoRepository(SITE.id);
  const outcome = (over: Partial<RunOutcome> = {}): RunOutcome => ({
    provider: "fake",
    model: "fake-model",
    prompt_version: "v0.2-test",
    output: { ...EMPTY, asset_tag: "CH-01" },
    issues: [],
    raw_output: "{}",
    latency_ms: 900,
    input_tokens: null,
    output_tokens: null,
    error: null,
    ...over,
  });

  it("shows each site its own queue, newest first", async () => {
    const [a, b] = [await dc().listAiQueue(), await plant().listAiQueue()];
    expect([a.length, b.length]).toEqual([6, 5]);
    expect(a.every((i) => i.site_id === DC_SITE.id) && b.every((i) => i.site_id === SITE.id)).toBe(true);
    expect(a.map((i) => i.created_at)).toEqual([...a.map((i) => i.created_at)].sort().reverse());
    expect(await plant().getAiQueueItem(a[0].id)).toBeNull();
    expect(summarizeQueue(a)).toEqual({ needsReview: 3, flagged: 2, waiting: 0, failed: 0, reviewed: 3, acceptedShare: 2 / 3 });
    const corrected = a.find((i) => i.state === "corrected")!;
    expect(corrected.review?.reviewer_name).toBe("Owen Castillo");
    expect(corrected.submitted_by_name).toBe("Owen Castillo");
  });

  it("takes an entry from queued to reviewed", async () => {
    const repo = dc();
    const owen = personId("Owen");
    const jobId = await repo.createAiJob({ task: "worklog.extract", source: "manual", wo_id: null, text: "CH-01 low oil pressure alarm" }, owen);
    expect((await repo.getAiQueueItem(jobId))?.state).toBe("queued");
    await repo.recordAiRun(jobId, outcome());
    const ran = (await repo.getAiQueueItem(jobId))!;
    expect(ran).toMatchObject({ state: "needs_review", status: "done", attempts: 1 });
    expect(ran.run?.model).toBe("fake-model");
    await expect(repo.recordAiRun(jobId, outcome())).rejects.toThrow(/already finished/);

    await repo.reviewAiRun(ran.run!.id, { verdict: "accepted", corrected_output: null, note: null }, owen);
    expect((await repo.getAiQueueItem(jobId))?.state).toBe("accepted");
    // A later review replaces it; nothing is edited.
    await new Promise((r) => setTimeout(r, 5));
    await repo.reviewAiRun(ran.run!.id, { verdict: "corrected", corrected_output: { ...EMPTY, asset_tag: "CH-01", symptom: "low oil pressure alarm" }, note: "Symptom was missed" }, personId("Hana"));
    const again = (await repo.getAiQueueItem(jobId))!;
    expect(again.state).toBe("corrected");
    expect(again.review?.reviewer_name).toBe("Hana Brooks");
  });

  it("keeps a failed run out of review and other sites out of the queue", async () => {
    const repo = dc();
    const owen = personId("Owen");
    const jobId = await repo.createAiJob({ task: "worklog.extract", source: "manual", wo_id: null, text: "an entry the model chokes on" }, owen);
    await repo.recordAiRun(jobId, outcome({ output: null, error: "The model's reply was not JSON.", raw_output: "no" }));
    const failed = (await repo.getAiQueueItem(jobId))!;
    expect(failed).toMatchObject({ state: "failed", error: "The model's reply was not JSON." });
    expect(failed.run?.raw_output).toBe("no");
    await expect(repo.reviewAiRun(failed.run!.id, { verdict: "accepted", corrected_output: null, note: null }, owen)).rejects.toThrow(/finished run/);

    const theirs = (await repo.listAiQueue()).find((i) => i.state === "needs_review")!;
    await expect(plant().reviewAiRun(theirs.run!.id, { verdict: "accepted", corrected_output: null, note: null }, personId("Marcus"))).rejects.toThrow(/not found/);
    await expect(plant().recordAiRun(jobId, outcome())).rejects.toThrow(/not found/);
    await expect(repo.reviewAiRun(theirs.run!.id, { verdict: "corrected", corrected_output: null, note: null }, owen)).rejects.toThrow(/corrected record/);
    // A debrief job must point at a work order at this site.
    const plantWo = (await plant().listWorkOrders())[0];
    await expect(repo.createAiJob({ task: "worklog.extract", source: "wo_debrief", wo_id: plantWo.id, text: "debrief text here" }, owen)).rejects.toThrow(/not found/);
  });
});

describe("the worker", () => {
  const job = { id: "j1", task: "worklog.extract" as const, input: { text: "P-101 seal leaking" } };
  function fakeQueue(jobs: (typeof job | { id: string; task: string; input: { text: string } })[]) {
    const completed: { jobId: string; outcome: RunOutcome }[] = [];
    const queue: JobQueue = {
      claim: async () => (jobs.shift() as typeof job | undefined) ?? null,
      complete: async (jobId, outcome) => void completed.push({ jobId, outcome }),
    };
    return { queue, completed };
  }

  it("waits when the queue is empty", async () => {
    const { queue, completed } = fakeQueue([]);
    expect(await processNextJob(queue, fakeProvider("{}"))).toBe("idle");
    expect(completed).toEqual([]);
  });

  it("runs the job and stores the outcome, good or bad", async () => {
    const { queue, completed } = fakeQueue([job, { ...job, id: "j2" }]);
    expect(await processNextJob(queue, fakeProvider(JSON.stringify({ ...EMPTY, asset_tag: "P-101" })))).toBe("done");
    expect(await processNextJob(queue, fakeProvider("nonsense"))).toBe("failed");
    expect(completed.map((c) => [c.jobId, c.outcome.error])).toEqual([
      ["j1", null],
      ["j2", "The model's reply was not JSON."],
    ]);
    expect((completed[0].outcome.output as WorklogRecord).asset_tag).toBe("P-101");
  });

  it("fails a job for a task it doesn't know instead of dropping it", async () => {
    const { queue, completed } = fakeQueue([{ id: "j3", task: "asset.brief", input: { text: "x" } }]);
    expect(await processNextJob(queue, fakeProvider("{}"))).toBe("failed");
    expect(completed[0].outcome.error).toMatch(/does not know the task "asset.brief"/);
  });
});
