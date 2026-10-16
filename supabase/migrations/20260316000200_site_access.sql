-- Migration: 20260316000200_site_access.sql
-- Purpose: user-to-site mapping that every site-scoped RLS policy reads
-- Phase: P1-2
--
-- Why a table instead of profiles.site_id: MVP users have one row here, but a
-- corporate reliability engineer can have many. Policies never change; you
-- just add rows.

-- ============================================================
-- TABLE CREATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.site_access (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, site_id)
);

-- Sites the caller can see. SECURITY DEFINER so policies on site_access and
-- profiles can ask "who shares a site with me?" without recursing.
CREATE OR REPLACE FUNCTION public.user_site_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT site_id FROM public.site_access WHERE user_id = auth.uid()
$$;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.site_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_access: read shared sites" ON public.site_access;
CREATE POLICY "site_access: read shared sites" ON public.site_access
  FOR SELECT USING (site_id IN (SELECT public.user_site_ids()));

DROP POLICY IF EXISTS "site_access: admins manage" ON public.site_access;
CREATE POLICY "site_access: admins manage" ON public.site_access
  FOR ALL USING (
    site_id IN (SELECT public.user_site_ids()) AND public.current_user_role() = 'admin'
  ) WITH CHECK (
    site_id IN (SELECT public.user_site_ids()) AND public.current_user_role() = 'admin'
  );

-- Profiles: see everyone who shares one of your sites.
DROP POLICY IF EXISTS "profiles: read site peers" ON public.profiles;
CREATE POLICY "profiles: read site peers" ON public.profiles
  FOR SELECT USING (
    id IN (SELECT user_id FROM public.site_access WHERE site_id IN (SELECT public.user_site_ids()))
  );

-- Admins can change roles for people at their site.
DROP POLICY IF EXISTS "profiles: admins manage site peers" ON public.profiles;
CREATE POLICY "profiles: admins manage site peers" ON public.profiles
  FOR UPDATE USING (
    public.current_user_role() = 'admin'
    AND id IN (SELECT user_id FROM public.site_access WHERE site_id IN (SELECT public.user_site_ids()))
  );

-- Tenancy tables, now that site_access exists.
DROP POLICY IF EXISTS "sites: site-scoped read" ON public.sites;
CREATE POLICY "sites: site-scoped read" ON public.sites
  FOR SELECT USING (id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "organizations: read via site" ON public.organizations;
CREATE POLICY "organizations: read via site" ON public.organizations
  FOR SELECT USING (
    id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "area_codes: site-scoped read" ON public.area_codes;
CREATE POLICY "area_codes: site-scoped read" ON public.area_codes
  FOR SELECT USING (site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "area_codes: admins manage" ON public.area_codes;
CREATE POLICY "area_codes: admins manage" ON public.area_codes
  FOR ALL USING (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    AND public.current_user_role() = 'admin'
  ) WITH CHECK (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    AND public.current_user_role() = 'admin'
  );

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_site_access_site_id ON public.site_access(site_id);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP POLICY IF EXISTS "profiles: read site peers" ON public.profiles;
-- DROP POLICY IF EXISTS "profiles: admins manage site peers" ON public.profiles;
-- DROP FUNCTION IF EXISTS public.user_site_ids;
-- DROP TABLE IF EXISTS public.site_access CASCADE;
