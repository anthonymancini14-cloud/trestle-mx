-- Migration: 20261102000100_troubleshooting_record.sql
-- Purpose: The troubleshooting record, one per WCE: what the operator saw and
--          tried (discrepancy_actions), each test the tradesman made
--          (wo_findings), and the proven cause with the findings behind it and
--          the test that proves the fix (wo_resolutions). Failure mechanisms
--          and causes are a controlled list (failure_codes, after ISO 14224).
--          Entries are insert-only; corrections are new entries that point at
--          the one they correct. Closed work orders take addenda, never edits.
--          WCE -001 of corrective work can't close without evidence.
-- Decisions: TMX-006 to TMX-009

-- ============================================================
-- TABLE CREATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.failure_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Null: org-wide. Set: specific to one asset class.
  class_id uuid REFERENCES public.asset_classes(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('mechanism', 'cause')),
  code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (org_id, class_id, kind, code)
);

CREATE TABLE IF NOT EXISTS public.discrepancy_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  conditions text NOT NULL CHECK (length(trim(conditions)) >= 3),
  action text NOT NULL CHECK (length(trim(action)) >= 3),
  result text NOT NULL CHECK (length(trim(result)) >= 2),
  ran_minutes integer CHECK (ran_minutes IS NULL OR ran_minutes >= 0),
  corrects_id uuid REFERENCES public.discrepancy_actions(id),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wo_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  test text NOT NULL CHECK (length(trim(test)) >= 3),
  value numeric,
  unit text,
  spec text,
  result text NOT NULL CHECK (result IN ('pass', 'fail', 'info')),
  note text,
  corrects_id uuid REFERENCES public.wo_findings(id),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wo_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  failure_mode text,
  mechanism text,
  cause text,
  no_fault_found boolean NOT NULL DEFAULT false,
  cause_narrative text NOT NULL CHECK (length(trim(cause_narrative)) >= 10),
  remedy text NOT NULL DEFAULT '',
  verification text,
  verification_passed boolean,
  operator_review text NOT NULL DEFAULT 'none_taken' CHECK (operator_review IN ('helped', 'masked', 'no_effect', 'none_taken')),
  operator_review_note text,
  supersedes_id uuid REFERENCES public.wo_resolutions(id),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A cause needs a fix and a test of the fix; "no fault found" needs neither.
  CHECK (no_fault_found OR (failure_mode IS NOT NULL AND cause IS NOT NULL AND length(trim(remedy)) >= 5 AND verification IS NOT NULL AND verification_passed IS NOT NULL))
);

-- The findings that support a resolution's cause.
CREATE TABLE IF NOT EXISTS public.wo_resolution_findings (
  resolution_id uuid NOT NULL REFERENCES public.wo_resolutions(id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES public.wo_findings(id) ON DELETE CASCADE,
  PRIMARY KEY (resolution_id, finding_id)
);

CREATE TABLE IF NOT EXISTS public.wo_addenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(trim(body)) >= 5),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- CHECKS
-- ============================================================

-- A correction points at an entry on the same work order.
CREATE OR REPLACE FUNCTION public.check_record_correction()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_wo uuid;
BEGIN
  IF NEW.corrects_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT wo_id FROM public.%I WHERE id = $1', TG_TABLE_NAME) INTO v_wo USING NEW.corrects_id;
  IF v_wo IS DISTINCT FROM NEW.wo_id THEN
    RAISE EXCEPTION 'A correction must reference an entry on the same work order';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS discrepancy_actions_correction ON public.discrepancy_actions;
CREATE TRIGGER discrepancy_actions_correction BEFORE INSERT ON public.discrepancy_actions
  FOR EACH ROW EXECUTE FUNCTION public.check_record_correction();
DROP TRIGGER IF EXISTS wo_findings_correction ON public.wo_findings;
CREATE TRIGGER wo_findings_correction BEFORE INSERT ON public.wo_findings
  FOR EACH ROW EXECUTE FUNCTION public.check_record_correction();

-- Evidence to close (TMX-006): corrective or emergency WCE -001 needs a current
-- resolution that is "no fault found" or has a coded cause and a linked finding.
-- A deferral (deferred_to_jcn set) closes without one.
CREATE OR REPLACE FUNCTION public.evidence_to_close()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_res public.wo_resolutions%ROWTYPE;
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' AND NEW.wce_seq = 1
     AND NEW.wo_type IN ('corrective', 'emergency') AND NEW.deferred_to_jcn IS NULL THEN
    SELECT * INTO v_res FROM public.wo_resolutions WHERE wo_id = NEW.id ORDER BY created_at DESC, id DESC LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Evidence to close: record the resolution for WCE % first', NEW.wo_number;
    END IF;
    IF NOT v_res.no_fault_found AND NOT EXISTS (SELECT 1 FROM public.wo_resolution_findings WHERE resolution_id = v_res.id) THEN
      RAISE EXCEPTION 'Evidence to close: link a finding that supports the cause, or record no fault found';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS work_orders_evidence_to_close ON public.work_orders;
CREATE TRIGGER work_orders_evidence_to_close BEFORE UPDATE OF status ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.evidence_to_close();

-- Operators move a discrepancy to vetting, so they join the roles that update work orders.
DROP POLICY IF EXISTS "work_orders: work roles update" ON public.work_orders;
CREATE POLICY "work_orders: work roles update" ON public.work_orders
  FOR UPDATE USING (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    AND public.current_user_role() IN ('admin', 'supervisor', 'planner', 'gatekeeper', 'technician', 'operator')
  ) WITH CHECK (
    site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
  );

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.failure_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discrepancy_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wo_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wo_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wo_resolution_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wo_addenda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "failure_codes: org-scoped read" ON public.failure_codes;
CREATE POLICY "failure_codes: org-scoped read" ON public.failure_codes
  FOR SELECT USING (org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())));
DROP POLICY IF EXISTS "failure_codes: admins write" ON public.failure_codes;
CREATE POLICY "failure_codes: admins write" ON public.failure_codes
  FOR ALL USING (
    public.current_user_role() = 'admin'
    AND org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  ) WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id IN (SELECT org_id FROM public.sites WHERE id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );

-- Read: anyone at the work order's site.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['discrepancy_actions', 'wo_findings', 'wo_resolutions', 'wo_addenda'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s: site-scoped read" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s: site-scoped read" ON public.%I FOR SELECT USING (wo_id IN (SELECT id FROM public.work_orders WHERE site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())))',
      t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "wo_resolution_findings: site-scoped read" ON public.wo_resolution_findings;
CREATE POLICY "wo_resolution_findings: site-scoped read" ON public.wo_resolution_findings
  FOR SELECT USING (resolution_id IN (SELECT id FROM public.wo_resolutions));

-- Write: insert-only, as yourself, on an open work order at your site, by role.
-- No update or delete policies: entries are never edited.
DROP POLICY IF EXISTS "discrepancy_actions: operators add" ON public.discrepancy_actions;
CREATE POLICY "discrepancy_actions: operators add" ON public.discrepancy_actions
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND public.current_user_role() IN ('operator', 'supervisor', 'admin')
    AND wo_id IN (SELECT id FROM public.work_orders WHERE status = 'open' AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "wo_findings: technicians add" ON public.wo_findings;
CREATE POLICY "wo_findings: technicians add" ON public.wo_findings
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND public.current_user_role() IN ('technician', 'supervisor', 'admin')
    AND wo_id IN (SELECT id FROM public.work_orders WHERE status = 'open' AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()))
  );

-- Addenda (TMX-007): supervisor, planner, admin, or the technician who worked the job; closed work orders only.
DROP POLICY IF EXISTS "wo_addenda: closed work, named roles add" ON public.wo_addenda;
CREATE POLICY "wo_addenda: closed work, named roles add" ON public.wo_addenda
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND wo_id IN (
      SELECT id FROM public.work_orders
      WHERE status = 'closed'
        AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
        AND (public.current_user_role() IN ('supervisor', 'planner', 'admin')
             OR (public.current_user_role() = 'technician' AND assigned_to = auth.uid()))
    )
  );

-- Resolutions go through record_resolution() so the finding links are written with them.

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Record a resolution (or supersede the current one). Technicians, supervisors
-- and admins; open work in Execution or Closure; linked findings must be on
-- the same work order.
CREATE OR REPLACE FUNCTION public.record_resolution(p_wo_id uuid, p_resolution jsonb, p_finding_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wo public.work_orders%ROWTYPE; v_prev uuid; v_id uuid;
BEGIN
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_wo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found'; END IF;
  IF v_wo.site_id NOT IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'No access to this site';
  END IF;
  IF public.current_user_role() NOT IN ('technician', 'supervisor', 'admin') THEN
    RAISE EXCEPTION 'Resolutions are recorded by technicians and supervisors';
  END IF;
  IF v_wo.status <> 'open' OR v_wo.stage NOT IN ('execution', 'closure') THEN
    RAISE EXCEPTION 'Record the resolution while the work order is open in Execution or Closure';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_finding_ids, '{}')) f
             WHERE NOT EXISTS (SELECT 1 FROM public.wo_findings w WHERE w.id = f AND w.wo_id = p_wo_id)) THEN
    RAISE EXCEPTION 'Linked findings must be on this work order';
  END IF;

  SELECT id INTO v_prev FROM public.wo_resolutions WHERE wo_id = p_wo_id ORDER BY created_at DESC, id DESC LIMIT 1;
  INSERT INTO public.wo_resolutions (
    wo_id, failure_mode, mechanism, cause, no_fault_found, cause_narrative, remedy,
    verification, verification_passed, operator_review, operator_review_note, supersedes_id, created_by
  ) VALUES (
    p_wo_id, p_resolution ->> 'failure_mode', p_resolution ->> 'mechanism', p_resolution ->> 'cause',
    coalesce((p_resolution ->> 'no_fault_found')::boolean, false), p_resolution ->> 'cause_narrative',
    coalesce(p_resolution ->> 'remedy', ''), p_resolution ->> 'verification', (p_resolution ->> 'verification_passed')::boolean,
    coalesce(p_resolution ->> 'operator_review', 'none_taken'), p_resolution ->> 'operator_review_note', v_prev, auth.uid()
  ) RETURNING id INTO v_id;
  INSERT INTO public.wo_resolution_findings (resolution_id, finding_id)
  SELECT v_id, f FROM unnest(coalesce(p_finding_ids, '{}')) f;
  INSERT INTO public.wo_events (wo_id, event_type, note, actor_id)
  VALUES (p_wo_id, 'note', 'Resolution recorded: ' || CASE WHEN coalesce((p_resolution ->> 'no_fault_found')::boolean, false) THEN 'no fault found' ELSE p_resolution ->> 'cause_narrative' END, auth.uid());
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.record_resolution(uuid, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_resolution(uuid, jsonb, uuid[]) TO authenticated;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_failure_codes_org ON public.failure_codes(org_id, kind);
CREATE INDEX IF NOT EXISTS idx_discrepancy_actions_wo ON public.discrepancy_actions(wo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wo_findings_wo ON public.wo_findings(wo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wo_resolutions_wo ON public.wo_resolutions(wo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wo_resolution_findings_finding ON public.wo_resolution_findings(finding_id);
CREATE INDEX IF NOT EXISTS idx_wo_addenda_wo ON public.wo_addenda(wo_id, created_at);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP TRIGGER IF EXISTS work_orders_evidence_to_close ON public.work_orders;
-- DROP FUNCTION IF EXISTS public.record_resolution, public.evidence_to_close, public.check_record_correction;
-- DROP TABLE IF EXISTS public.wo_addenda, public.wo_resolution_findings, public.wo_resolutions,
--   public.wo_findings, public.discrepancy_actions, public.failure_codes CASCADE;
-- Re-create "work_orders: work roles update" from 20260316000400 without 'operator'.
