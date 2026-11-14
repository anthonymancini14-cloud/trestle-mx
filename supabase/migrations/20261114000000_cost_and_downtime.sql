-- Migration: 20261114000000_cost_and_downtime.sql
-- Purpose: What the EAM side needs from the CMMS before it can say anything:
--          what work costs and how long equipment was down.
--            - labor_rates: an hourly rate per craft per site, from a date.
--            - wo_labor: hours a person worked on a work order. The craft's
--              rate on the work date is fixed on the entry, so a later rate
--              change never rewrites what a job cost. Insert-only.
--            - wo_parts.unit_cost: the catalog price when the line was issued.
--            - asset_status_events: each change in an asset's operating
--              status. The asset's status follows its latest event. Insert-only.
--            - assets: replacement value, expected life, warranty end.
--          History starts when this is applied. Work orders closed earlier keep
--          their hours total but have no labor lines, so they show no cost;
--          an asset has no status history until its first recorded change.
-- Decisions: three sides on one database (TMX-030); rules for this slice to be
--            numbered in the decision log.

-- ============================================================
-- TABLE CREATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.labor_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  craft public.craft NOT NULL,
  hourly_rate numeric(10,2) NOT NULL CHECK (hourly_rate > 0),
  effective_from date NOT NULL DEFAULT current_date,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wo_labor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  -- Who did the work. Null for a crew that isn't on the roster.
  profile_id uuid REFERENCES public.profiles(id),
  craft public.craft NOT NULL,
  -- Person-hours. Negative corrects an earlier entry.
  hours numeric(7,2) NOT NULL CHECK (hours <> 0),
  work_date date NOT NULL DEFAULT current_date,
  note text,
  -- The craft's rate on the work date, set by trigger. Null if the site had no rate for the craft.
  hourly_rate numeric(10,2) CHECK (hourly_rate IS NULL OR hourly_rate > 0),
  entered_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A correction says what it corrects.
  CHECK (hours > 0 OR length(trim(coalesce(note, ''))) >= 3)
);

ALTER TABLE public.wo_parts
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2) CHECK (unit_cost IS NULL OR unit_cost >= 0);

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS replacement_value numeric(14,2) CHECK (replacement_value IS NULL OR replacement_value > 0),
  ADD COLUMN IF NOT EXISTS expected_life_years integer CHECK (expected_life_years IS NULL OR expected_life_years > 0),
  ADD COLUMN IF NOT EXISTS warranty_until date;

CREATE TABLE IF NOT EXISTS public.asset_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  status public.asset_status NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  -- The work order the change belongs to. Downtime that starts on preventive or project work counts as planned.
  wo_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  note text,
  recorded_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Issued lines from before this migration take today's catalog price: the best figure there is.
UPDATE public.wo_parts p SET unit_cost = c.unit_cost
FROM public.parts_catalog c
WHERE c.id = p.part_id AND p.status = 'issued' AND p.unit_cost IS NULL;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Check a labor entry and fix the craft's rate on it. Rows written with no
-- signed-in user (the seed script) are history: they keep their own rate and
-- skip the checks on stage and date.
CREATE OR REPLACE FUNCTION public.prepare_wo_labor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = NEW.wo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;

  IF NEW.profile_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.site_access WHERE user_id = NEW.profile_id AND site_id = v_wo.site_id) THEN
    RAISE EXCEPTION 'That person is not on this site''s roster';
  END IF;

  IF auth.uid() IS NULL AND NEW.hourly_rate IS NOT NULL THEN RETURN NEW; END IF;

  IF auth.uid() IS NOT NULL THEN
    IF v_wo.status <> 'open' OR v_wo.stage NOT IN ('execution', 'closure') THEN
      RAISE EXCEPTION 'Hours are logged while the work order is in Execution or Closure';
    END IF;
    IF abs(NEW.hours) > 24 THEN RAISE EXCEPTION 'Hours for one entry are between 0 and 24'; END IF;
    IF NEW.work_date > current_date + 1 OR NEW.work_date < v_wo.created_at::date - 1 THEN
      RAISE EXCEPTION 'The work date is between the day the work order was opened and today';
    END IF;
    IF NEW.hours < 0 AND coalesce((SELECT sum(hours) FROM public.wo_labor WHERE wo_id = NEW.wo_id), 0) + NEW.hours < 0 THEN
      RAISE EXCEPTION 'A correction can''t take the logged hours below zero';
    END IF;
  END IF;

  NEW.hourly_rate := (
    SELECT r.hourly_rate FROM public.labor_rates r
    WHERE r.site_id = v_wo.site_id AND r.craft = NEW.craft AND r.effective_from <= NEW.work_date
    ORDER BY r.effective_from DESC, r.created_at DESC
    LIMIT 1
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS wo_labor_prepare ON public.wo_labor;
CREATE TRIGGER wo_labor_prepare BEFORE INSERT ON public.wo_labor
  FOR EACH ROW EXECUTE FUNCTION public.prepare_wo_labor();

-- A work order's hours are the labor logged on it.
CREATE OR REPLACE FUNCTION public.sync_wo_hours()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.work_orders
  SET actual_hours = (SELECT sum(hours) FROM public.wo_labor WHERE wo_id = NEW.wo_id)
  WHERE id = NEW.wo_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS wo_labor_sync_hours ON public.wo_labor;
CREATE TRIGGER wo_labor_sync_hours AFTER INSERT ON public.wo_labor
  FOR EACH ROW EXECUTE FUNCTION public.sync_wo_hours();

-- Check a status change. A signed-in user's change starts now and has to be a
-- change; a work order named on it has to be on the same asset.
CREATE OR REPLACE FUNCTION public.prepare_asset_status_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current public.asset_status;
BEGIN
  IF NEW.wo_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.work_orders WHERE id = NEW.wo_id AND asset_id = NEW.asset_id) THEN
    RAISE EXCEPTION 'That work order is not on this asset';
  END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  -- The wall clock, not the transaction's start: two changes in one transaction still have an order.
  NEW.started_at := clock_timestamp();
  SELECT status INTO v_current FROM public.assets WHERE id = NEW.asset_id;
  IF v_current = NEW.status THEN RAISE EXCEPTION 'The asset is already %', NEW.status; END IF;
  IF v_current = 'retired' AND public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'This asset is retired. An admin can put it back in the register';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS asset_status_events_prepare ON public.asset_status_events;
CREATE TRIGGER asset_status_events_prepare BEFORE INSERT ON public.asset_status_events
  FOR EACH ROW EXECUTE FUNCTION public.prepare_asset_status_event();

-- The asset's status is its latest event.
CREATE OR REPLACE FUNCTION public.apply_asset_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.assets SET status = (
    SELECT e.status FROM public.asset_status_events e
    WHERE e.asset_id = NEW.asset_id
    ORDER BY e.started_at DESC, e.created_at DESC, e.id DESC
    LIMIT 1
  ) WHERE id = NEW.asset_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS asset_status_events_apply ON public.asset_status_events;
CREATE TRIGGER asset_status_events_apply AFTER INSERT ON public.asset_status_events
  FOR EACH ROW EXECUTE FUNCTION public.apply_asset_status();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.labor_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wo_labor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_status_events ENABLE ROW LEVEL SECURITY;

-- Rates are a craft's charge rate, not anyone's pay: everyone at the site reads them. An admin sets them.
DROP POLICY IF EXISTS "labor_rates: site-scoped read" ON public.labor_rates;
CREATE POLICY "labor_rates: site-scoped read" ON public.labor_rates
  FOR SELECT USING (site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "labor_rates: admins add" ON public.labor_rates;
CREATE POLICY "labor_rates: admins add" ON public.labor_rates
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND public.current_user_role() = 'admin'
    AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "wo_labor: site-scoped read" ON public.wo_labor;
CREATE POLICY "wo_labor: site-scoped read" ON public.wo_labor
  FOR SELECT USING (wo_id IN (SELECT id FROM public.work_orders));

-- A technician logs their own hours. A supervisor or admin logs anyone's.
DROP POLICY IF EXISTS "wo_labor: crew and supervisors add" ON public.wo_labor;
CREATE POLICY "wo_labor: crew and supervisors add" ON public.wo_labor
  FOR INSERT WITH CHECK (
    entered_by = auth.uid()
    AND wo_id IN (SELECT id FROM public.work_orders)
    AND (
      public.current_user_role() IN ('supervisor', 'admin')
      OR (public.current_user_role() = 'technician' AND profile_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "asset_status_events: site-scoped read" ON public.asset_status_events;
CREATE POLICY "asset_status_events: site-scoped read" ON public.asset_status_events
  FOR SELECT USING (asset_id IN (SELECT id FROM public.assets));

-- Anyone at the site records that equipment went down or came back. Retiring an asset is an admin's call.
DROP POLICY IF EXISTS "asset_status_events: site members add" ON public.asset_status_events;
CREATE POLICY "asset_status_events: site members add" ON public.asset_status_events
  FOR INSERT WITH CHECK (
    recorded_by = auth.uid()
    AND asset_id IN (SELECT id FROM public.assets)
    AND (status <> 'retired' OR public.current_user_role() = 'admin')
  );

-- No update or delete policies on any of the three: a rate change is a new
-- rate, a wrong entry is corrected by another entry, and history stays.

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Issue a reserved or kitted line from stock to the job. As before, and now
-- the catalog price is fixed on the line as it is issued.
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

  UPDATE public.wo_parts SET
    status = 'issued',
    qty_used = qty_required,
    unit_cost = (SELECT unit_cost FROM public.parts_catalog WHERE id = v_line.part_id)
  WHERE id = p_wo_part_id;
  INSERT INTO public.wo_events (wo_id, event_type, note, actor_id)
  VALUES (v_line.wo_id, 'part_issued', v_line.qty_required || ' x ' || v_line.description, auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.issue_work_order_part(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_work_order_part(uuid) TO authenticated;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_labor_rates_site_craft ON public.labor_rates(site_id, craft, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_wo_labor_wo ON public.wo_labor(wo_id);
CREATE INDEX IF NOT EXISTS idx_wo_labor_profile ON public.wo_labor(profile_id, work_date) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asset_status_events_asset ON public.asset_status_events(asset_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_status_events_wo ON public.asset_status_events(wo_id) WHERE wo_id IS NOT NULL;

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TABLE IF EXISTS public.asset_status_events, public.wo_labor, public.labor_rates CASCADE;
-- DROP FUNCTION IF EXISTS public.apply_asset_status(), public.prepare_asset_status_event(), public.sync_wo_hours(), public.prepare_wo_labor();
-- ALTER TABLE public.assets DROP COLUMN IF EXISTS replacement_value, DROP COLUMN IF EXISTS expected_life_years, DROP COLUMN IF EXISTS warranty_until;
-- ALTER TABLE public.wo_parts DROP COLUMN IF EXISTS unit_cost;
-- Re-create issue_work_order_part from 20260316000700 (without unit_cost).
