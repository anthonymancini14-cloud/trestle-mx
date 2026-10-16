"use client";

import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { resetDemo, switchDemoUser } from "@/lib/actions";
import { ROLE_LABELS, type Profile } from "@/types/domain";

/** Demo only: act as any person at the plant to see each role's view. */
export function RoleSwitcher({ current, profiles }: { current: string; profiles: Profile[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="role-switcher" className="sr-only">
        Act as
      </label>
      <select
        id="role-switcher"
        value={current}
        disabled={pending}
        onChange={(e) => startTransition(() => switchDemoUser(e.target.value))}
        className="h-8 max-w-[11rem] rounded-[3px] border border-line-strong bg-panel px-2 text-xs text-tx focus:border-brass focus:outline-none sm:max-w-none"
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {ROLE_LABELS[p.role]} · {p.full_name}
            {p.craft ? ` (${p.craft})` : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        title="Reset the demo plant to its starting state"
        disabled={pending}
        onClick={() => startTransition(() => resetDemo())}
        className="flex h-8 w-8 items-center justify-center rounded-[3px] border border-line-strong text-tx-3 hover:text-tx disabled:opacity-50"
      >
        <RotateCcw className="size-3.5" aria-hidden />
        <span className="sr-only">Reset demo</span>
      </button>
    </div>
  );
}
