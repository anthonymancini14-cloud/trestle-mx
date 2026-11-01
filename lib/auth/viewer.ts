import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLiveMode } from "@/lib/config";
import { DemoRepository } from "@/lib/data/demo-repository";
import type { Repository } from "@/lib/data/repository";
import { SupabaseRepository } from "@/lib/data/supabase-repository";
import { ALL_PROFILES, DEFAULT_DEMO_SITE_ID, DEMO_SITES, SITE_ACCESS } from "@/lib/demo/dataset";
import { createServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/domain";

export const DEMO_USER_COOKIE = "tmx_demo_user";
export const DEMO_SITE_COOKIE = "tmx_demo_site";
/** Live mode: the site the user last switched to. */
export const SITE_COOKIE = "tmx_site";

/** Demo: whoever was picked, if they work at this site; otherwise the site's first person (its planner). */
export function demoProfileFor(siteId: string, chosenId: string | undefined): Profile {
  const atSite = new Set(SITE_ACCESS.filter((a) => a.site_id === siteId).map((a) => a.user_id));
  const here = ALL_PROFILES.filter((p) => atSite.has(p.id));
  return here.find((p) => p.id === chosenId) ?? here.find((p) => p.role === "planner") ?? here[0];
}

export interface Viewer {
  profile: Profile;
  repo: Repository;
}

/**
 * The current user and the data layer scoped to them. Cached per request.
 * Demo mode: the site and person picked in the top bar (cookies).
 * Live mode: the Supabase session, their profile, and the site they switched
 * to (or their first site). RLS limits them to sites in site_access either way.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const jar = await cookies();
  if (!isLiveMode()) {
    const wanted = jar.get(DEMO_SITE_COOKIE)?.value;
    const siteId = DEMO_SITES.some((s) => s.id === wanted) ? wanted! : DEFAULT_DEMO_SITE_ID;
    const profile = demoProfileFor(siteId, jar.get(DEMO_USER_COOKIE)?.value);
    return { profile, repo: new DemoRepository(siteId) };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: access }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("site_access").select("site_id").eq("user_id", user.id),
  ]);
  const siteIds = ((access ?? []) as { site_id: string }[]).map((a) => a.site_id);
  if (!profile || siteIds.length === 0) redirect("/login?error=no-site-access");
  const wanted = jar.get(SITE_COOKIE)?.value;
  const siteId = wanted && siteIds.includes(wanted) ? wanted : siteIds[0];

  return {
    profile: profile as Profile,
    repo: new SupabaseRepository(supabase, siteId),
  };
});
