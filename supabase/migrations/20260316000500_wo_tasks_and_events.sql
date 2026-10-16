-- Migration: 20260316000500_wo_tasks_and_events.sql
-- Purpose: job plan steps and the immutable work order audit log
-- Phase: P1-5

-- ============================================================
-- TABLE CREATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wo_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  description text NOT NULL,
  craft public.craft NOT NULL DEFAULT 'mechanical',
  crew_size smallint NOT NULL DEFAULT 1 CHECK (crew_size >= 1),
  est_hours numeric(6,2) NOT NULL DEFAULT 0 CHECK (est_hours >= 0),
  safety_note text,
  acceptance_criteria text,
  is_complete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wo_id, seq)
);

DROP TRIGGER IF EXISTS wo_tasks_set_updated_at ON public.wo_tasks;
CREATE TRIGGER wo_tasks_set_updated_at BEFORE UPDATE ON public.wo_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$ BEGIN
  CREATE TYPE public.wo_event_type AS ENUM (
    'created', 'stage_change', 'rejected', 'plan_committed', 'scheduled',
    'task_completed', 'part_issued', 'closed', 'note'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.wo_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  event_type public.wo_event_type NOT NULL,
  from_stage public.wo_stage,
  to_stage public.wo_stage,
  note text,
  actor_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.wo_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wo_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wo_tasks: site-scoped read" ON public.wo_tasks;
CREATE POLICY "wo_tasks: site-scoped read" ON public.wo_tasks
  FOR SELECT USING (
    wo_id IN (
      SELECT id FROM public.work_orders
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

-- Planners own the plan.
DROP POLICY IF EXISTS "wo_tasks: planners write" ON public.wo_tasks;
CREATE POLICY "wo_tasks: planners write" ON public.wo_tasks
  FOR ALL USING (
    public.current_user_role() IN ('planner', 'admin')
    AND wo_id IN (
      SELECT id FROM public.work_orders
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  ) WITH CHECK (
    public.current_user_role() IN ('planner', 'admin')
    AND wo_id IN (
      SELECT id FROM public.work_orders
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

-- Technicians and supervisors mark steps complete.
DROP POLICY IF EXISTS "wo_tasks: crew completes" ON public.wo_tasks;
CREATE POLICY "wo_tasks: crew completes" ON public.wo_tasks
  FOR UPDATE USING (
    public.current_user_role() IN ('technician', 'supervisor')
    AND wo_id IN (
      SELECT id FROM public.work_orders
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "wo_events: site-scoped read" ON public.wo_events;
CREATE POLICY "wo_events: site-scoped read" ON public.wo_events
  FOR SELECT USING (
    wo_id IN (
      SELECT id FROM public.work_orders
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

-- Append-only: insert as yourself, never update or delete.
DROP POLICY IF EXISTS "wo_events: append as self" ON public.wo_events;
CREATE POLICY "wo_events: append as self" ON public.wo_events
  FOR INSERT WITH CHECK (
    actor_id = auth.uid()
    AND wo_id IN (
      SELECT id FROM public.work_orders
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_wo_tasks_wo_id ON public.wo_tasks(wo_id);
CREATE INDEX IF NOT EXISTS idx_wo_events_wo_id_created ON public.wo_events(wo_id, created_at DESC);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TABLE IF EXISTS public.wo_events, public.wo_tasks CASCADE;
-- DROP TYPE IF EXISTS public.wo_event_type;
