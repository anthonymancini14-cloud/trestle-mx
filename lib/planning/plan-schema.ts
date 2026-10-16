import { z } from "zod";

/**
 * The structured job plan Planning Mode builds with the planner.
 *
 * Claude proposes and revises this through the `update_job_plan` tool; the UI
 * renders it live; committing it writes `wo_tasks` and `wo_parts` rows and
 * moves the work order to Scheduling. The same zod schema validates Claude's
 * tool input and generates the tool's JSON schema, so the two never drift.
 */
export const CRAFTS = ["mechanical", "electrical", "instrumentation", "operations", "contractor"] as const;

export const jobPlanSchema = z.object({
  summary: z.string().describe("One or two sentences: what the job is and the expected outcome."),
  likely_cause: z
    .string()
    .describe("Working hypothesis for the failure, stated as a hypothesis, with the evidence it rests on."),
  requires_shutdown: z.boolean().describe("True if the asset must be out of service for the work."),
  estimated_duration_hours: z.number().describe("Elapsed clock hours from isolation to return to service."),
  permits: z
    .array(z.string())
    .describe("Permits or procedures required, e.g. 'Energy control (LOTO)', 'Hot work', 'Confined space entry'."),
  hazards: z
    .array(z.object({ hazard: z.string(), control: z.string() }))
    .describe("Job-specific hazards and the control for each."),
  isolation_points: z
    .array(
      z.object({
        tag: z.string().describe("Equipment tag or FLOC of the isolation point."),
        energy: z.string().describe("Energy type: electrical, hydraulic, pressure, thermal, gravity, chemical."),
        method: z.string().describe("How it is isolated and verified."),
      }),
    )
    .describe("Proposed isolation points. Always verified against the site's written energy control procedure."),
  tasks: z
    .array(
      z.object({
        seq: z.number().int().describe("Step number in multiples of 10."),
        description: z.string(),
        craft: z.enum(CRAFTS),
        crew_size: z.number().int().min(1),
        est_hours: z.number().describe("Hours per person for this step."),
        safety_note: z.string().nullable().describe("Step-specific safety note, or null."),
        acceptance_criteria: z.string().nullable().describe("Measurable pass criterion, or null."),
      }),
    )
    .describe("Ordered job steps."),
  parts: z
    .array(
      z.object({
        part_number: z
          .string()
          .nullable()
          .describe("Storeroom part number from the catalog if one matches, otherwise null."),
        description: z.string(),
        qty: z.number().min(0),
      }),
    )
    .describe("Materials list. Prefer catalog part numbers."),
  tools: z.array(z.string()).describe("Special tools and equipment beyond a standard craft toolbox."),
  references: z
    .array(z.object({ source: z.string(), note: z.string() }))
    .describe("Standards, site history or context files this plan relies on."),
  open_questions: z
    .array(z.string())
    .describe("Things the planner must confirm in the field before the plan is final."),
});

export type JobPlan = z.infer<typeof jobPlanSchema>;
export type JobPlanTask = JobPlan["tasks"][number];
export type JobPlanPart = JobPlan["parts"][number];

export function planLaborHours(plan: Pick<JobPlan, "tasks">): number {
  return plan.tasks.reduce((sum, t) => sum + t.est_hours * t.crew_size, 0);
}

/** Wire protocol for the Planning Mode stream (newline-delimited JSON). */
export type PlanningStreamEvent =
  | { type: "text"; delta: string }
  | { type: "plan"; plan: JobPlan }
  | { type: "status"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; mode: "live" | "demo"; model: string | null };

export interface PlanningMessage {
  role: "user" | "assistant";
  content: string;
}
