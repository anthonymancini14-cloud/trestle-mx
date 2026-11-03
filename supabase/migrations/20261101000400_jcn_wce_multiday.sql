-- Migration: 20261101000400_jcn_wce_multiday.sql
-- Purpose: Job control numbers and work center events (after the Air Force
--          system), multi-day work, parts expected dates, process controls craft.
--          - JCN = YY + Julian day + the site's 4-digit job ID (263045000). The
--            job ID counts up from the site's block each day.
--          - Every work order is a WCE on a JCN: wo_number = JCN-NNN. Each WCE
--            runs the full lifecycle on its own; -001 closes last.
--          - A WCE that can't be finished is closed as deferred and its work is
--            written up under a new JCN ("Corrective action deferred, see JCN …").
--          - Plan steps carry a day, so a WCE can span several days.
--          - Short parts carry an expected date (from the catalog lead time).
-- Decisions: TMX-019 to TMX-023

-- ============================================================
-- TYPES AND COLUMNS
-- ============================================================

ALTER TYPE public.craft ADD VALUE IF NOT EXISTS 'process_controls' AFTER 'instrumentation';

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS jcn_block integer NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE public.sites ADD CONSTRAINT sites_jcn_block_range CHECK (jcn_block BETWEEN 0 AND 9999);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS jcn text,
  ADD COLUMN IF NOT EXISTS wce_seq integer,
  ADD COLUMN IF NOT EXISTS deferred_to_jcn text,
  ADD COLUMN IF NOT EXISTS deferred_from_wo_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL;

ALTER TABLE public.wo_tasks
  ADD COLUMN IF NOT EXISTS day smallint NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE public.wo_tasks ADD CONSTRAINT wo_tasks_day_range CHECK (day BETWEEN 1 AND 30);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.wo_parts ADD COLUMN IF NOT EXISTS expected_on date;
ALTER TABLE public.parts_catalog ADD COLUMN IF NOT EXISTS lead_time_days integer;
DO $$ BEGIN
  ALTER TABLE public.parts_catalog ADD CONSTRAINT parts_catalog_lead_time_nonneg CHECK (lead_time_days IS NULL OR lead_time_days >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- NUMBERING
-- ============================================================

-- YY + Julian day for a date: 2026-10-31 → '26304'.
CREATE OR REPLACE FUNCTION public.jcn_prefix(p_date date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_date, 'YY') || lpad(extract(doy FROM p_date)::text, 3, '0');
$$;

-- Backfill: existing work orders become WCE -001 of their own JCN, numbered by
-- the day they were written up (site time zone) in the order they were.
WITH numbered AS (
  SELECT w.id,
         public.jcn_prefix((w.created_at AT TIME ZONE s.timezone)::date) AS prefix,
         s.jcn_block + row_number() OVER (
           PARTITION BY w.site_id, public.jcn_prefix((w.created_at AT TIME ZONE s.timezone)::date)
           ORDER BY w.created_at, w.id
         ) - 1 AS job_id
  FROM public.work_orders w JOIN public.sites s ON s.id = w.site_id
  WHERE w.jcn IS NULL
)
UPDATE public.work_orders w
SET jcn = n.prefix || lpad(n.job_id::text, 4, '0'),
    wce_seq = 1,
    wo_number = n.prefix || lpad(n.job_id::text, 4, '0') || '-001'
FROM numbered n WHERE n.id = w.id;

ALTER TABLE public.work_orders ALTER COLUMN jcn SET NOT NULL;
ALTER TABLE public.work_orders ALTER COLUMN wce_seq SET NOT NULL;
-- The trigger below numbers new rows; the old WO-YY-NNNN default is retired.
ALTER TABLE public.work_orders ALTER COLUMN wo_number DROP DEFAULT;
DO $$ BEGIN
  ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_jcn_format CHECK (jcn ~ '^\d{9}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_wce_unique UNIQUE (site_id, jcn, wce_seq);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_wce_seq_range CHECK (wce_seq BETWEEN 1 AND 999);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Number a new work order. No JCN given: a new discrepancy, so a new JCN for
-- today at the site with the next job ID from its block, as WCE -001. JCN
-- given: another shop's WCE on that job, next -NNN, only while -001 is open.
-- A number given with a JCN is ignored for signed-in users.
-- A per-site advisory lock keeps two inserts from taking the same number.
CREATE OR REPLACE FUNCTION public.assign_jcn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_site public.sites%ROWTYPE; v_prefix text; v_max integer; v_primary_status public.wo_status;
BEGIN
  -- Loading history with a service key (no signed-in user): keep the given number.
  IF auth.uid() IS NULL AND NEW.jcn IS NOT NULL AND NEW.wce_seq IS NOT NULL THEN
    NEW.wo_number := NEW.jcn || '-' || lpad(NEW.wce_seq::text, 3, '0');
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('jcn:' || NEW.site_id::text));
  SELECT * INTO v_site FROM public.sites WHERE id = NEW.site_id;
  IF NEW.jcn IS NULL THEN
    v_prefix := public.jcn_prefix((now() AT TIME ZONE v_site.timezone)::date);
    SELECT max(substr(jcn, 6)::integer) INTO v_max FROM public.work_orders WHERE site_id = NEW.site_id AND jcn LIKE v_prefix || '%';
    IF coalesce(v_max + 1, v_site.jcn_block) > 9999 THEN RAISE EXCEPTION 'No job IDs left today at this site'; END IF;
    NEW.jcn := v_prefix || lpad(coalesce(v_max + 1, v_site.jcn_block)::text, 4, '0');
    NEW.wce_seq := 1;
  ELSE
    SELECT status INTO v_primary_status FROM public.work_orders WHERE site_id = NEW.site_id AND jcn = NEW.jcn AND wce_seq = 1;
    IF v_primary_status IS NULL THEN RAISE EXCEPTION 'JCN % not found at this site', NEW.jcn; END IF;
    IF v_primary_status <> 'open' THEN RAISE EXCEPTION 'JCN % is closed', NEW.jcn; END IF;
    SELECT max(wce_seq) + 1 INTO NEW.wce_seq FROM public.work_orders WHERE site_id = NEW.site_id AND jcn = NEW.jcn;
  END IF;
  NEW.wo_number := NEW.jcn || '-' || lpad(NEW.wce_seq::text, 3, '0');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS work_orders_assign_jcn ON public.work_orders;
CREATE TRIGGER work_orders_assign_jcn BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.assign_jcn();

-- The number never changes after it is assigned.
CREATE OR REPLACE FUNCTION public.freeze_jcn()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.jcn IS DISTINCT FROM OLD.jcn OR NEW.wce_seq IS DISTINCT FROM OLD.wce_seq OR NEW.wo_number IS DISTINCT FROM OLD.wo_number THEN
    RAISE EXCEPTION 'A JCN and WCE number never change';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS work_orders_freeze_jcn ON public.work_orders;
CREATE TRIGGER work_orders_freeze_jcn BEFORE UPDATE OF jcn, wce_seq, wo_number ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.freeze_jcn();

-- WCE -001 closes last: every other WCE on the JCN must be closed or rejected first.
CREATE OR REPLACE FUNCTION public.primary_wce_closes_last()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' AND NEW.wce_seq = 1
     AND EXISTS (SELECT 1 FROM public.work_orders w WHERE w.site_id = NEW.site_id AND w.jcn = NEW.jcn AND w.id <> NEW.id AND w.status = 'open') THEN
    RAISE EXCEPTION 'WCE -001 closes last: close the other WCEs on JCN % first', NEW.jcn;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS work_orders_primary_closes_last ON public.work_orders;
CREATE TRIGGER work_orders_primary_closes_last BEFORE UPDATE OF status ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.primary_wce_closes_last();

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Close a WCE as deferred. Supervisors and admins; the WCE must be open in
-- Scheduling, Execution or Closure. The remaining work is written up under a
-- new JCN (its -001 starts in Vetting) and this WCE is signed off with
-- "Corrective action deferred, see JCN …". Parts it held go back to stock.
CREATE OR REPLACE FUNCTION public.defer_work_order(p_wo_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders%ROWTYPE; v_new uuid; v_new_jcn text; v_note text;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_wo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF v_wo.site_id NOT IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No access to this site';
  END IF;
  IF public.current_user_role() NOT IN ('supervisor', 'admin') THEN
    RAISE EXCEPTION 'Deferring a WCE needs a supervisor';
  END IF;
  IF v_wo.status <> 'open' OR v_wo.stage NOT IN ('scheduling', 'execution', 'closure') THEN
    RAISE EXCEPTION 'Only open WCEs in Scheduling, Execution or Closure can be deferred';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Give the reason the work is deferred';
  END IF;

  INSERT INTO public.work_orders (site_id, title, description, asset_id, wo_type, priority, stage, status, requires_shutdown, reported_by, deferred_from_wo_id)
  VALUES (
    v_wo.site_id, v_wo.title,
    'Deferred from WCE ' || v_wo.wo_number || ': ' || p_reason || E'\n\n' || v_wo.description,
    v_wo.asset_id, CASE WHEN v_wo.wo_type = 'preventive' THEN 'corrective' ELSE v_wo.wo_type END,
    v_wo.priority, 'vetting', 'open', v_wo.requires_shutdown, auth.uid(), v_wo.id
  ) RETURNING id, jcn INTO v_new, v_new_jcn;
  INSERT INTO public.wo_events (wo_id, event_type, from_stage, to_stage, note, actor_id)
  VALUES (v_new, 'created', NULL, 'vetting', 'Written up from deferred WCE ' || v_wo.wo_number, auth.uid());

  UPDATE public.inventory i SET reserved = greatest(i.reserved - wp.qty_required, 0)
  FROM public.wo_parts wp
  WHERE wp.wo_id = p_wo_id AND wp.status IN ('reserved', 'kitted') AND i.part_id = wp.part_id AND i.site_id = v_wo.site_id;
  UPDATE public.wo_parts SET status = 'planned' WHERE wo_id = p_wo_id AND status IN ('reserved', 'kitted');

  v_note := 'Corrective action deferred, see JCN ' || v_new_jcn || '. ' || trim(p_reason);
  UPDATE public.work_orders SET status = 'closed', debrief = v_note, deferred_to_jcn = v_new_jcn, closed_at = now() WHERE id = p_wo_id;
  INSERT INTO public.wo_events (wo_id, event_type, from_stage, to_stage, note, actor_id)
  VALUES (p_wo_id, 'closed', v_wo.stage, NULL, v_note, auth.uid());
  RETURN v_new;
END $$;

-- Commit a plan: as before, plus each step's day and an expected date for parts
-- the storeroom can't cover (today plus the catalog lead time, when known).
CREATE OR REPLACE FUNCTION public.commit_work_order_plan(p_wo_id uuid, p_plan jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wo public.work_orders%ROWTYPE;
  v_org uuid;
  v_part jsonb;
  v_part_id uuid;
  v_lead integer;
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

  UPDATE public.inventory i SET reserved = greatest(i.reserved - wp.qty_required, 0)
  FROM public.wo_parts wp
  WHERE wp.wo_id = p_wo_id AND wp.status = 'reserved' AND i.part_id = wp.part_id AND i.site_id = v_wo.site_id;
  DELETE FROM public.wo_parts WHERE wo_id = p_wo_id;
  DELETE FROM public.wo_tasks WHERE wo_id = p_wo_id;

  INSERT INTO public.wo_tasks (wo_id, seq, day, description, craft, crew_size, est_hours, safety_note, acceptance_criteria)
  SELECT p_wo_id, t.seq, coalesce(t.day, 1), t.description, t.craft::public.craft, t.crew_size, t.est_hours, t.safety_note, t.acceptance_criteria
  FROM jsonb_to_recordset(p_plan -> 'tasks') AS t(
    seq int, day int, description text, craft text, crew_size int, est_hours numeric, safety_note text, acceptance_criteria text
  );

  FOR v_part IN SELECT * FROM jsonb_array_elements(p_plan -> 'parts') LOOP
    v_qty := (v_part ->> 'qty')::numeric;
    v_part_id := NULL; v_lead := NULL;
    SELECT id, lead_time_days INTO v_part_id, v_lead FROM public.parts_catalog
      WHERE org_id = v_org AND part_number = v_part ->> 'part_number';
    SELECT on_hand - reserved INTO v_available FROM public.inventory
      WHERE site_id = v_wo.site_id AND part_id = v_part_id;

    IF v_part_id IS NOT NULL AND coalesce(v_available, 0) >= v_qty THEN
      UPDATE public.inventory SET reserved = reserved + v_qty
        WHERE site_id = v_wo.site_id AND part_id = v_part_id;
      INSERT INTO public.wo_parts (wo_id, part_id, description, qty_required, status)
      SELECT p_wo_id, v_part_id, description, v_qty, 'reserved' FROM public.parts_catalog WHERE id = v_part_id;
    ELSE
      INSERT INTO public.wo_parts (wo_id, part_id, description, qty_required, status, expected_on)
      VALUES (p_wo_id, v_part_id, v_part ->> 'description', v_qty, 'planned', CASE WHEN v_lead IS NOT NULL THEN current_date + v_lead END);
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

REVOKE ALL ON FUNCTION public.defer_work_order(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.defer_work_order(uuid, text) TO authenticated;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_work_orders_site_jcn ON public.work_orders(site_id, jcn);
CREATE INDEX IF NOT EXISTS idx_wo_parts_wo_id_status ON public.wo_parts(wo_id, status);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TRIGGER IF EXISTS work_orders_primary_closes_last ON public.work_orders;
-- DROP TRIGGER IF EXISTS work_orders_freeze_jcn ON public.work_orders;
-- DROP TRIGGER IF EXISTS work_orders_assign_jcn ON public.work_orders;
-- DROP FUNCTION IF EXISTS public.defer_work_order, public.primary_wce_closes_last, public.freeze_jcn, public.assign_jcn, public.jcn_prefix;
-- Re-apply commit_work_order_plan from 20260316000700 to drop the day and expected_on handling.
-- ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_wce_unique, DROP CONSTRAINT IF EXISTS work_orders_jcn_format,
--   DROP CONSTRAINT IF EXISTS work_orders_wce_seq_range, DROP COLUMN IF EXISTS deferred_from_wo_id,
--   DROP COLUMN IF EXISTS deferred_to_jcn, DROP COLUMN IF EXISTS wce_seq, DROP COLUMN IF EXISTS jcn;
-- ALTER TABLE public.work_orders ALTER COLUMN wo_number SET DEFAULT ('WO-' || to_char(now(), 'YY') || '-' || nextval('public.wo_number_seq'));
-- ALTER TABLE public.wo_tasks DROP COLUMN IF EXISTS day; ALTER TABLE public.wo_parts DROP COLUMN IF EXISTS expected_on;
-- ALTER TABLE public.parts_catalog DROP COLUMN IF EXISTS lead_time_days; ALTER TABLE public.sites DROP COLUMN IF EXISTS jcn_block;
-- The 'process_controls' craft value stays (Postgres can't drop an enum value).
