-- Migration: 20261101000100_cable_plant.sql
-- Purpose: record the cable plant. Installed cables and cable tray sections
--          are assets (classes CABLE and CABLE-TRAY); cable_routes records the
--          tray sections each cable runs through, end A to end B, so crews
--          know which tray to work in. Storeroom parts get structured specs
--          (cable type, dimensions, terminations).
-- Decision: TMX-002 (data center vertical)

-- ============================================================
-- PARTS: structured specs
-- ============================================================

ALTER TABLE public.parts_catalog ADD COLUMN IF NOT EXISTS specs jsonb;

DO $$ BEGIN
  ALTER TABLE public.parts_catalog ADD CONSTRAINT parts_catalog_specs_is_object
    CHECK (specs IS NULL OR jsonb_typeof(specs) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TABLE CREATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cable_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cable_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  pathway_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  seq integer NOT NULL CHECK (seq > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cable_id, seq)
);

DROP TRIGGER IF EXISTS cable_routes_set_updated_at ON public.cable_routes;
CREATE TRIGGER cable_routes_set_updated_at BEFORE UPDATE ON public.cable_routes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A route links a CABLE asset to a CABLE-TRAY asset at the same site.
CREATE OR REPLACE FUNCTION public.check_cable_route()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  cable_site uuid; cable_class text;
  tray_site uuid; tray_class text;
BEGIN
  SELECT a.site_id, c.code INTO cable_site, cable_class
    FROM public.assets a LEFT JOIN public.asset_classes c ON c.id = a.class_id WHERE a.id = NEW.cable_id;
  SELECT a.site_id, c.code INTO tray_site, tray_class
    FROM public.assets a LEFT JOIN public.asset_classes c ON c.id = a.class_id WHERE a.id = NEW.pathway_id;
  IF cable_class IS DISTINCT FROM 'CABLE' THEN
    RAISE EXCEPTION 'cable_routes.cable_id must be an asset of class CABLE';
  END IF;
  IF tray_class IS DISTINCT FROM 'CABLE-TRAY' THEN
    RAISE EXCEPTION 'cable_routes.pathway_id must be an asset of class CABLE-TRAY';
  END IF;
  IF cable_site IS DISTINCT FROM tray_site THEN
    RAISE EXCEPTION 'A cable can only be routed through tray sections at its own site';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cable_routes_check ON public.cable_routes;
CREATE TRIGGER cable_routes_check BEFORE INSERT OR UPDATE ON public.cable_routes
  FOR EACH ROW EXECUTE FUNCTION public.check_cable_route();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.cable_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cable_routes: site-scoped read" ON public.cable_routes;
CREATE POLICY "cable_routes: site-scoped read" ON public.cable_routes
  FOR SELECT USING (
    cable_id IN (
      SELECT id FROM public.assets
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

-- Same writers as the asset register.
DROP POLICY IF EXISTS "cable_routes: planners and admins write" ON public.cable_routes;
CREATE POLICY "cable_routes: planners and admins write" ON public.cable_routes
  FOR ALL USING (
    public.current_user_role() IN ('planner', 'admin')
    AND cable_id IN (
      SELECT id FROM public.assets
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  ) WITH CHECK (
    public.current_user_role() IN ('planner', 'admin')
    AND cable_id IN (
      SELECT id FROM public.assets
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_cable_routes_cable_id ON public.cable_routes(cable_id);
CREATE INDEX IF NOT EXISTS idx_cable_routes_pathway_id ON public.cable_routes(pathway_id);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TABLE IF EXISTS public.cable_routes CASCADE;
-- DROP FUNCTION IF EXISTS public.check_cable_route;
-- ALTER TABLE public.parts_catalog DROP CONSTRAINT IF EXISTS parts_catalog_specs_is_object;
-- ALTER TABLE public.parts_catalog DROP COLUMN IF EXISTS specs;
