"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEMO_SITE_COOKIE, DEMO_USER_COOKIE, SITE_COOKIE, demoProfileFor, getViewer } from "@/lib/auth/viewer";
import { autoExtractOnClose } from "@/lib/ai/config";
import { localProvider } from "@/lib/ai/providers";
import { getTask } from "@/lib/ai/registry";
import { runTask } from "@/lib/ai/run";
import { worklogExtractTask } from "@/lib/ai/tasks/worklog-extract";
import { isLiveMode } from "@/lib/config";
import { evidenceBlocker, resolutionProblems } from "@/lib/troubleshooting";
import { todayAt } from "@/lib/utils";
import { resetDemoStore } from "@/lib/data/demo-repository";
import { ALL_PROFILES, DEMO_SITES } from "@/lib/demo/dataset";
import { jobPlanSchema, type JobPlan } from "@/lib/planning/plan-schema";
import { assertCan, canAi, canReviewRun, canAttachDocument, canDetachDocument, canDoc, canReview, canAddWce, canDefer, canPm, canRecord, canReschedule, canScheduleAt, nextStage, primaryCloseBlocker, WorkflowError, type WoAction } from "@/lib/workflow";
import { AI_VERDICTS, DOC_TYPES, FINDING_RESULTS, OPERATOR_REVIEWS, ROLES, type WorkOrderDetail } from "@/types/domain";
import { fileProblems, revisionProblems } from "@/lib/documents";
import type { NewRevisionInput, UploadTarget } from "@/lib/data/repository";

export type ActionResult = { ok: true } | { ok: false, error: string };

/** Load the work order, check the role/stage rule, run the mutation, refresh the views. */
async function withWorkOrder(
  woId: string,
  action: WoAction,
  run: (ctx: Awaited<ReturnType<typeof getViewer>> & { wo: WorkOrderDetail }) => Promise<void>,
): Promise<ActionResult> {
  try {
    const viewer = await getViewer();
    const wo = await viewer.repo.getWorkOrder(woId);
    if (!wo) return { ok: false, error: "Work order not found." };
    const { site } = await viewer.repo.getSite();
    assertCan(action, viewer.profile.role, wo, { schedulerRoles: site.scheduler_roles });
    await run({ ...viewer, wo });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof WorkflowError) return { ok: false, error: error.message };
    console.error(`Action ${action} failed`, error);
    return { ok: false, error: "Something went wrong saving that change." };
  }
}

export async function submitForVetting(woId: string) {
  return withWorkOrder(woId, "submit_for_vetting", ({ repo, profile }) => repo.moveStage(woId, "vetting", profile.id));
}

export async function authorizeWorkOrder(woId: string) {
  return withWorkOrder(woId, "authorize", ({ repo, profile }) =>
    repo.moveStage(woId, "planning", profile.id, "Authorized for planning"),
  );
}

export async function rejectWorkOrder(woId: string, note: string) {
  const reason = note.trim();
  if (!reason) return { ok: false, error: "Give a reason so the reporter knows why." } satisfies ActionResult;
  return withWorkOrder(woId, "reject", ({ repo, profile }) => repo.rejectWorkOrder(woId, profile.id, reason));
}

export async function commitPlan(woId: string, plan: JobPlan) {
  const parsed = jobPlanSchema.safeParse(plan);
  if (!parsed.success) return { ok: false, error: "The plan is incomplete or invalid." } satisfies ActionResult;
  if (parsed.data.tasks.length === 0) return { ok: false, error: "Add at least one step before committing." } satisfies ActionResult;
  return withWorkOrder(woId, "plan", ({ repo, profile }) => repo.commitPlan(woId, parsed.data, profile.id));
}

export async function scheduleWorkOrder(woId: string, date: string, assigneeId: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !assigneeId) {
    return { ok: false, error: "Pick a date and a technician." } satisfies ActionResult;
  }
  return withWorkOrder(woId, "schedule", async ({ repo, profile }) => {
    const crew = await repo.listCrew();
    if (!crew.some((m) => m.id === assigneeId)) throw new WorkflowError("Assign a technician on this site's roster.");
    await repo.scheduleWorkOrder(woId, date, assigneeId, profile.id);
  });
}

export async function completeTask(woId: string, taskId: string) {
  return withWorkOrder(woId, "complete_task", async ({ repo, profile, wo }) => {
    if (!wo.tasks.some((t) => t.id === taskId)) throw new WorkflowError("That step is not on this work order.");
    await repo.completeTask(taskId, profile.id);
  });
}

export async function issuePart(woId: string, woPartId: string) {
  return withWorkOrder(woId, "issue_part", async ({ repo, profile, wo }) => {
    if (!wo.parts.some((p) => p.id === woPartId)) throw new WorkflowError("That part is not on this work order.");
    await repo.issuePart(woPartId, profile.id);
  });
}

export async function submitCompletion(woId: string) {
  return withWorkOrder(woId, "submit_completion", async ({ repo, profile, wo }) => {
    const open = wo.tasks.filter((t) => !t.is_complete).length;
    if (open > 0) throw new WorkflowError(`${open} step${open === 1 ? "" : "s"} still open. Complete or note them first.`);
    await repo.moveStage(woId, nextStage("execution")!, profile.id, "Work complete, submitted for close-out");
  });
}

const closeSchema = z.object({ hours: z.coerce.number().min(0).max(1000), debrief: z.string().trim().min(10) });

export async function closeWorkOrder(woId: string, hours: number, debrief: string) {
  const parsed = closeSchema.safeParse({ hours, debrief });
  if (!parsed.success) {
    return { ok: false, error: "Enter actual hours and a debrief of at least a sentence: it feeds the next plan." } satisfies ActionResult;
  }
  return withWorkOrder(woId, "close", async ({ repo, profile, wo }) => {
    const blocker = primaryCloseBlocker(wo, await repo.listJcn(wo.jcn)) ?? evidenceBlocker(wo, (await repo.getTroubleshooting(woId)).resolutions);
    if (blocker) throw new WorkflowError(blocker);
    await repo.closeWorkOrder(woId, parsed.data.hours, parsed.data.debrief, profile.id);
    await queueDebriefExtraction({ repo, profile }, woId, parsed.data.debrief);
  });
}

const newWoSchema = z.object({
  title: z.string().trim().min(4, "Give it a short title."),
  description: z.string().trim().min(10, "Describe what you saw."),
  asset_id: z.string().optional(),
  wo_type: z.enum(["corrective", "preventive", "predictive", "emergency", "project"]),
  priority: z.coerce.number().int().min(1).max(4),
  requires_shutdown: z.boolean(),
});

function parseNewWo(form: FormData) {
  return newWoSchema.safeParse({
    title: form.get("title"),
    description: form.get("description"),
    asset_id: form.get("asset_id") || undefined,
    wo_type: form.get("wo_type"),
    priority: form.get("priority"),
    requires_shutdown: form.get("requires_shutdown") === "on",
  });
}

/** Report a discrepancy: a new JCN, written up as WCE -001. */
export async function createWorkOrder(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = parseNewWo(form);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { repo, profile } = await getViewer();
  const id = await repo.createWorkOrder(
    { ...parsed.data, priority: parsed.data.priority as 1 | 2 | 3 | 4, asset_id: parsed.data.asset_id ?? null },
    profile.id,
  );
  revalidatePath("/", "layout");
  redirect(`/work-orders/${id}`);
}

/** Write up another shop's WCE on an open JCN (next -NNN). */
export async function addWce(jcn: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = parseNewWo(form);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { repo, profile } = await getViewer();
  const job = await repo.listJcn(jcn);
  const primary = job.find((w) => w.wce_seq === 1);
  if (!primary) return { ok: false, error: "That JCN isn't at this site." };
  if (!canAddWce(profile.role, primary)) return { ok: false, error: primary.status === "open" ? "Your role can't write up WCEs." : "This JCN is closed. Report a new discrepancy instead." };
  const id = await repo.addWce(jcn, { ...parsed.data, priority: parsed.data.priority as 1 | 2 | 3 | 4, asset_id: parsed.data.asset_id ?? primary.asset_id }, profile.id);
  revalidatePath("/", "layout");
  redirect(`/work-orders/${id}`);
}

/**
 * Close a WCE that can't be finished as deferred. The work is written up under a
 * new JCN and this WCE is signed off "Corrective action deferred, see JCN …".
 */
export async function deferWorkOrder(woId: string, reason: string): Promise<ActionResult & { newId?: string }> {
  const why = reason.trim();
  if (why.length < 10) return { ok: false, error: "Say why the work is deferred and what it doesn't affect (safety, crew, function)." };
  try {
    const { repo, profile } = await getViewer();
    const wo = await repo.getWorkOrder(woId);
    if (!wo) return { ok: false, error: "Work order not found." };
    if (!canDefer(profile.role, wo)) return { ok: false, error: "Deferring needs a supervisor, on an open WCE in Scheduling, Execution or Closure." };
    const blocker = primaryCloseBlocker(wo, await repo.listJcn(wo.jcn));
    if (blocker) return { ok: false, error: blocker };
    const newId = await repo.deferWorkOrder(woId, why, profile.id);
    revalidatePath("/", "layout");
    return { ok: true, newId };
  } catch (error) {
    console.error("Defer WCE failed", error);
    return { ok: false, error: "Something went wrong deferring that WCE." };
  }
}

/** Storeroom, planner or admin: when a part that isn't on site is expected. */
export async function setPartEta(woPartId: string, date: string | null): Promise<ActionResult> {
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Pick a date." };
  try {
    const { repo, profile } = await getViewer();
    if (!["storeroom", "planner", "admin"].includes(profile.role)) return { ok: false, error: "The storeroom or a planner sets expected dates." };
    await repo.setPartEta(woPartId, date, profile.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    console.error("Set part ETA failed", error);
    return { ok: false, error: "Something went wrong saving the date." };
  }
}

// ---------------------------------------------------------------- PM program

export async function generateDuePms(): Promise<ActionResult & { created?: number }> {
  try {
    const { repo, profile } = await getViewer();
    if (!canPm("generate", profile.role)) return { ok: false, error: "Generating PM work orders is for planners and admins." };
    const { site } = await repo.getSite();
    const created = await repo.generateDuePms(todayAt(site.timezone), profile.id);
    revalidatePath("/", "layout");
    return { ok: true, created };
  } catch (error) {
    console.error("Generate PMs failed", error);
    return { ok: false, error: "Something went wrong generating PM work orders." };
  }
}

const deferSchema = z.object({
  scheduleId: z.string().min(1),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a new due date."),
  reason: z.string().trim().min(10, "Give a reason of at least a few words; deferrals are reviewed."),
});

export async function deferPm(input: { scheduleId: string; toDate: string; reason: string }): Promise<ActionResult> {
  const parsed = deferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the deferral." };
  try {
    const { repo, profile } = await getViewer();
    if (!canPm("defer", profile.role)) return { ok: false, error: "Every PM deferral needs a supervisor." };
    await repo.deferPm(parsed.data.scheduleId, parsed.data.toDate, parsed.data.reason, profile.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error && /after the current due date/.test(error.message) ? error.message : "Something went wrong saving the deferral.";
    if (message.startsWith("Something")) console.error("Defer PM failed", error);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------- troubleshooting record

/** Load the work order, check who may add this kind of entry, run it, refresh. */
async function withRecord(woId: string, kind: Parameters<typeof canRecord>[0], run: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<void>): Promise<ActionResult> {
  try {
    const viewer = await getViewer();
    const wo = await viewer.repo.getWorkOrder(woId);
    if (!wo) return { ok: false, error: "Work order not found." };
    if (!canRecord(kind, viewer.profile.role, wo, viewer.profile.id)) {
      const who: Record<typeof kind, string> = {
        operator_action: "Operator actions are recorded by operators (or a supervisor) on open work.",
        finding: "Findings are logged by technicians and supervisors on open work.",
        resolution: "The resolution is recorded by a technician or supervisor once the work is in Execution or Closure.",
        addendum: "Addenda are added to closed work by a supervisor, planner, admin, or the technician who worked it.",
      };
      return { ok: false, error: who[kind] };
    }
    await run(viewer);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof WorkflowError) return { ok: false, error: error.message };
    console.error(`Record ${kind} failed`, error);
    return { ok: false, error: "Something went wrong saving that entry." };
  }
}

const text = (min: number, msg: string) => z.string().trim().min(min, msg);
const optionalText = z.string().trim().max(2000).optional().transform((v) => (v ? v : null));

const operatorActionSchema = z.object({
  conditions: text(3, "What was the equipment doing (running state, alarms, readings)?"),
  action: text(3, "What did you do?"),
  result: text(2, "What happened after?"),
  ranMinutes: z.number().int().min(0).max(100000).nullable(),
  correctsId: z.string().nullable(),
});

export async function addOperatorAction(woId: string, input: z.input<typeof operatorActionSchema>): Promise<ActionResult> {
  const parsed = operatorActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the entry." };
  const v = parsed.data;
  return withRecord(woId, "operator_action", ({ repo, profile }) =>
    repo.addOperatorAction(woId, { conditions: v.conditions, action: v.action, result: v.result, ran_minutes: v.ranMinutes, corrects_id: v.correctsId }, profile.id),
  );
}

const findingSchema = z.object({
  test: text(3, "Name the test, measurement or inspection."),
  value: z.number().finite().nullable(),
  unit: optionalText,
  spec: optionalText,
  result: z.enum(FINDING_RESULTS),
  note: optionalText,
  correctsId: z.string().nullable(),
});

export async function addFinding(woId: string, input: z.input<typeof findingSchema>): Promise<ActionResult> {
  const parsed = findingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the finding." };
  const v = parsed.data;
  return withRecord(woId, "finding", ({ repo, profile }) =>
    repo.addFinding(woId, { test: v.test, value: v.value, unit: v.unit, spec: v.spec, result: v.result, note: v.note, corrects_id: v.correctsId }, profile.id),
  );
}

const resolutionSchema = z.object({
  noFaultFound: z.boolean(),
  failureMode: z.string().nullable(),
  mechanism: z.string().nullable(),
  cause: z.string().nullable(),
  findingIds: z.array(z.string()),
  causeNarrative: z.string(),
  remedy: z.string(),
  verification: z.string().nullable(),
  verificationPassed: z.boolean().nullable(),
  operatorReview: z.enum(OPERATOR_REVIEWS),
  operatorReviewNote: z.string().nullable(),
});

export async function recordResolution(woId: string, input: z.input<typeof resolutionSchema>): Promise<ActionResult> {
  const parsed = resolutionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the resolution." };
  const v = parsed.data;
  const r = {
    no_fault_found: v.noFaultFound,
    failure_mode: v.noFaultFound ? null : v.failureMode || null,
    mechanism: v.noFaultFound ? null : v.mechanism || null,
    cause: v.noFaultFound ? null : v.cause || null,
    finding_ids: v.findingIds,
    cause_narrative: v.causeNarrative.trim(),
    remedy: v.remedy.trim(),
    verification: v.verification?.trim() || null,
    verification_passed: v.verificationPassed,
    operator_review: v.operatorReview,
    operator_review_note: v.operatorReviewNote?.trim() || null,
  };
  const problems = resolutionProblems(r);
  if (problems.length) return { ok: false, error: problems.join(" ") };
  return withRecord(woId, "resolution", ({ repo, profile }) => repo.recordResolution(woId, r, profile.id));
}

export async function addAddendum(woId: string, body: string): Promise<ActionResult> {
  const note = body.trim();
  if (note.length < 5) return { ok: false, error: "Write the addendum." };
  return withRecord(woId, "addendum", ({ repo, profile }) => repo.addAddendum(woId, note, profile.id));
}

// ---------------------------------------------------------------- scheduling calendar

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");

/** Run a calendar mutation for someone who can schedule at this site (TMX-015). */
async function asScheduler(run: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<void>, failure: string): Promise<ActionResult> {
  try {
    const viewer = await getViewer();
    const { site } = await viewer.repo.getSite();
    if (!canScheduleAt(viewer.profile.role, { schedulerRoles: site.scheduler_roles })) {
      return { ok: false, error: "Only a scheduler at this site can change the schedule." };
    }
    await run(viewer);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof WorkflowError) return { ok: false, error: error.message };
    console.error(failure, error);
    return { ok: false, error: failure };
  }
}

/** Drag on the calendar: move a scheduled job to another day. Logged on the work order (TMX-017). */
export async function rescheduleWorkOrder(input: { woId: string; date: string; reason?: string }): Promise<ActionResult> {
  const parsed = z.object({ woId: z.string().min(1), date: isoDate, reason: z.string().trim().max(500).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the move." };
  return asScheduler(async ({ repo, profile }) => {
    const wo = await repo.getWorkOrder(parsed.data.woId);
    const { site } = await repo.getSite();
    if (!wo || !canReschedule(profile.role, wo, { schedulerRoles: site.scheduler_roles })) {
      throw new WorkflowError("Only scheduled work in Execution can be moved. Plan and schedule it first.");
    }
    await repo.rescheduleWorkOrder(wo.id, parsed.data.date, profile.id, parsed.data.reason || undefined);
  }, "Something went wrong moving that job.");
}

const timeOffSchema = z
  .object({
    profileId: z.string().min(1),
    startsOn: isoDate,
    endsOn: isoDate,
    hoursPerDay: z.number().positive().max(16).nullable(),
    reason: z.string().trim().min(3, "Say why (vacation, training, …)."),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: "The end date is before the start date." });

export async function addTimeOff(input: z.input<typeof timeOffSchema>): Promise<ActionResult> {
  const parsed = timeOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the time off." };
  const v = parsed.data;
  return asScheduler(async ({ repo, profile }) => {
    if (!(await repo.listCrew()).some((m) => m.id === v.profileId && m.shift)) throw new WorkflowError("That person isn't on this site's roster.");
    await repo.addTimeOff({ profile_id: v.profileId, starts_on: v.startsOn, ends_on: v.endsOn, hours_per_day: v.hoursPerDay, reason: v.reason }, profile.id);
  }, "Something went wrong saving the time off.");
}

const shiftSchema = z.object({
  profileId: z.string().min(1),
  shiftHours: z.number().positive("Shift hours must be more than zero.").max(16, "A shift can be at most 16 hours."),
  workDays: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one work day."),
});

export async function updateShift(input: z.input<typeof shiftSchema>): Promise<ActionResult> {
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the shift." };
  const v = parsed.data;
  return asScheduler(async ({ repo, profile }) => {
    if (!(await repo.listCrew()).some((m) => m.id === v.profileId)) throw new WorkflowError("That person isn't a technician at this site.");
    await repo.updateShift(v.profileId, v.shiftHours, [...new Set(v.workDays)].sort(), profile.id);
  }, "Something went wrong saving the shift.");
}

/** Admin only: which roles schedule at this site (TMX-015). */
export async function setSchedulerRoles(roles: string[]): Promise<ActionResult> {
  const parsed = z.array(z.enum(ROLES)).safeParse(roles);
  if (!parsed.success) return { ok: false, error: "Unknown role." };
  try {
    const { repo, profile } = await getViewer();
    if (profile.role !== "admin") return { ok: false, error: "Only an admin changes who schedules." };
    await repo.setSchedulerRoles(parsed.data.filter((r) => r !== "admin"), profile.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    console.error("Set scheduler roles failed", error);
    return { ok: false, error: "Something went wrong saving the setting." };
  }
}

// ---------------------------------------------------------------- site switching

const COOKIE_OPTS = { path: "/", sameSite: "lax" as const, maxAge: 60 * 60 * 24 * 30 };

/** Switch the site the app is showing. Live mode: RLS still limits the user to their own sites. */
export async function switchSite(siteId: string) {
  const jar = await cookies();
  if (isLiveMode()) {
    const { repo } = await getViewer();
    if (!(await repo.listSites()).some((s) => s.id === siteId)) return;
    jar.set(SITE_COOKIE, siteId, COOKIE_OPTS);
  } else {
    if (!DEMO_SITES.some((s) => s.id === siteId)) return;
    jar.set(DEMO_SITE_COOKIE, siteId, COOKIE_OPTS);
    // Keep the current person if they work at the new site; otherwise become its planner.
    jar.set(DEMO_USER_COOKIE, demoProfileFor(siteId, jar.get(DEMO_USER_COOKIE)?.value).id, COOKIE_OPTS);
  }
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

// ---------------------------------------------------------------- demo only

export async function switchDemoUser(profileId: string) {
  if (isLiveMode()) return;
  if (!ALL_PROFILES.some((p) => p.id === profileId)) return;
  (await cookies()).set(DEMO_USER_COOKIE, profileId, COOKIE_OPTS);
  revalidatePath("/", "layout");
}

export async function resetDemo() {
  if (isLiveMode()) return;
  resetDemoStore();
  revalidatePath("/", "layout");
}

/** Landing page: enter a demo site as the person who holds a role there. */
export async function enterDemo(formData: FormData) {
  if (isLiveMode()) redirect("/dashboard");
  const siteId = String(formData.get("site") ?? "");
  const role = String(formData.get("role") ?? "planner");
  if (!DEMO_SITES.some((s) => s.id === siteId)) return;
  const jar = await cookies();
  jar.set(DEMO_SITE_COOKIE, siteId, COOKIE_OPTS);
  const person = ALL_PROFILES.find((p) => p.role === role && demoProfileFor(siteId, p.id).id === p.id);
  jar.set(DEMO_USER_COOKIE, (person ?? demoProfileFor(siteId, undefined)).id, COOKIE_OPTS);
  redirect("/dashboard");
}

// ---------------------------------------------------------------- Document control (TMX-026)

/** Run a document change as the viewer, after a role check; refresh the views. */
async function withDocs(
  check: (ctx: Awaited<ReturnType<typeof getViewer>>) => string | null | Promise<string | null>,
  run: (ctx: Awaited<ReturnType<typeof getViewer>>) => Promise<void>,
  failure = "Something went wrong saving that document change.",
): Promise<ActionResult> {
  try {
    const viewer = await getViewer();
    const problem = await check(viewer);
    if (problem) return { ok: false, error: problem };
    await run(viewer);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof WorkflowError) return { ok: false, error: error.message };
    console.error("Document action failed", error);
    return { ok: false, error: failure };
  }
}

const NOT_AUTHOR = "Documents are written by planners, supervisors and admins.";

/**
 * The revision's content from a form: written text, a file sent with the form
 * (demo), or a file the browser already uploaded to storage (live).
 */
async function revisionFromForm(form: FormData, mode: "demo" | "live"): Promise<NewRevisionInput | string> {
  const change_summary = String(form.get("change_summary") ?? "").trim();
  const bodyText = String(form.get("body") ?? "").trim();
  const upload = form.get("file");
  const uploadedPath = String(form.get("file_path") ?? "");
  let input: NewRevisionInput = { change_summary, body: bodyText || null, file: null };
  if (uploadedPath) {
    if (mode !== "live") return "Send the file with the form.";
    const file = { name: String(form.get("file_name") ?? "file"), mime: String(form.get("file_mime") ?? ""), size: Number(form.get("file_size") ?? 0), path: uploadedPath };
    const problems = fileProblems({ name: file.name, type: file.mime, size: file.size }, mode);
    if (problems.length) return problems.join(" ");
    input = { ...input, file };
  } else if (upload instanceof File && upload.size > 0) {
    if (mode === "live") return "Upload the file to storage first.";
    const problems = fileProblems(upload, mode);
    if (problems.length) return problems.join(" ");
    input = {
      ...input,
      file: { name: upload.name, mime: upload.type, size: upload.size, path: "" },
      file_data: Buffer.from(await upload.arrayBuffer()).toString("base64"),
    };
  }
  const problems = revisionProblems({ change_summary, body: input.body, hasFile: !!input.file });
  return problems.length ? problems.join(" ") : input;
}

/** Live: a signed URL the browser uploads a revision's file to before submitting the form. */
export async function prepareDocumentUpload(file: { name: string; type: string; size: number }): Promise<ActionResult & { target?: UploadTarget }> {
  try {
    const { repo, profile } = await getViewer();
    if (!canDoc("author", profile.role)) return { ok: false, error: NOT_AUTHOR };
    if (repo.mode !== "live") return { ok: false, error: "The demo takes the file with the form." };
    const problems = fileProblems(file, "live");
    if (problems.length) return { ok: false, error: problems.join(" ") };
    return { ok: true, target: await repo.createUploadTarget(file.name) };
  } catch (error) {
    console.error("Upload target failed", error);
    return { ok: false, error: "Couldn't start the upload." };
  }
}

const docTypeSchema = z.enum(DOC_TYPES);

export async function createDocument(_prev: ActionResult | null, form: FormData): Promise<ActionResult & { id?: string }> {
  let id: string | undefined;
  const result = await withDocs(
    ({ profile }) => (canDoc("author", profile.role) ? null : NOT_AUTHOR),
    async ({ repo, profile }) => {
      const title = String(form.get("title") ?? "").trim();
      const type = docTypeSchema.safeParse(form.get("doc_type"));
      if (title.length < 3) throw new WorkflowError("Give the document a title.");
      if (!type.success) throw new WorkflowError("Pick the document type.");
      const revision = await revisionFromForm(form, repo.mode);
      if (typeof revision === "string") throw new WorkflowError(revision);
      const assets = await repo.listAssets();
      const assetIds = form.getAll("asset_ids").map(String).filter((a) => assets.some((x) => x.id === a));
      id = await repo.createDocument({ title, doc_type: type.data, asset_ids: assetIds, revision }, profile.id);
    },
  );
  return { ...result, id };
}

export async function addDocumentRevision(documentId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  return withDocs(
    async ({ repo, profile }) => {
      if (!canDoc("author", profile.role)) return NOT_AUTHOR;
      const doc = await repo.getDocument(documentId);
      if (!doc) return "Document not found.";
      if (doc.status !== "active") return "An obsolete document takes no new revisions.";
      if (doc.pending) return `Rev ${doc.pending.rev} is still waiting for review. Approve or reject it first.`;
      return null;
    },
    async ({ repo, profile }) => {
      const revision = await revisionFromForm(form, repo.mode);
      if (typeof revision === "string") throw new WorkflowError(revision);
      await repo.addRevision(documentId, revision, profile.id);
    },
  );
}

export async function reviewDocumentRevision(input: { documentId: string; revisionId: string; approve: boolean; note: string }): Promise<ActionResult> {
  const note = input.note.trim();
  if (!input.approve && note.length < 5) return { ok: false, error: "Say why it's rejected, so the author can fix it." };
  return withDocs(
    async ({ repo, profile }) => {
      const doc = await repo.getDocument(input.documentId);
      const rev = doc?.revisions.find((r) => r.id === input.revisionId);
      if (!doc || !rev) return "Revision not found.";
      if (rev.prepared_by === profile.id) return "A revision is approved by someone other than the person who wrote it.";
      return canReview(profile.role, profile.id, rev, doc) ? null : "Revisions are approved by supervisors and admins.";
    },
    ({ repo, profile }) => repo.reviewRevision(input.revisionId, input.approve, note || null, profile.id),
  );
}

export async function obsoleteDocument(input: { documentId: string; reason: string; replacedById: string | null }): Promise<ActionResult> {
  const reason = input.reason.trim();
  if (reason.length < 5) return { ok: false, error: "Say why it's obsolete." };
  return withDocs(
    async ({ repo, profile }) => {
      if (!canDoc("obsolete", profile.role)) return "Documents are made obsolete by supervisors and admins.";
      const doc = await repo.getDocument(input.documentId);
      if (!doc) return "Document not found.";
      if (doc.status !== "active") return "Already obsolete.";
      if (input.replacedById) {
        if (input.replacedById === input.documentId) return "A document can't replace itself.";
        const by = await repo.getDocument(input.replacedById);
        if (!by || by.status !== "active") return "The replacement must be an active document at this site.";
      }
      return null;
    },
    ({ repo, profile }) => repo.obsoleteDocument(input.documentId, reason, input.replacedById, profile.id),
  );
}

export async function setDocumentAssets(documentId: string, assetIds: string[]): Promise<ActionResult> {
  return withDocs(
    async ({ repo, profile }) => (!canDoc("author", profile.role) ? NOT_AUTHOR : (await repo.getDocument(documentId)) ? null : "Document not found."),
    ({ repo, profile }) => repo.setDocumentAssets(documentId, assetIds, profile.id),
  );
}

export async function attachDocument(woId: string, documentId: string): Promise<ActionResult> {
  return withDocs(
    async ({ repo, profile }) => {
      const wo = await repo.getWorkOrder(woId);
      if (!wo) return "Work order not found.";
      if (!canAttachDocument(profile.role, wo)) return wo.status === "open" ? "Planners, supervisors and technicians add documents." : "Closed work orders keep the documents they used.";
      const doc = await repo.getDocument(documentId);
      if (!doc || doc.status !== "active") return "Pick an active document.";
      return null;
    },
    ({ repo, profile }) => repo.attachDocument(woId, documentId, profile.id),
  );
}

export async function detachDocument(woId: string, documentId: string): Promise<ActionResult> {
  return withDocs(
    async ({ repo, profile }) => {
      const wo = await repo.getWorkOrder(woId);
      if (!wo) return "Work order not found.";
      const row = (await repo.listWoDocuments(woId)).find((r) => r.document_id === documentId);
      if (!row) return null;
      if (row.views.length > 0) return "Someone opened this document from the work order, so it stays with the record.";
      return canDetachDocument(profile.role, wo, row.views.length) ? null : "Planners and supervisors take documents off open work orders.";
    },
    ({ repo, profile }) => repo.detachDocument(woId, documentId, profile.id),
  );
}

// ---------------------------------------------------------------- AI audit queue

type Viewer = Awaited<ReturnType<typeof getViewer>>;

const NO_LOCAL_MODEL =
  "The demo shows scripted runs. To extract a new entry, start the app with a local model (LOCAL_AI_BASE_URL and LOCAL_AI_MODEL).";

/**
 * Run a queued job right here. Demo only: the demo store lives in this
 * server's memory, and the model is on the same machine. In live mode the
 * worker next to the model does this instead (scripts/ai-worker.ts).
 */
async function runDemoJob(repo: Viewer["repo"], jobId: string, text: string) {
  const provider = localProvider();
  if (!provider) return;
  await repo.recordAiRun(jobId, await runTask(worklogExtractTask, { text }, provider));
}

/**
 * With AI_AUTO_EXTRACT=on, a close-out debrief goes to the audit queue for
 * extraction. It never holds up or fails the close-out: the job is queued
 * after the work order has closed, and the model runs after the response.
 */
async function queueDebriefExtraction(viewer: Viewer, woId: string, debrief: string) {
  if (!autoExtractOnClose()) return;
  try {
    if (viewer.repo.mode === "demo" && !localProvider()) return;
    const jobId = await viewer.repo.createAiJob({ task: "worklog.extract", source: "wo_debrief", wo_id: woId, text: debrief }, viewer.profile.id);
    if (viewer.repo.mode === "demo") {
      after(() => runDemoJob(viewer.repo, jobId, debrief).catch((error) => console.error("Debrief extraction failed", error)));
    }
  } catch (error) {
    console.error("Queueing the debrief for extraction failed", error);
  }
}

const workLogSchema = z.string().trim().min(10, "Enter the log entry: at least a few words.").max(4000, "Keep one entry under 4,000 characters.");

/** Put one log entry in the audit queue for extraction. Demo: runs the local model now. Live: the worker picks it up. */
export async function submitWorkLog(text: string): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  const parsed = workLogSchema.safeParse(text);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  try {
    const viewer = await getViewer();
    if (!canAi("submit", viewer.profile.role)) return { ok: false, error: "Planners, supervisors and admins add entries to the audit queue." };
    if (viewer.repo.mode === "demo" && !localProvider()) return { ok: false, error: NO_LOCAL_MODEL };
    const jobId = await viewer.repo.createAiJob({ task: "worklog.extract", source: "manual", wo_id: null, text: parsed.data }, viewer.profile.id);
    if (viewer.repo.mode === "demo") await runDemoJob(viewer.repo, jobId, parsed.data);
    revalidatePath("/audit", "layout");
    return { ok: true, jobId };
  } catch (error) {
    console.error("Submitting a work log failed", error);
    return { ok: false, error: "Something went wrong adding that entry." };
  }
}

const reviewSchema = z.object({
  jobId: z.string().min(1),
  verdict: z.enum(AI_VERDICTS),
  corrected: z.unknown().optional(),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Accept, correct or reject a run. A correction is checked against the task's
 * schema; one that changes nothing is stored as an acceptance, so "corrected"
 * always means the reviewer changed something.
 */
export async function reviewAiRun(input: z.input<typeof reviewSchema>): Promise<ActionResult> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That review is incomplete." };
  const note = parsed.data.note || null;
  try {
    const { repo, profile } = await getViewer();
    const item = await repo.getAiQueueItem(parsed.data.jobId);
    if (!item || !item.run) return { ok: false, error: "That run was not found." };
    if (!canReviewRun(profile.role, item)) return { ok: false, error: "Planners, supervisors and admins review finished runs." };
    if (parsed.data.verdict === "rejected" && (note ?? "").length < 3) return { ok: false, error: "Say why it's rejected, so the pattern can be fixed." };

    let verdict = parsed.data.verdict;
    let corrected: unknown | null = null;
    if (verdict === "corrected") {
      const schema = getTask(item.task)?.outputSchema;
      const fixed = schema?.safeParse(parsed.data.corrected);
      if (!fixed?.success) return { ok: false, error: "The corrected record is incomplete or invalid." };
      const original = schema!.safeParse(item.run.output);
      if (original.success && JSON.stringify(original.data) === JSON.stringify(fixed.data)) verdict = "accepted";
      else corrected = fixed.data;
    }
    await repo.reviewAiRun(item.run.id, { verdict, corrected_output: corrected, note }, profile.id);
    revalidatePath("/audit", "layout");
    return { ok: true };
  } catch (error) {
    console.error("Reviewing an AI run failed", error);
    return { ok: false, error: "Something went wrong saving that review." };
  }
}
