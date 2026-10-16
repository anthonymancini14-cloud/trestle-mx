-- Migration: 20260316000300_assets.sql
-- Purpose: physical equipment with a functional-location (FLOC) hierarchy
-- Phase: P1-3

-- ============================================================
-- TABLE CREATION
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.criticality AS ENUM ('A', 'B', 'C');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_status AS ENUM ('running', 'standby', 'down', 'retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  area_id uuid NOT NULL REFERENCES public.area_codes(id),
  parent_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  floc text NOT NULL,
  name text NOT NULL,
  asset_class text NOT NULL,
  criticality public.criticality NOT NULL DEFAULT 'C',
  manufacturer text,
  model text,
  serial_number text,
  install_date date,
  status public.asset_status NOT NULL DEFAULT 'running',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, floc),
  CHECK (parent_id IS DISTINCT FROM id)
);

DROP TRIGGER IF EXISTS assets_set_updated_at ON public.assets;
CREATE TRIGGER assets_set_updated_at BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assets: site-scoped read" ON public.assets;
CREATE POLICY "assets: site-scoped read" ON public.assets
  FOR SELECT USING (site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "assets: planners and admins write" ON public.assets;
CREATE POLICY "assets: planners and admins write" ON public.assets
  FOR ALL USING (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    AND public.current_user_role() IN ('planner', 'admin')
  ) WITH CHECK (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    AND public.current_user_role() IN ('planner', 'admin')
  );

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_assets_site_id ON public.assets(site_id);
CREATE INDEX IF NOT EXISTS idx_assets_area_id ON public.assets(area_id);
CREATE INDEX IF NOT EXISTS idx_assets_parent_id ON public.assets(parent_id);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TABLE IF EXISTS public.assets CASCADE;
-- DROP TYPE IF EXISTS public.criticality, public.asset_status;
