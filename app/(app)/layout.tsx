import Link from "next/link";
import { TrestleMark, Wordmark } from "@/components/brand";
import { NavLinks } from "@/components/shell/nav-links";
import { RoleSwitcher } from "@/components/shell/role-switcher";
import { Badge } from "@/components/ui/primitives";
import { getViewer } from "@/lib/auth/viewer";
import { hasClaude } from "@/lib/config";
import { ROLE_LABELS } from "@/types/domain";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, repo } = await getViewer();
  const [{ site }, planningQueue, profiles] = await Promise.all([
    repo.getSite(),
    repo.listWorkOrders({ stage: "planning", status: "open" }),
    repo.mode === "demo" ? repo.listProfiles() : Promise.resolve([]),
  ]);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line bg-side md:flex">
        <Link href="/dashboard" className="flex flex-col items-center gap-1 border-b border-line px-4 py-4">
          <TrestleMark className="w-28" />
          <Wordmark className="text-xl" />
        </Link>
        <NavLinks planningCount={planningQueue.length} orientation="vertical" />
        <div className="mt-auto border-t border-line px-4 py-3 text-[11px] leading-relaxed text-tx-3">
          <div className="font-mono text-tx-2">{site.code}</div>
          {site.name}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
          <div className="flex h-12 items-center gap-3 px-4">
            <Link href="/dashboard" className="md:hidden">
              <Wordmark className="text-lg" />
            </Link>
            <div className="hidden items-center gap-2 text-xs text-tx-3 md:flex">
              <span className="font-mono text-tx-2">{site.code}</span>
              <span>{site.name}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {repo.mode === "demo" ? (
                <Badge className="hidden border-brass-dim text-brass sm:inline-flex" title="In-memory fictional plant">
                  Demo plant
                </Badge>
              ) : (
                <Badge className="hidden border-good/40 text-good sm:inline-flex">Live</Badge>
              )}
              <Badge
                className={
                  hasClaude()
                    ? "hidden border-good/40 text-good lg:inline-flex"
                    : "hidden border-line-strong text-tx-3 lg:inline-flex"
                }
                title={hasClaude() ? "Planning Mode is using Claude" : "Planning Mode is using the scripted demo planner"}
              >
                {hasClaude() ? "Claude connected" : "Scripted planner"}
              </Badge>
              {repo.mode === "demo" ? (
                <RoleSwitcher current={profile.id} profiles={profiles} />
              ) : (
                <span className="text-xs text-tx-2">
                  {profile.full_name} · {ROLE_LABELS[profile.role]}
                </span>
              )}
            </div>
          </div>
          <div className="border-t border-line md:hidden">
            <NavLinks planningCount={planningQueue.length} orientation="horizontal" />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
