import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Factory,
  FileText,
  FolderKanban,
  Gauge,
  HardHat,
  LayoutDashboard,
  Library,
  PlusSquare,
  ScanSearch,
  Sparkles,
  Wrench,
} from "lucide-react";

/**
 * App navigation, grouped by the three sides of Trestle.MX (TMX-030):
 * the CMMS that runs the work, the EAM side for asset decisions, and
 * project management for outages and capital work.
 *
 * A link with no `href` is a page that is designed but not built. It is
 * shown, disabled and labeled "Designed", so the menu never claims more
 * than the repo has.
 */
export type NavLink = {
  label: string;
  icon: LucideIcon;
  /** Omitted for designed pages that are not built yet. */
  href?: string;
  /** Shows the open planning queue count beside the link. */
  showPlanningCount?: boolean;
};

export type NavGroup = {
  id: "cmms" | "eam" | "projects";
  label: string;
  /** Shorter label for the phone tab bar. */
  shortLabel?: string;
  icon: LucideIcon;
  links: NavLink[];
};

export const DASHBOARD_LINK = {
  href: "/dashboard",
  label: "Dashboard",
  icon: LayoutDashboard,
} as const satisfies NavLink;

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "cmms",
    label: "CMMS",
    icon: Wrench,
    links: [
      { href: "/planning", label: "Planning", icon: Sparkles, showPlanningCount: true },
      { href: "/work-orders", label: "Work orders", icon: ClipboardList },
      { href: "/work-orders/new", label: "Report", icon: PlusSquare },
      { href: "/schedule", label: "Schedule", icon: CalendarDays },
      { href: "/pm", label: "PM program", icon: CalendarCheck },
      { href: "/audit", label: "AI audit", icon: ScanSearch },
    ],
  },
  {
    id: "eam",
    label: "EAM",
    icon: Gauge,
    links: [
      { href: "/assets", label: "Assets", icon: Factory },
      { href: "/asset-classes", label: "Class library", icon: Library },
      { href: "/documents", label: "Documents", icon: FileText },
      { href: "/inventory", label: "Storeroom", icon: Boxes },
    ],
  },
  {
    id: "projects",
    label: "Project management",
    shortLabel: "Projects",
    icon: FolderKanban,
    links: [
      { label: "Projects", icon: FolderKanban },
      { label: "Outages", icon: HardHat },
    ],
  },
];

/** True when `href` is the page being viewed (or a page under it). */
export function isActiveHref(href: string, pathname: string): boolean {
  // "/work-orders/new" is the Report link, so it must not also light up Work orders.
  if (href === "/work-orders") {
    return pathname === href || (pathname.startsWith("/work-orders/") && !pathname.endsWith("/new"));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The group holding the page being viewed, or null (the dashboard, for one). */
export function activeGroupId(pathname: string): NavGroup["id"] | null {
  const group = NAV_GROUPS.find((g) => g.links.some((l) => l.href && isActiveHref(l.href, pathname)));
  return group?.id ?? null;
}
