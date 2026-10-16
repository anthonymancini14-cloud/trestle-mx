import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLiveMode } from "@/lib/config";
import { DemoRepository } from "@/lib/data/demo-repository";
import type { Repository } from "@/lib/data/repository";
import { SupabaseRepository } from "@/lib/data/supabase-repository";
import { PROFILES } from "@/lib/demo/seed";
import { createServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/domain";

export const DEMO_USER_COOKIE = "tmx_demo_user";
export const DEFAULT_DEMO_USER = PROFILES[0].id; // Marcus Reyes, planner

export interface Viewer {
  profile: Profile;
  repo: Repository;
}

/**
 * The current user and the data layer scoped to them. Cached per request.
 * Demo mode: the person picked on the role switcher (a cookie).
 * Live mode: the Supabase session, their profile, and their first site.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  if (!isLiveMode()) {
    const chosen = (await cookies()).get(DEMO_USER_COOKIE)?.value;
    const profile = PROFILES.find((p) => p.id === chosen) ?? PROFILES[0];
    return { profile, repo: new DemoRepository() };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: access }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("site_access").select("site_id").eq("user_id", user.id).limit(1).maybeSingle(),
  ]);
  if (!profile || !access) redirect("/login?error=no-site-access");

  return {
    profile: profile as Profile,
    repo: new SupabaseRepository(supabase, (access as { site_id: string }).site_id),
  };
});
