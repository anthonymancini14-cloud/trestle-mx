"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEMO_SITE_COOKIE, DEMO_USER_COOKIE, SITE_COOKIE, demoProfileFor, getViewer } from "@/lib/auth/viewer";
import { isLiveMode } from "@/lib/config";
import { resetDemoStore } from "@/lib/data/demo-repository";
import { ALL_PROFILES, DEMO_SITES } from "@/lib/demo/dataset";
import { jobPlanSchema, type JobPlan } from "@/lib/planning/plan-schema";
import { assertCan, canPm, nextStage, WorkflowError, type WoAction } from "@/lib/workflow";
import type { WorkOrderDetail } from "@/types/domain";

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
    assertCan(action, viewer.profile.role, wo);
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
  return withWorkOrder(woId, "schedule", ({ repo, profile }) => repo.scheduleWorkOrder(woId, date, assigneeId, profile.id));
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

const today = () => new Date().toISOString().slice(0, 10);

export async function generateDuePms(): Promise<ActionResult & { created?: number }> {
  try {
    const { repo, profile } = await getViewer();
    if (!canPm("generate", profile.role)) return { ok: false, error: "Generating PM work orders is for planners and admins." };
    const created = await repo.generateDuePms(today(), profile.id);
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
