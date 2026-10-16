/**
 * Runtime configuration. Trestle.MX runs in two modes:
 * - demo: no environment needed; an in-memory fictional plant, role switcher.
 * - live: Supabase auth + Postgres with row-level security.
 * Planning Mode uses Claude when ANTHROPIC_API_KEY is set, and a scripted
 * planner otherwise, so the demo always works.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isLiveMode = (): boolean =>
  process.env.TRESTLE_MODE !== "demo" && SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0;

export const PLANNING_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

export const hasClaude = (): boolean => (process.env.ANTHROPIC_API_KEY ?? "").length > 0;
