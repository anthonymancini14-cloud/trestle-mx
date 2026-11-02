import { redirect } from "next/navigation";
import { ArrowRight, ClipboardList, HardHat, ShieldCheck, Wrench, Package, CalendarClock, Server, Factory } from "lucide-react";
import { TrestleMark, Wordmark } from "@/components/brand";
import { isLiveMode } from "@/lib/config";
import { enterDemo } from "@/lib/actions";
import { DEFAULT_DEMO_SITE_ID, DEMO_SITES } from "@/lib/demo/dataset";
import { ROLE_LABELS, STAGE_LABELS, VERTICAL_LABELS, WO_STAGES, type Role } from "@/types/domain";

const SITE_BLURBS: Record<string, string> = {
  data_center: "2N power, chilled water and liquid cooling, and a recorded cable plant: every cable routed through labeled tray sections.",
  industrial_utility: "Water treatment, pumping, steam and compressed air, with a work history Planning Mode learns from.",
};

const ENTRY_ROLES: { role: Role; icon: typeof Wrench; blurb: string; featured?: boolean }[] = [
  { role: "planner", icon: ClipboardList, blurb: "Open the Planning queue and build a job plan with Claude.", featured: true },
  { role: "gatekeeper", icon: ShieldCheck, blurb: "Vet new discrepancies: authorize or reject." },
  { role: "supervisor", icon: CalendarClock, blurb: "Schedule planned work and close it out with a debrief." },
  { role: "technician", icon: HardHat, blurb: "Work today's jobs step by step from a tablet." },
  { role: "storeroom", icon: Package, blurb: "Watch reservations, kits and stock levels." },
];

export default function Home() {
  if (isLiveMode()) redirect("/dashboard");

  return (
    <main className="blueprint min-h-dvh">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="flex flex-col items-center text-center">
          <TrestleMark className="w-56 sm:w-72" />
          <Wordmark className="mt-4 text-4xl sm:text-5xl" />
          <p className="mt-3 font-display text-lg uppercase tracking-[0.2em] text-brass-dim">
            Maintenance management for data centers, utilities and industrial plants
          </p>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-tx-2">
            A work order system built around one idea: the planner&apos;s job plan is where reliability is won or lost.{" "}
            <strong className="text-tx">Planning Mode</strong> pairs the planner with Claude, grounded in safety standards,
            the site&apos;s own work history and what is actually on the storeroom shelf.
          </p>
        </div>

        <ol className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-1.5 text-xs">
          {WO_STAGES.map((stage, i) => (
            <li key={stage} className="flex items-center gap-1.5">
              <span
                className={
                  stage === "planning"
                    ? "rounded-[2px] border border-brass bg-brass/15 px-2 py-1 font-semibold text-brass-bright"
                    : "rounded-[2px] border border-line-strong bg-panel px-2 py-1 text-tx-2"
                }
              >
                {i + 1}. {STAGE_LABELS[stage]}
              </span>
              {i < WO_STAGES.length - 1 && <ArrowRight className="size-3 text-tx-3" aria-hidden />}
            </li>
          ))}
        </ol>

        <form action={enterDemo} className="mt-12">
          <fieldset>
            <legend className="mx-auto text-center font-display text-sm font-semibold uppercase tracking-[0.2em] text-tx-3">
              1. Pick a demo site
            </legend>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {DEMO_SITES.map((site) => {
                const Icon = site.vertical === "data_center" ? Server : Factory;
                return (
                  <label
                    key={site.id}
                    className="flex cursor-pointer gap-3 rounded-[3px] border border-line bg-panel p-4 hover:border-brass-dim has-[:checked]:border-brass has-[:checked]:bg-brass/10"
                  >
                    <input type="radio" name="site" value={site.id} defaultChecked={site.id === DEFAULT_DEMO_SITE_ID} className="mt-1 size-4 accent-[var(--brass)]" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 text-brass" aria-hidden />
                        <span className="font-display text-lg font-semibold uppercase tracking-wide">{site.name}</span>
                      </div>
                      <div className="text-xs text-tx-3">
                        <span className="font-mono">{site.code}</span> · {VERTICAL_LABELS[site.vertical]}
                      </div>
                      <p className="mt-1 text-sm text-tx-2">{SITE_BLURBS[site.vertical]}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <h2 className="mt-10 text-center font-display text-sm font-semibold uppercase tracking-[0.2em] text-tx-3">2. Enter as</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ENTRY_ROLES.map(({ role, icon: Icon, blurb, featured }) => (
              <button
                key={role}
                type="submit"
                name="role"
                value={role}
                className={
                  "group flex h-full w-full flex-col items-start gap-2 rounded-[3px] border p-4 text-left transition-colors " +
                  (featured
                    ? "border-brass bg-brass/10 hover:bg-brass/15 sm:col-span-2 lg:col-span-1 lg:row-span-2"
                    : "border-line bg-panel hover:border-brass-dim hover:bg-panel-2")
                }
              >
                <div className="flex w-full items-center justify-between">
                  <Icon className={featured ? "size-6 text-brass" : "size-5 text-tx-2"} aria-hidden />
                  {featured && <span className="text-[10px] font-semibold uppercase tracking-widest text-brass">Start here</span>}
                </div>
                <div className="font-display text-xl font-semibold uppercase tracking-wide">{ROLE_LABELS[role]}</div>
                <p className="text-sm text-tx-2">{blurb}</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-2 text-xs font-medium text-brass group-hover:text-brass-bright">
                  Enter <ArrowRight className="size-3" aria-hidden />
                </span>
              </button>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-tx-3">
            Cedar Flats Data Center and Basalt Ridge Plant are fictional. All people, equipment and records are
            invented. You can switch sites and roles at any time from the top bar.
          </p>
        </form>
      </div>
    </main>
  );
}
