-- Migration: 20260316000400_work_orders.sql
-- Purpose: the core work order record and its six-stage lifecycle
-- Phase: P1-4
--
-- Stages: identification > vetting > planning > scheduling > execution > closure.
-- Who may move a work order between stages is enforced in the app
-- (lib/workflow.ts); RLS here enforces site scope and broad role groups.

-- ============================================================
-- TABLE CREATION
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.wo_stage AS ENUM ('identification', 'vetting', 'planning', 'scheduling', 'execution', 'closure');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wo_status AS ENUM ('open', 'closed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wo_type AS ENUM ('corrective', 'preventive', 'predictive', 'emergency', 'project');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SEQUENCE IF NOT EXISTS public.wo_number_seq START 1001;

CREATE TABLE IF NOT EXISTS public.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  wo_number text NOT NULL DEFAULT ('WO-' || to_char(now(), 'YY') || '-' || nextval('public.wo_number_seq')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  wo_type public.wo_type NOT NULL DEFAULT 'corrective',
  priority smallint NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),
  stage public.wo_stage NOT NULL DEFAULT 'identification',
  status public.wo_status NOT NULL DEFAULT 'open',
  requires_shutdown boolean NOT NULL DEFAULT false,
  reported_by uuid REFERENCES public.profiles(id),
  planner_id uuid REFERENCES public.profiles(id),
  assigned_to uuid REFERENCES public.profiles(id),
  scheduled_date date,
  estimated_hours numeric(6,2),
  actual_hours numeric(6,2),
  plan_summary text,
  debrief text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (site_id, wo_number),
  CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);

DROP TRIGGER IF EXISTS work_orders_set_updated_at ON public.work_orders;
CREATE TRIGGER work_orders_set_updated_at BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_orders: site-scoped read" ON public.work_orders;
CREATE POLICY "work_orders: site-scoped read" ON public.work_orders
  FOR SELECT USING (site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()));

-- Anyone at the site can report a discrepancy.
DROP POLICY IF EXISTS "work_orders: site members create" ON public.work_orders;
CREATE POLICY "work_orders: site members create" ON public.work_orders
  FOR INSERT WITH CHECK (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    AND reported_by = auth.uid()
  );

-- Storeroom moves materials, not work orders.
DROP POLICY IF EXISTS "work_orders: work roles update" ON public.work_orders;
CREATE POLICY "work_orders: work roles update" ON public.work_orders
  FOR UPDATE USING (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    AND public.current_user_role() IN ('admin', 'supervisor', 'planner', 'gatekeeper', 'technician')
  ) WITH CHECK (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
  );

-- No DELETE policy: work orders are rejected or closed, never deleted.

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_work_orders_site_id ON public.work_orders(site_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_site_stage ON public.work_orders(site_id, stage) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_work_orders_asset_id ON public.work_orders(asset_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned_to ON public.work_orders(assigned_to);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TABLE IF EXISTS public.work_orders CASCADE;
-- DROP SEQUENCE IF EXISTS public.wo_number_seq;
-- DROP TYPE IF EXISTS public.wo_stage, public.wo_status, public.wo_type;
