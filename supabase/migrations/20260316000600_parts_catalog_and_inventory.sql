-- Migration: 20260316000600_parts_catalog_and_inventory.sql
-- Purpose: org-wide parts master and per-site stock levels
-- Phase: P1-6

-- ============================================================
-- TABLE CREATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.parts_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  part_number text NOT NULL,
  description text NOT NULL,
  manufacturer text,
  mfr_part_number text,
  category text NOT NULL DEFAULT 'General',
  unit text NOT NULL DEFAULT 'ea',
  unit_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, part_number)
);

CREATE TABLE IF NOT EXISTS public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES public.parts_catalog(id) ON DELETE CASCADE,
  bin text NOT NULL DEFAULT '',
  on_hand numeric(10,2) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved numeric(10,2) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  min_qty numeric(10,2) NOT NULL DEFAULT 0,
  max_qty numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, part_id)
);

DROP TRIGGER IF EXISTS parts_catalog_set_updated_at ON public.parts_catalog;
CREATE TRIGGER parts_catalog_set_updated_at BEFORE UPDATE ON public.parts_catalog
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS inventory_set_updated_at ON public.inventory;
CREATE TRIGGER inventory_set_updated_at BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.parts_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

-- The catalog is org-wide: visible from any site in the org.
DROP POLICY IF EXISTS "parts_catalog: org-scoped read" ON public.parts_catalog;
CREATE POLICY "parts_catalog: org-scoped read" ON public.parts_catalog
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "parts_catalog: storeroom and admins write" ON public.parts_catalog;
CREATE POLICY "parts_catalog: storeroom and admins write" ON public.parts_catalog
  FOR ALL USING (
    public.current_user_role() IN ('storeroom', 'admin')
    AND org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  ) WITH CHECK (
    public.current_user_role() IN ('storeroom', 'admin')
    AND org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "inventory: site-scoped read" ON public.inventory;
CREATE POLICY "inventory: site-scoped read" ON public.inventory
  FOR SELECT USING (site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()));

-- Reservations and issues from other roles go through SECURITY DEFINER
-- functions in P1-7, so direct writes stay with the storeroom.
DROP POLICY IF EXISTS "inventory: storeroom and admins write" ON public.inventory;
CREATE POLICY "inventory: storeroom and admins write" ON public.inventory
  FOR ALL USING (
    public.current_user_role() IN ('storeroom', 'admin')
    AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
  ) WITH CHECK (
    public.current_user_role() IN ('storeroom', 'admin')
    AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
  );

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_parts_catalog_org_id ON public.parts_catalog(org_id);
CREATE INDEX IF NOT EXISTS idx_inventory_site_id ON public.inventory(site_id);
CREATE INDEX IF NOT EXISTS idx_inventory_part_id ON public.inventory(part_id);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TABLE IF EXISTS public.inventory, public.parts_catalog CASCADE;
