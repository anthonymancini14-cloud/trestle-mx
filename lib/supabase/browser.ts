"use client";
import { createBrowserClient as createSsrBrowserClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/config";

/** Client Components only. Never import this from server code. */
export function createBrowserClient() {
  return createSsrBrowserClient(SUPABASE_URL, SUPABASE_KEY);
}
