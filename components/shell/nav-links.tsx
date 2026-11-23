"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { DASHBOARD_LINK, NAV_GROUPS, activeGroupId, isActiveHref, type NavGroup, type NavLink } from "@/lib/nav";
import { cn } from "@/lib/utils";

type GroupId = NavGroup["id"];

/**
 * Grouped app navigation. The sidebar (vertical) shows CMMS, EAM and
 * Project management, plus AI audit, as collapsible groups; the group holding the current
 * page starts open. The phone bar (horizontal) shows the groups as tabs,
 * with the chosen group's pages in a second row.
 */
export function NavLinks({
  planningCount,
  orientation,
}: {
  planningCount: number;
  orientation: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const area = useSearchParams().get("area");
  const currentGroup = activeGroupId(pathname, area);

  // Groups the person opened or closed by hand. A group not listed here is
  // open when it holds the current page.
  const [toggled, setToggled] = useState<Partial<Record<GroupId, boolean>>>({});
  const location = area ? `${pathname}?area=${area}` : pathname;
  const [lastLocation, setLastLocation] = useState(location);
  if (lastLocation !== location) {
    // Navigating into a group always opens it, even if it was closed by hand.
    setLastLocation(location);
    if (currentGroup && toggled[currentGroup] === false) {
      setToggled((prev) => {
        const next = { ...prev };
        delete next[currentGroup];
        return next;
      });
    }
  }

  const isOpen = (id: GroupId) => toggled[id] ?? id === currentGroup;

  if (orientation === "horizontal") {
    return (
      <HorizontalNav
        pathname={pathname}
        area={area}
        currentGroup={currentGroup}
        planningCount={planningCount}
        isOpen={isOpen}
        onSelect={(id) => {
          // On a phone only one group's row shows at a time.
          const opening = !isOpen(id);
          setToggled(Object.fromEntries(NAV_GROUPS.map((g) => [g.id, g.id === id && opening])));
        }}
      />
    );
  }

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-2">
      <NavItem link={DASHBOARD_LINK} pathname={pathname} area={area} planningCount={planningCount} />
      {NAV_GROUPS.map((group) => {
        const open = isOpen(group.id);
        const panelId = `nav-group-${group.id}`;
        const showQueueOnHeader = !open && planningCount > 0 && group.links.some((l) => l.showPlanningCount);
        return (
          <div key={group.id} className="mt-1.5">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setToggled((prev) => ({ ...prev, [group.id]: !open }))}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-[3px] px-3 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-panel",
                group.id === currentGroup ? "text-brass" : "text-tx-3 hover:text-tx-2",
              )}
            >
              <group.icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{group.label}</span>
              <span className="ml-auto flex items-center gap-1.5">
                {showQueueOnHeader && <PlanningCount count={planningCount} />}
                <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden />
              </span>
            </button>
            <div id={panelId} hidden={!open} className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-line pl-1.5">
              {group.links.map((link) => (
                <NavItem key={link.label} link={link} pathname={pathname} area={area} planningCount={planningCount} />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function HorizontalNav({
  pathname,
  area,
  currentGroup,
  planningCount,
  isOpen,
  onSelect,
}: {
  pathname: string;
  area: string | null;
  currentGroup: GroupId | null;
  planningCount: number;
  isOpen: (id: GroupId) => boolean;
  onSelect: (id: GroupId) => void;
}) {
  const openGroup = NAV_GROUPS.find((g) => isOpen(g.id));
  return (
    <nav aria-label="Main">
      <div className="flex gap-1 overflow-x-auto px-2 py-1.5">
        <NavItem link={DASHBOARD_LINK} pathname={pathname} area={area} planningCount={planningCount} compact />
        {NAV_GROUPS.map((group) => {
          const open = openGroup?.id === group.id;
          return (
            <button
              key={group.id}
              type="button"
              aria-expanded={open}
              aria-controls="nav-group-row"
              onClick={() => onSelect(group.id)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-[3px] px-3 text-sm transition-colors",
                open ? "bg-panel-2 text-tx" : "text-tx-2 hover:bg-panel hover:text-tx",
              )}
            >
              <group.icon className={cn("size-4", group.id === currentGroup ? "text-brass" : "text-tx-3")} aria-hidden />
              {group.shortLabel ?? group.label}
              <ChevronDown className={cn("size-3.5 text-tx-3 transition-transform", open && "rotate-180")} aria-hidden />
            </button>
          );
        })}
      </div>
      {openGroup && (
        <div id="nav-group-row" className="flex gap-1 overflow-x-auto border-t border-line px-2 py-1.5">
          {openGroup.links.map((link) => (
            <NavItem key={link.label} link={link} pathname={pathname} area={area} planningCount={planningCount} compact />
          ))}
        </div>
      )}
    </nav>
  );
}

function NavItem({
  link,
  pathname,
  area,
  planningCount,
  compact = false,
}: {
  link: NavLink;
  pathname: string;
  area: string | null;
  planningCount: number;
  compact?: boolean;
}) {
  const { href, label, icon: Icon } = link;
  const base = cn("flex shrink-0 items-center gap-2.5 rounded-[3px] px-3 text-sm", compact ? "h-8" : "h-9");

  if (!href) {
    return (
      <span aria-disabled="true" title="Designed, not built yet" className={cn(base, "cursor-default text-tx-3")}>
        <Icon className="size-4 text-tx-3" aria-hidden />
        {label}
        <Badge className="ml-auto border-line-strong text-[10px] text-tx-3">Designed</Badge>
      </span>
    );
  }

  const active = isActiveHref(href, pathname, area);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        base,
        "transition-colors",
        active ? "bg-panel-2 text-tx shadow-[inset_2px_0_0_var(--brass)]" : "text-tx-2 hover:bg-panel hover:text-tx",
      )}
    >
      <Icon className={cn("size-4", active ? "text-brass" : "text-tx-3")} aria-hidden />
      {label}
      {link.showPlanningCount && planningCount > 0 && <PlanningCount count={planningCount} className="ml-auto" />}
    </Link>
  );
}

function PlanningCount({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn("rounded-[2px] bg-brass/20 px-1.5 font-mono text-[11px] text-brass-bright", className)}
      title={`${count} work orders waiting in planning`}
    >
      {count}
    </span>
  );
}
