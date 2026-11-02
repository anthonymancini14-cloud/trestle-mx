-- Migration: 20261101000200_pm_program.sql
-- Purpose: PM strategy layer. PM tasks live in the org's class library and
--          name the failure modes they address; criticality decides who gets
--          them; critical spares per class; one schedule per asset per task
--          (the maintenance index); supervisor-approved deferrals; PM work
--          orders generated straight to Scheduling; closing a PM restarts its
--          interval.
-- Decisions: TMX-008, TMX-011 to TMX-014

-- ============================================================
-- TYPES
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.pm_strategy AS ENUM ('time_based', 'condition_based', 'failure_finding');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- CLASS LIBRARY: run-to-failure and repeat-failure window
-- ============================================================

ALTER TABLE public.asset_classes
  ADD COLUMN IF NOT EXISTS run_to_failure public.criticality[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS repeat_window_days integer DEFAULT 90;

DO $$ BEGIN
  ALTER TABLE public.asset_classes ADD CONSTRAINT asset_classes_repeat_window_positive
    CHECK (repeat_window_days IS NULL OR repeat_window_days > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TABLE CREATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.asset_classes(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  strategy public.pm_strategy NOT NULL,
  craft public.craft NOT NULL,
  crew_size integer NOT NULL DEFAULT 1 CHECK (crew_size > 0),
  est_hours numeric(6,2) NOT NULL CHECK (est_hours > 0),
  interval_days integer NOT NULL CHECK (interval_days > 0),
  interval_days_crit_a integer CHECK (interval_days_crit_a IS NULL OR interval_days_crit_a > 0),
  criticalities public.criticality[] NOT NULL CHECK (cardinality(criticalities) > 0),
  -- Codes of the class's failure modes this task prevents or detects.
  failure_mode_codes text[] NOT NULL CHECK (cardinality(failure_mode_codes) > 0),
  requires_shutdown boolean NOT NULL DEFAULT false,
  acceptance_criteria text,
  is_starter_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, code)
);

CREATE TABLE IF NOT EXISTS public.asset_class_spares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.asset_classes(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES public.parts_catalog(id) ON DELETE CASCADE,
  qty numeric(10,2) NOT NULL CHECK (qty > 0),
  -- Only for assets of this model; null means every crit A asset of the class.
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pm_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  pm_task_id uuid NOT NULL REFERENCES public.pm_tasks(id) ON DELETE RESTRICT,
  interval_days integer NOT NULL CHECK (interval_days > 0),
  last_done_on date,
  next_due_on date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, pm_task_id)
);

-- Append-only record of every deferral, written only by defer_pm().
CREATE TABLE IF NOT EXISTS public.pm_deferrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.pm_schedules(id) ON DELETE CASCADE,
  from_due_on date NOT NULL,
  to_due_on date NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  approved_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_due_on > from_due_on)
);

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS pm_schedule_id uuid REFERENCES public.pm_schedules(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS pm_tasks_set_updated_at ON public.pm_tasks;
CREATE TRIGGER pm_tasks_set_updated_at BEFORE UPDATE ON public.pm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS asset_class_spares_set_updated_at ON public.asset_class_spares;
CREATE TRIGGER asset_class_spares_set_updated_at BEFORE UPDATE ON public.asset_class_spares
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS pm_schedules_set_updated_at ON public.pm_schedules;
CREATE TRIGGER pm_schedules_set_updated_at BEFORE UPDATE ON public.pm_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A schedule's site is its asset's site, and its task belongs to the asset's class.
CREATE OR REPLACE FUNCTION public.check_pm_schedule()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_asset public.assets%ROWTYPE; v_task_class uuid;
BEGIN
  SELECT * INTO v_asset FROM public.assets WHERE id = NEW.asset_id;
  SELECT class_id INTO v_task_class FROM public.pm_tasks WHERE id = NEW.pm_task_id;
  IF v_asset.site_id IS DISTINCT FROM NEW.site_id THEN
    RAISE EXCEPTION 'pm_schedules.site_id must be the asset''s site';
  END IF;
  IF v_asset.class_id IS DISTINCT FROM v_task_class THEN
    RAISE EXCEPTION 'A PM task can only be scheduled on assets of its own class';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pm_schedules_check ON public.pm_schedules;
CREATE TRIGGER pm_schedules_check BEFORE INSERT OR UPDATE OF asset_id, pm_task_id, site_id ON public.pm_schedules
  FOR EACH ROW EXECUTE FUNCTION public.check_pm_schedule();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.pm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_class_spares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_deferrals ENABLE ROW LEVEL SECURITY;

-- Library tables: readable from any site in the org; admins change the standard.
DROP POLICY IF EXISTS "pm_tasks: org-scoped read" ON public.pm_tasks;
CREATE POLICY "pm_tasks: org-scoped read" ON public.pm_tasks
  FOR SELECT USING (
    class_id IN (
      SELECT id FROM public.asset_classes
      WHERE org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
    )
  );
DROP POLICY IF EXISTS "pm_tasks: admins write" ON public.pm_tasks;
CREATE POLICY "pm_tasks: admins write" ON public.pm_tasks
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

DROP POLICY IF EXISTS "asset_class_spares: org-scoped read" ON public.asset_class_spares;
CREATE POLICY "asset_class_spares: org-scoped read" ON public.asset_class_spares
  FOR SELECT USING (
    class_id IN (
      SELECT id FROM public.asset_classes
      WHERE org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
    )
  );
DROP POLICY IF EXISTS "asset_class_spares: admins and storeroom write" ON public.asset_class_spares;
CREATE POLICY "asset_class_spares: admins and storeroom write" ON public.asset_class_spares
  FOR ALL USING (
    public.current_user_role() IN ('admin', 'storeroom')
    AND class_id IN (
      SELECT id FROM public.asset_classes
      WHERE org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
    )
  ) WITH CHECK (
    public.current_user_role() IN ('admin', 'storeroom')
    AND class_id IN (
      SELECT id FROM public.asset_classes
      WHERE org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
    )
  );

DROP POLICY IF EXISTS "pm_schedules: site-scoped read" ON public.pm_schedules;
CREATE POLICY "pm_schedules: site-scoped read" ON public.pm_schedules
  FOR SELECT USING (site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()));
-- Planners and admins maintain the schedule (add, retire, change interval).
-- Due dates move only by completing the PM or through defer_pm().
DROP POLICY IF EXISTS "pm_schedules: planners and admins write" ON public.pm_schedules;
CREATE POLICY "pm_schedules: planners and admins write" ON public.pm_schedules
  FOR ALL USING (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    AND public.current_user_role() IN ('planner', 'admin')
  ) WITH CHECK (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    AND public.current_user_role() IN ('planner', 'admin')
  );

-- Deferrals: read only. No insert, update or delete policy; defer_pm() writes them.
DROP POLICY IF EXISTS "pm_deferrals: site-scoped read" ON public.pm_deferrals;
CREATE POLICY "pm_deferrals: site-scoped read" ON public.pm_deferrals
  FOR SELECT USING (
    schedule_id IN (
      SELECT id FROM public.pm_schedules
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Generate work orders for PMs due within the lead window. They start in
-- Scheduling with the template's plan (no vetting, decision TMX-014).
-- Routine PMs are P3; an overdue PM on a crit A asset is P2.
CREATE OR REPLACE FUNCTION public.generate_due_pms(p_site_id uuid, p_as_of date, p_lead_days integer DEFAULT 14)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_wo uuid;
  v_seq integer;
  v_hours numeric;
  v_created integer := 0;
BEGIN
  IF p_site_id NOT IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No access to this site';
  END IF;
  IF public.current_user_role() NOT IN ('planner', 'admin') THEN
    RAISE EXCEPTION 'Only planners and admins generate PM work orders';
  END IF;

  FOR r IN
    SELECT s.id AS schedule_id, s.next_due_on, a.id AS asset_id, a.floc, a.criticality, t.*
    FROM public.pm_schedules s
    JOIN public.assets a ON a.id = s.asset_id
    JOIN public.pm_tasks t ON t.id = s.pm_task_id
    WHERE s.site_id = p_site_id AND s.is_active
      AND s.next_due_on <= p_as_of + p_lead_days
      AND NOT EXISTS (SELECT 1 FROM public.work_orders w WHERE w.pm_schedule_id = s.id AND w.status = 'open')
    FOR UPDATE OF s
  LOOP
    v_hours := r.est_hours * r.crew_size + CASE WHEN r.requires_shutdown THEN 0.75 ELSE 0 END;
    INSERT INTO public.work_orders (
      site_id, title, description, asset_id, wo_type, priority, stage, status, requires_shutdown,
      reported_by, planner_id, estimated_hours, plan_summary, pm_schedule_id
    ) VALUES (
      p_site_id,
      'PM ' || r.code || ': ' || r.title,
      'Preventive maintenance from the PM program, due ' || r.next_due_on || '. Addresses failure modes ' || array_to_string(r.failure_mode_codes, ', ') || '.',
      r.asset_id, 'preventive', CASE WHEN r.criticality = 'A' AND r.next_due_on < p_as_of THEN 2 ELSE 3 END, 'scheduling', 'open', r.requires_shutdown,
      auth.uid(), auth.uid(), v_hours, r.code || ': ' || r.title, r.schedule_id
    ) RETURNING id INTO v_wo;

    v_seq := 10;
    IF r.requires_shutdown THEN
      INSERT INTO public.wo_tasks (wo_id, seq, description, craft, crew_size, est_hours, safety_note)
      VALUES (v_wo, v_seq, 'Coordinate with operations; isolate and verify ' || r.floc || ' per the site energy control procedure', 'operations', 1, 0.5, 'Verify zero energy before work.');
      v_seq := 20;
    END IF;
    INSERT INTO public.wo_tasks (wo_id, seq, description, craft, crew_size, est_hours, acceptance_criteria)
    VALUES (v_wo, v_seq, r.title, r.craft, r.crew_size, r.est_hours, r.acceptance_criteria);
    IF r.requires_shutdown THEN
      INSERT INTO public.wo_tasks (wo_id, seq, description, craft, crew_size, est_hours, acceptance_criteria)
      VALUES (v_wo, 30, 'Return ' || r.floc || ' to service and confirm with operations', 'operations', 1, 0.25, 'Operating normally.');
    END IF;

    INSERT INTO public.wo_events (wo_id, event_type, from_stage, to_stage, note, actor_id)
    VALUES (v_wo, 'created', NULL, 'scheduling', 'Generated from PM schedule; due ' || r.next_due_on, auth.uid());
    v_created := v_created + 1;
  END LOOP;
  RETURN v_created;
END $$;

-- Defer a PM: supervisors only (decision TMX-013), with a reason and a later date.
CREATE OR REPLACE FUNCTION public.defer_pm(p_schedule_id uuid, p_to date, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s public.pm_schedules%ROWTYPE; v_wo uuid;
BEGIN
  SELECT * INTO v_s FROM public.pm_schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PM schedule not found'; END IF;
  IF v_s.site_id NOT IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No access to this site';
  END IF;
  IF public.current_user_role() <> 'supervisor' THEN
    RAISE EXCEPTION 'Every PM deferral needs a supervisor';
  END IF;
  IF p_to <= v_s.next_due_on THEN
    RAISE EXCEPTION 'The new date must be after the current due date';
  END IF;

  INSERT INTO public.pm_deferrals (schedule_id, from_due_on, to_due_on, reason, approved_by)
  VALUES (p_schedule_id, v_s.next_due_on, p_to, p_reason, auth.uid());
  UPDATE public.pm_schedules SET next_due_on = p_to WHERE id = p_schedule_id;

  SELECT id INTO v_wo FROM public.work_orders WHERE pm_schedule_id = p_schedule_id AND status = 'open' LIMIT 1;
  IF v_wo IS NOT NULL THEN
    INSERT INTO public.wo_events (wo_id, event_type, note, actor_id)
    VALUES (v_wo, 'note', 'PM deferred from ' || v_s.next_due_on || ' to ' || p_to || ': ' || p_reason, auth.uid());
  END IF;
END $$;

-- Closing a PM work order restarts its interval from the completion date.
CREATE OR REPLACE FUNCTION public.advance_pm_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.pm_schedule_id IS NOT NULL AND NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    UPDATE public.pm_schedules
      SET last_done_on = coalesce(NEW.closed_at, now())::date,
          next_due_on = coalesce(NEW.closed_at, now())::date + interval_days
      WHERE id = NEW.pm_schedule_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS work_orders_advance_pm ON public.work_orders;
CREATE TRIGGER work_orders_advance_pm AFTER UPDATE OF status ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.advance_pm_schedule();

REVOKE ALL ON FUNCTION public.generate_due_pms(uuid, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.defer_pm(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_due_pms(uuid, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.defer_pm(uuid, date, text) TO authenticated;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pm_tasks_class_id ON public.pm_tasks(class_id);
CREATE INDEX IF NOT EXISTS idx_asset_class_spares_class_id ON public.asset_class_spares(class_id);
CREATE INDEX IF NOT EXISTS idx_pm_schedules_site_due ON public.pm_schedules(site_id, next_due_on);
CREATE INDEX IF NOT EXISTS idx_pm_schedules_asset_id ON public.pm_schedules(asset_id);
CREATE INDEX IF NOT EXISTS idx_pm_deferrals_schedule_id ON public.pm_deferrals(schedule_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_pm_schedule_id ON public.work_orders(pm_schedule_id);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TRIGGER IF EXISTS work_orders_advance_pm ON public.work_orders;
-- DROP FUNCTION IF EXISTS public.advance_pm_schedule, public.defer_pm, public.generate_due_pms, public.check_pm_schedule;
-- ALTER TABLE public.work_orders DROP COLUMN IF EXISTS pm_schedule_id;
-- DROP TABLE IF EXISTS public.pm_deferrals, public.pm_schedules, public.asset_class_spares, public.pm_tasks CASCADE;
-- ALTER TABLE public.asset_classes DROP CONSTRAINT IF EXISTS asset_classes_repeat_window_positive;
-- ALTER TABLE public.asset_classes DROP COLUMN IF EXISTS repeat_window_days, DROP COLUMN IF EXISTS run_to_failure;
-- DROP TYPE IF EXISTS public.pm_strategy;
