"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEMO_SITE_COOKIE, DEMO_USER_COOKIE, SITE_COOKIE, demoProfileFor, getViewer } from "@/lib/auth/viewer";
import { isLiveMode } from "@/lib/config";
import { todayAt } from "@/lib/utils";
import { resetDemoStore } from "@/lib/data/demo-repository";
import { ALL_PROFILES, DEMO_SITES } from "@/lib/demo/dataset";
import { jobPlanSchema, type JobPlan } from "@/lib/planning/plan-schema";
import { assertCan, canPm, canReschedule, canScheduleAt, nextStage, WorkflowError, type WoAction } from "@/lib/workflow";
import { ROLES, type WorkOrderDetail } from "@/types/domain";

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
  return withWorkOrder(woId, "close", ({ repo, profile }) =>
    repo.closeWorkOrder(woId, parsed.data.hours, parsed.data.debrief, profile.id),
  );
}

const newWoSchema = z.object({
  title: z.string().trim().min(4, "Give it a short title."),
  description: z.string().trim().min(10, "Describe what you saw."),
  asset_id: z.string().optional(),
  wo_type: z.enum(["corrective", "preventive", "predictive", "emergency", "project"]),
  priority: z.coerce.number().int().min(1).max(4),
  requires_shutdown: z.boolean(),
});

export async function createWorkOrder(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const parsed = newWoSchema.safeParse({
    title: form.get("title"),
    description: form.get("description"),
    asset_id: form.get("asset_id") || undefined,
    wo_type: form.get("wo_type"),
    priority: form.get("priority"),
    requires_shutdown: form.get("requires_shutdown") === "on",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const { repo, profile } = await getViewer();
  const id = await repo.createWorkOrder(
    { ...parsed.data, priority: parsed.data.priority as 1 | 2 | 3 | 4, asset_id: parsed.data.asset_id ?? null },
    profile.id,
  );
  revalidatePath("/", "layout");
  redirect(`/work-orders/${id}`);
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
