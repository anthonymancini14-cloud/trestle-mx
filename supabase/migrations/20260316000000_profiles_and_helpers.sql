-- Migration: 20260316000000_profiles_and_helpers.sql
-- Purpose: user profiles linked to auth.users, role enum, shared helper functions
-- Phase: P1-0a (timestamped replacement for the original 001_profiles_and_trigger.sql)

-- ============================================================
-- TYPES
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('admin', 'supervisor', 'planner', 'gatekeeper', 'technician', 'storeroom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.craft AS ENUM ('mechanical', 'electrical', 'instrumentation', 'operations', 'contractor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TABLE CREATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  role public.user_role NOT NULL DEFAULT 'technician',
  craft public.craft,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- HELPERS
-- ============================================================

-- Keeps updated_at current on every table that has one.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Role of the calling user. SECURITY DEFINER so policies can call it
-- without recursing through profiles' own RLS.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- New auth user -> profile row. Role defaults to technician; an admin promotes.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, coalesce(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- RLS (peer-visibility policy is added with site_access in P1-2)
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles: read own" ON public.profiles;
CREATE POLICY "profiles: read own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles: update own name" ON public.profiles;
CREATE POLICY "profiles: update own name" ON public.profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = public.current_user_role());

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- DROP FUNCTION IF EXISTS public.handle_new_user, public.current_user_role, public.set_updated_at;
-- DROP TABLE IF EXISTS public.profiles CASCADE;
-- DROP TYPE IF EXISTS public.user_role, public.craft;
