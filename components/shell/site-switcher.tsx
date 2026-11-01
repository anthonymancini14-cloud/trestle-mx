"use client";

import { useTransition } from "react";
import { switchSite } from "@/lib/actions";
import { VERTICAL_LABELS, type Site } from "@/types/domain";

/** Switch between the sites this user can see. Hidden when there is only one. */
export function SiteSwitcher({ current, sites }: { current: Site; sites: Site[] }) {
  const [pending, startTransition] = useTransition();

  if (sites.length < 2) {
    return (
      <div className="flex items-center gap-2 text-xs text-tx-3">
        <span className="font-mono text-tx-2">{current.code}</span>
        <span>{current.name}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="site-switcher" className="sr-only">
        Site
      </label>
      <select
        id="site-switcher"
        value={current.id}
        disabled={pending}
        onChange={(e) => startTransition(() => switchSite(e.target.value))}
        className="h-8 max-w-[13rem] rounded-[3px] border border-line-strong bg-panel px-2 text-xs text-tx focus:border-brass focus:outline-none sm:max-w-none"
      >
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} · {s.name} ({VERTICAL_LABELS[s.vertical]})
          </option>
        ))}
      </select>
    </div>
  );
}
