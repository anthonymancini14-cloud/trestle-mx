import "server-only";
import { createServerClient as createSsrClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/config";

/**
 * Server Components, Route Handlers and Server Actions. Uses the signed-in
 * user's JWT from cookies, so every query runs under RLS as that user.
 */
export async function createServerClient() {
  const cookieStore = await cookies();
  return createSsrClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
