import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PlanningWorkspace } from "@/components/planning/planning-workspace";
import { getViewer } from "@/lib/auth/viewer";
import { loadStaticContext } from "@/lib/anthropic/context/loader";
import { buildSiteContext } from "@/lib/anthropic/context/site-context";
import { hasClaude, PLANNING_MODEL } from "@/lib/config";
import { demoSuggestions } from "@/lib/planning/demo-planner";
import { canPerform } from "@/lib/workflow";

export const metadata = { title: "Planning Mode" };

export default async function PlanningModePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, repo } = await getViewer();
  const [ctx, staticDocs] = await Promise.all([buildSiteContext(repo, id), loadStaticContext()]);
  if (!ctx) notFound();
  const wo = ctx.workOrder;

  if (!canPerform("plan", profile.role, wo)) {
    return (
      <div className="mx-auto max-w-xl space-y-3 py-10 text-center">
        <p className="text-tx-2">
          Planning Mode opens for planners on work orders in the Planning stage. {wo.wo_number} is in {wo.stage} and you&apos;re
          signed in as a {profile.role}.
        </p>
        <Link href={`/work-orders/${wo.id}`} className="text-brass hover:text-brass-bright">
          Go to the work order
        </Link>
      </div>
    );
  }

  const live = hasClaude();

  return (
    <div className="mx-auto max-w-[1500px] space-y-3">
      <Link href="/planning" className="inline-flex items-center gap-1 text-xs text-tx-3 hover:text-tx-2">
        <ArrowLeft className="size-3" aria-hidden /> Planning queue
      </Link>
      <PlanningWorkspace
        workOrder={{
          id: wo.id,
          number: wo.wo_number,
          title: wo.title,
          description: wo.description,
          priority: wo.priority,
          requiresShutdown: wo.requires_shutdown,
          asset: ctx.asset ? { id: ctx.asset.id, floc: ctx.asset.floc, name: ctx.asset.name, criticality: ctx.asset.criticality } : null,
        }}
        context={{
          layer1: staticDocs.filter((d) => d.layer === "layer1").map((d) => d.title),
          layer2: staticDocs.filter((d) => d.layer === "layer2").map((d) => d.title),
          history: ctx.history.map((h) => ({ number: h.wo_number, title: h.title, floc: h.asset?.floc ?? "" })),
          related: ctx.related.map((r) => r.floc),
          stockItems: ctx.inventory.length,
        }}
        catalog={ctx.inventory.map((i) => ({
          partNumber: i.part.part_number,
          description: i.part.description,
          available: i.on_hand - i.reserved,
          unit: i.part.unit,
          unitCost: i.part.unit_cost,
        }))}
        assistant={{ mode: live ? "live" : "demo", model: live ? PLANNING_MODEL : null }}
        suggestions={live ? LIVE_SUGGESTIONS : demoSuggestions(wo.wo_number, [])}
      />
    </div>
  );
}

const LIVE_SUGGESTIONS = [
  "Check site history for anything that should change this plan.",
  "What could make this job overrun, and how do we plan for it?",
  "What do I need to confirm in the field before I commit?",
];
