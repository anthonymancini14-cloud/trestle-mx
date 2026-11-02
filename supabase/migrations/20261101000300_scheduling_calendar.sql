-- Migration: 20261101000300_scheduling_calendar.sql
-- Purpose: Scheduling calendar. Who schedules is a site setting (admin always
--          can); capacity comes from the technician roster (shift hours and
--          work days, less time off); scheduling and rescheduling go through
--          functions that check the setting and write the audit trail. The
--          calendar itself is computed from work_orders and pm_schedules, so
--          it has no table of its own.
-- Decisions: TMX-015 to TMX-018

-- ============================================================
-- TYPES AND COLUMNS
-- ============================================================

-- New audit event. Not used inside this transaction, so ADD VALUE is safe here.
ALTER TYPE public.wo_event_type ADD VALUE IF NOT EXISTS 'rescheduled';

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS scheduler_roles public.user_role[] NOT NULL DEFAULT '{supervisor}';

-- ============================================================
-- TABLE CREATION
-- ============================================================

-- A technician's regular shift at a site. work_days: 0 = Sunday … 6 = Saturday.
CREATE TABLE IF NOT EXISTS public.crew_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shift_hours numeric(4,1) NOT NULL CHECK (shift_hours > 0 AND shift_hours <= 16),
  work_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'
    CHECK (work_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[] AND cardinality(work_days) BETWEEN 1 AND 7),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, profile_id)
);

-- Time away. hours_per_day NULL means the whole shift. Dates are inclusive.
-- Append-only: no update or delete policy.
CREATE TABLE IF NOT EXISTS public.time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  hours_per_day numeric(4,1) CHECK (hours_per_day IS NULL OR (hours_per_day > 0 AND hours_per_day <= 16)),
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);

DROP TRIGGER IF EXISTS crew_shifts_set_updated_at ON public.crew_shifts;
CREATE TRIGGER crew_shifts_set_updated_at BEFORE UPDATE ON public.crew_shifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- HELPERS
-- ============================================================

-- True when the caller may schedule at the site: has access there and is an
-- admin or holds one of the site's scheduler roles.
CREATE OR REPLACE FUNCTION public.can_schedule(p_site_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.site_access WHERE user_id = auth.uid() AND site_id = p_site_id)
     AND (
       public.current_user_role() = 'admin'
       OR public.current_user_role() = ANY (coalesce((SELECT scheduler_roles FROM public.sites WHERE id = p_site_id), '{}'))
     );
$$;

-- Roster rows only for people who work at the site.
CREATE OR REPLACE FUNCTION public.check_roster_member()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.site_access WHERE user_id = NEW.profile_id AND site_id = NEW.site_id) THEN
    RAISE EXCEPTION 'That person does not work at this site';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS crew_shifts_check ON public.crew_shifts;
CREATE TRIGGER crew_shifts_check BEFORE INSERT OR UPDATE OF site_id, profile_id ON public.crew_shifts
  FOR EACH ROW EXECUTE FUNCTION public.check_roster_member();
DROP TRIGGER IF EXISTS time_off_check ON public.time_off;
CREATE TRIGGER time_off_check BEFORE INSERT ON public.time_off
  FOR EACH ROW EXECUTE FUNCTION public.check_roster_member();

-- The date and the assignee change only for someone who can schedule. Other
-- roles can still update a work order (the existing policy); this guards the
-- two scheduling fields. Service-role scripts (auth.uid() null) pass.
CREATE OR REPLACE FUNCTION public.guard_schedule_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
     AND NOT public.can_schedule(NEW.site_id) THEN
    RAISE EXCEPTION 'Only a scheduler at this site can change the date or the assignee';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS work_orders_guard_schedule ON public.work_orders;
CREATE TRIGGER work_orders_guard_schedule BEFORE UPDATE OF scheduled_date, assigned_to ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_schedule_fields();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.crew_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_off ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crew_shifts: site-scoped read" ON public.crew_shifts;
CREATE POLICY "crew_shifts: site-scoped read" ON public.crew_shifts
  FOR SELECT USING (site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "crew_shifts: schedulers insert" ON public.crew_shifts;
CREATE POLICY "crew_shifts: schedulers insert" ON public.crew_shifts
  FOR INSERT WITH CHECK (public.can_schedule(site_id));

DROP POLICY IF EXISTS "crew_shifts: schedulers update" ON public.crew_shifts;
CREATE POLICY "crew_shifts: schedulers update" ON public.crew_shifts
  FOR UPDATE USING (public.can_schedule(site_id)) WITH CHECK (public.can_schedule(site_id));

DROP POLICY IF EXISTS "time_off: site-scoped read" ON public.time_off;
CREATE POLICY "time_off: site-scoped read" ON public.time_off
  FOR SELECT USING (site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "time_off: schedulers add" ON public.time_off;
CREATE POLICY "time_off: schedulers add" ON public.time_off
  FOR INSERT WITH CHECK (public.can_schedule(site_id) AND created_by = auth.uid());

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Admin only: which roles schedule at this site. Admin is implied, not stored.
CREATE OR REPLACE FUNCTION public.set_scheduler_roles(p_site_id uuid, p_roles public.user_role[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.site_access WHERE user_id = auth.uid() AND site_id = p_site_id) THEN
    RAISE EXCEPTION 'No access to this site';
  END IF;
  IF public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only an admin changes who schedules';
  END IF;
  UPDATE public.sites
    SET scheduler_roles = ARRAY(SELECT DISTINCT r FROM unnest(p_roles) r WHERE r <> 'admin')
    WHERE id = p_site_id;
END $$;

-- Give a planned job its date and technician; moves it to Execution and kits its parts.
CREATE OR REPLACE FUNCTION public.schedule_work_order(p_wo_id uuid, p_date date, p_assignee uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders%ROWTYPE; v_name text;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_wo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF NOT public.can_schedule(v_wo.site_id) THEN RAISE EXCEPTION 'Only a scheduler at this site can schedule work'; END IF;
  IF v_wo.status <> 'open' OR v_wo.stage <> 'scheduling' THEN
    RAISE EXCEPTION 'Only open work in Scheduling can be scheduled';
  END IF;
  SELECT p.full_name INTO v_name FROM public.profiles p
    JOIN public.site_access a ON a.user_id = p.id AND a.site_id = v_wo.site_id
    WHERE p.id = p_assignee AND p.role = 'technician' AND p.is_active;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Assign an active technician at this site'; END IF;

  UPDATE public.work_orders SET scheduled_date = p_date, assigned_to = p_assignee, stage = 'execution' WHERE id = p_wo_id;
  UPDATE public.wo_parts SET status = 'kitted' WHERE wo_id = p_wo_id AND status = 'reserved';
  INSERT INTO public.wo_events (wo_id, event_type, from_stage, to_stage, note, actor_id)
  VALUES (p_wo_id, 'scheduled', 'scheduling', 'execution', p_date || ', ' || v_name, auth.uid());
END $$;

-- Move a scheduled job to another day (drag on the calendar). Logged with from → to.
CREATE OR REPLACE FUNCTION public.reschedule_work_order(p_wo_id uuid, p_date date, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_wo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF NOT public.can_schedule(v_wo.site_id) THEN RAISE EXCEPTION 'Only a scheduler at this site can move work'; END IF;
  IF v_wo.status <> 'open' OR v_wo.stage <> 'execution' OR v_wo.scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Only scheduled work can be moved';
  END IF;
  IF p_date = v_wo.scheduled_date THEN RETURN; END IF;

  UPDATE public.work_orders SET scheduled_date = p_date WHERE id = p_wo_id;
  INSERT INTO public.wo_events (wo_id, event_type, note, actor_id)
  VALUES (
    p_wo_id, 'rescheduled',
    v_wo.scheduled_date || ' → ' || p_date || coalesce(': ' || nullif(trim(p_reason), ''), ''),
    auth.uid()
  );
END $$;

REVOKE ALL ON FUNCTION public.can_schedule(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_scheduler_roles(uuid, public.user_role[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_work_order(uuid, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reschedule_work_order(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_scheduler_roles(uuid, public.user_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_work_order(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_work_order(uuid, date, text) TO authenticated;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_crew_shifts_site_id ON public.crew_shifts(site_id);
CREATE INDEX IF NOT EXISTS idx_time_off_site_dates ON public.time_off(site_id, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_work_orders_site_scheduled ON public.work_orders(site_id, scheduled_date) WHERE status = 'open';

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TRIGGER IF EXISTS work_orders_guard_schedule ON public.work_orders;
-- DROP FUNCTION IF EXISTS public.reschedule_work_order, public.schedule_work_order, public.set_scheduler_roles,
--   public.guard_schedule_fields, public.check_roster_member, public.can_schedule;
-- DROP TABLE IF EXISTS public.time_off, public.crew_shifts CASCADE;
-- ALTER TABLE public.sites DROP COLUMN IF EXISTS scheduler_roles;
-- The 'rescheduled' enum value stays (Postgres can't drop an enum value); it is harmless unused.
