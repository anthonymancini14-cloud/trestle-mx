"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, ClipboardList, Factory, LayoutDashboard, PlusSquare, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/planning", label: "Planning", icon: Sparkles },
  { href: "/work-orders", label: "Work orders", icon: ClipboardList },
  { href: "/assets", label: "Assets", icon: Factory },
  { href: "/inventory", label: "Storeroom", icon: Boxes },
  { href: "/work-orders/new", label: "Report", icon: PlusSquare },
] as const;

export function NavLinks({
  planningCount,
  orientation,
}: {
  planningCount: number;
  orientation: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/work-orders"
      ? pathname === href || (pathname.startsWith("/work-orders/") && !pathname.endsWith("/new"))
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      className={cn(
        orientation === "vertical" ? "flex flex-col gap-0.5 p-2" : "flex gap-1 overflow-x-auto px-2 py-1.5",
      )}
    >
      {LINKS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex shrink-0 items-center gap-2.5 rounded-[3px] px-3 text-sm transition-colors",
            orientation === "vertical" ? "h-9" : "h-8",
            isActive(href)
              ? "bg-panel-2 text-tx shadow-[inset_2px_0_0_var(--brass)]"
              : "text-tx-2 hover:bg-panel hover:text-tx",
          )}
        >
          <Icon className={cn("size-4", isActive(href) ? "text-brass" : "text-tx-3")} aria-hidden />
          {label}
          {href === "/planning" && planningCount > 0 && (
            <span className="ml-auto rounded-[2px] bg-brass/20 px-1.5 font-mono text-[11px] text-brass-bright">
              {planningCount}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
