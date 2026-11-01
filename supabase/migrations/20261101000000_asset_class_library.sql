-- Migration: 20261101000000_asset_class_library.sql
-- Purpose: org-wide asset class library (data standard + failure modes per
--          class), class and attributes on every asset, and a vertical per site
-- Decision: TMX-002 (data center vertical alongside industrial/utility)

-- ============================================================
-- TYPES
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.vertical AS ENUM ('industrial_utility', 'data_center');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- SITES: vertical
-- ============================================================

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS vertical public.vertical NOT NULL DEFAULT 'industrial_utility';

-- ============================================================
-- TABLE CREATION
-- ============================================================

-- One standard per organization. Sites use the org's classes; they cannot
-- define their own, which is what keeps site-to-site comparisons honest.
CREATE TABLE IF NOT EXISTS public.asset_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
  name text NOT NULL,
  category text NOT NULL,
  verticals public.vertical[] NOT NULL CHECK (cardinality(verticals) > 0),
  description text NOT NULL DEFAULT '',
  -- Array of {key, label, type, unit?, options?, required}. Validated in the
  -- app (lib/taxonomy/assess.ts); the database checks only the shape.
  attributes jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(attributes) = 'array'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS public.asset_class_failure_modes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.asset_classes(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z]{3}$'),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  detection text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, code)
);

DROP TRIGGER IF EXISTS asset_classes_set_updated_at ON public.asset_classes;
CREATE TRIGGER asset_classes_set_updated_at BEFORE UPDATE ON public.asset_classes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS asset_class_failure_modes_set_updated_at ON public.asset_class_failure_modes;
CREATE TRIGGER asset_class_failure_modes_set_updated_at BEFORE UPDATE ON public.asset_class_failure_modes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- ASSETS: class and attributes
-- ============================================================

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES public.asset_classes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE public.assets ADD CONSTRAINT assets_attributes_is_object CHECK (jsonb_typeof(attributes) = 'object');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The free-text class is replaced by class_id. Kept nullable for one release
-- so existing rows survive; drop it once every asset is classified.
ALTER TABLE public.assets ALTER COLUMN asset_class DROP NOT NULL;
COMMENT ON COLUMN public.assets.asset_class IS 'Deprecated: replaced by class_id (20261101000000). Drop after backfill.';

-- An asset's class must belong to the same organization as its site.
CREATE OR REPLACE FUNCTION public.check_asset_class_org()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.class_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.asset_classes c JOIN public.sites s ON s.org_id = c.org_id
    WHERE c.id = NEW.class_id AND s.id = NEW.site_id
  ) THEN
    RAISE EXCEPTION 'Asset class % does not belong to the organization of site %', NEW.class_id, NEW.site_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS assets_check_class_org ON public.assets;
CREATE TRIGGER assets_check_class_org BEFORE INSERT OR UPDATE OF class_id, site_id ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.check_asset_class_org();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.asset_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_class_failure_modes ENABLE ROW LEVEL SECURITY;

-- The library is org-wide: readable from any site in the org.
DROP POLICY IF EXISTS "asset_classes: org-scoped read" ON public.asset_classes;
CREATE POLICY "asset_classes: org-scoped read" ON public.asset_classes
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );

-- Only admins change the standard. Planners classify assets (assets policy).
DROP POLICY IF EXISTS "asset_classes: admins write" ON public.asset_classes;
CREATE POLICY "asset_classes: admins write" ON public.asset_classes
  FOR ALL USING (
    public.current_user_role() = 'admin'
    AND org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  ) WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "asset_class_failure_modes: org-scoped read" ON public.asset_class_failure_modes;
CREATE POLICY "asset_class_failure_modes: org-scoped read" ON public.asset_class_failure_modes
  FOR SELECT USING (
    class_id IN (
      SELECT id FROM public.asset_classes
      WHERE org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
    )
  );

DROP POLICY IF EXISTS "asset_class_failure_modes: admins write" ON public.asset_class_failure_modes;
CREATE POLICY "asset_class_failure_modes: admins write" ON public.asset_class_failure_modes
  FOR ALL USING (
    public.current_user_role() = 'admin'
    AND class_id IN (
      SELECT id FROM public.asset_classes
      WHERE org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
    )
  ) WITH CHECK (
    public.current_user_role() = 'admin'
    AND class_id IN (
      SELECT id FROM public.asset_classes
      WHERE org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
    )
  );

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_asset_classes_org_id ON public.asset_classes(org_id);
CREATE INDEX IF NOT EXISTS idx_asset_class_failure_modes_class_id ON public.asset_class_failure_modes(class_id);
CREATE INDEX IF NOT EXISTS idx_assets_class_id ON public.assets(class_id);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TRIGGER IF EXISTS assets_check_class_org ON public.assets;
-- DROP FUNCTION IF EXISTS public.check_asset_class_org;
-- ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_attributes_is_object;
-- ALTER TABLE public.assets DROP COLUMN IF EXISTS attributes, DROP COLUMN IF EXISTS class_id;
-- DROP TABLE IF EXISTS public.asset_class_failure_modes, public.asset_classes CASCADE;
-- ALTER TABLE public.sites DROP COLUMN IF EXISTS vertical;
-- DROP TYPE IF EXISTS public.vertical;
-- (asset_class NOT NULL is not restored: backfill it first if rolling back.)
