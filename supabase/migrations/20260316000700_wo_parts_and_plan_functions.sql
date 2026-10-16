-- Migration: 20260316000700_wo_parts_and_plan_functions.sql
-- Purpose: parts reserved/used on a work order, plus atomic plan-commit and issue functions
-- Phase: P1-7

-- ============================================================
-- TABLE CREATION
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.wo_part_status AS ENUM ('planned', 'reserved', 'kitted', 'issued');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.wo_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  part_id uuid REFERENCES public.parts_catalog(id),
  description text NOT NULL,
  qty_required numeric(10,2) NOT NULL CHECK (qty_required >= 0),
  qty_used numeric(10,2) NOT NULL DEFAULT 0 CHECK (qty_used >= 0),
  status public.wo_part_status NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS wo_parts_set_updated_at ON public.wo_parts;
CREATE TRIGGER wo_parts_set_updated_at BEFORE UPDATE ON public.wo_parts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.wo_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wo_parts: site-scoped read" ON public.wo_parts;
CREATE POLICY "wo_parts: site-scoped read" ON public.wo_parts
  FOR SELECT USING (
    wo_id IN (
      SELECT id FROM public.work_orders
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "wo_parts: planners, storeroom, supervisors write" ON public.wo_parts;
CREATE POLICY "wo_parts: planners, storeroom, supervisors write" ON public.wo_parts
  FOR ALL USING (
    public.current_user_role() IN ('planner', 'storeroom', 'supervisor', 'admin')
    AND wo_id IN (
      SELECT id FROM public.work_orders
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  ) WITH CHECK (
    public.current_user_role() IN ('planner', 'storeroom', 'supervisor', 'admin')
    AND wo_id IN (
      SELECT id FROM public.work_orders
      WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Commit a Planning Mode job plan in one transaction: replace tasks and parts,
-- release old reservations, reserve available stock, log, advance to Scheduling.
CREATE OR REPLACE FUNCTION public.commit_work_order_plan(p_wo_id uuid, p_plan jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wo public.work_orders%ROWTYPE;
  v_org uuid;
  v_part jsonb;
  v_part_id uuid;
  v_available numeric;
  v_qty numeric;
  v_hours numeric;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_wo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF v_wo.site_id NOT IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No access to this site';
  END IF;
  IF public.current_user_role() NOT IN ('planner', 'admin') THEN
    RAISE EXCEPTION 'Only planners commit job plans';
  END IF;
  IF v_wo.status <> 'open' OR v_wo.stage <> 'planning' THEN
    RAISE EXCEPTION 'Work order is not open in Planning';
  END IF;

  SELECT org_id INTO v_org FROM public.sites WHERE id = v_wo.site_id;

  -- Release reservations held by an earlier plan.
  UPDATE public.inventory i SET reserved = greatest(i.reserved - wp.qty_required, 0)
  FROM public.wo_parts wp
  WHERE wp.wo_id = p_wo_id AND wp.status = 'reserved' AND i.part_id = wp.part_id AND i.site_id = v_wo.site_id;
  DELETE FROM public.wo_parts WHERE wo_id = p_wo_id;
  DELETE FROM public.wo_tasks WHERE wo_id = p_wo_id;

  INSERT INTO public.wo_tasks (wo_id, seq, description, craft, crew_size, est_hours, safety_note, acceptance_criteria)
  SELECT p_wo_id, t.seq, t.description, t.craft::public.craft, t.crew_size, t.est_hours, t.safety_note, t.acceptance_criteria
  FROM jsonb_to_recordset(p_plan -> 'tasks') AS t(
    seq int, description text, craft text, crew_size int, est_hours numeric, safety_note text, acceptance_criteria text
  );

  FOR v_part IN SELECT * FROM jsonb_array_elements(p_plan -> 'parts') LOOP
    v_qty := (v_part ->> 'qty')::numeric;
    SELECT id INTO v_part_id FROM public.parts_catalog
      WHERE org_id = v_org AND part_number = v_part ->> 'part_number';
    SELECT on_hand - reserved INTO v_available FROM public.inventory
      WHERE site_id = v_wo.site_id AND part_id = v_part_id;

    IF v_part_id IS NOT NULL AND coalesce(v_available, 0) >= v_qty THEN
      UPDATE public.inventory SET reserved = reserved + v_qty
        WHERE site_id = v_wo.site_id AND part_id = v_part_id;
      INSERT INTO public.wo_parts (wo_id, part_id, description, qty_required, status)
      SELECT p_wo_id, v_part_id, description, v_qty, 'reserved' FROM public.parts_catalog WHERE id = v_part_id;
    ELSE
      INSERT INTO public.wo_parts (wo_id, part_id, description, qty_required, status)
      VALUES (p_wo_id, v_part_id, v_part ->> 'description', v_qty, 'planned');
    END IF;
  END LOOP;

  SELECT coalesce(sum(t.est_hours * t.crew_size), 0) INTO v_hours FROM public.wo_tasks t WHERE t.wo_id = p_wo_id;

  UPDATE public.work_orders SET
    stage = 'scheduling',
    plan_summary = p_plan ->> 'summary',
    requires_shutdown = coalesce((p_plan ->> 'requires_shutdown')::boolean, requires_shutdown),
    estimated_hours = v_hours,
    planner_id = auth.uid()
  WHERE id = p_wo_id;

  INSERT INTO public.wo_events (wo_id, event_type, from_stage, to_stage, note, actor_id)
  VALUES (p_wo_id, 'plan_committed', 'planning', 'scheduling', p_plan ->> 'summary', auth.uid());
END $$;

-- Issue a reserved or kitted line from stock to the job.
CREATE OR REPLACE FUNCTION public.issue_work_order_part(p_wo_part_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line public.wo_parts%ROWTYPE;
  v_site uuid;
BEGIN
  SELECT * INTO v_line FROM public.wo_parts WHERE id = p_wo_part_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Part line not found'; END IF;
  SELECT site_id INTO v_site FROM public.work_orders WHERE id = v_line.wo_id;
  IF v_site NOT IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No access to this site';
  END IF;
  IF public.current_user_role() NOT IN ('storeroom', 'technician', 'admin') THEN
    RAISE EXCEPTION 'Only storeroom or the crew issue parts';
  END IF;
  IF v_line.status = 'issued' THEN RETURN; END IF;

  IF v_line.part_id IS NOT NULL THEN
    UPDATE public.inventory SET
      reserved = CASE WHEN v_line.status IN ('reserved', 'kitted') THEN greatest(reserved - v_line.qty_required, 0) ELSE reserved END,
      on_hand = greatest(on_hand - v_line.qty_required, 0)
    WHERE site_id = v_site AND part_id = v_line.part_id;
  END IF;

  UPDATE public.wo_parts SET status = 'issued', qty_used = qty_required WHERE id = p_wo_part_id;
  INSERT INTO public.wo_events (wo_id, event_type, note, actor_id)
  VALUES (v_line.wo_id, 'part_issued', v_line.qty_required || ' x ' || v_line.description, auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.commit_work_order_plan(uuid, jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_work_order_part(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.commit_work_order_plan(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_work_order_part(uuid) TO authenticated;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_wo_parts_wo_id ON public.wo_parts(wo_id);
CREATE INDEX IF NOT EXISTS idx_wo_parts_part_id ON public.wo_parts(part_id);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP FUNCTION IF EXISTS public.commit_work_order_plan(uuid, jsonb), public.issue_work_order_part(uuid);
-- DROP TABLE IF EXISTS public.wo_parts CASCADE;
-- DROP TYPE IF EXISTS public.wo_part_status;
