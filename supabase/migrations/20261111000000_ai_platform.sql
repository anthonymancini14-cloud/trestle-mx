-- Migration: 20261111000000_ai_platform.sql
-- Purpose: The AI job queue, run log and audit queue. A named task (the first
--          is work-log extraction) is queued as a job (ai_jobs). A worker next
--          to a local model claims the job, runs it and stores what the model
--          returned (ai_runs). A person then accepts, corrects or rejects the
--          run (ai_reviews). Runs are written only by the worker, through
--          functions limited to the service role, so the machine running the
--          model needs an outbound connection to the database and nothing
--          else. Reviews are insert-only: a later review replaces an earlier
--          one and both stay on record.
-- Decisions: local models at runtime (2026-11-11, to be numbered in the decision log)

-- ============================================================
-- TABLE CREATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  task text NOT NULL CHECK (task IN ('worklog.extract')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'wo_debrief')),
  -- The work order the text came from, when it came from one.
  wo_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.ai_jobs(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  -- The task's output once it parsed and matched its schema; null when the run failed.
  output jsonb,
  -- What the deterministic checks found: [{field, severity, message}].
  issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues) = 'array'),
  -- The model's reply as text, kept for looking at failed runs.
  raw_output text,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  input_tokens integer,
  output_tokens integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A run either produced an output or failed with a reason.
  CHECK ((output IS NULL) <> (error IS NULL))
);

CREATE TABLE IF NOT EXISTS public.ai_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ai_runs(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('accepted', 'corrected', 'rejected')),
  corrected_output jsonb,
  note text,
  reviewed_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A correction carries the corrected record; nothing else does.
  CHECK ((verdict = 'corrected') = (corrected_output IS NOT NULL)),
  -- A rejection says why.
  CHECK (verdict <> 'rejected' OR length(trim(coalesce(note, ''))) >= 3)
);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_reviews ENABLE ROW LEVEL SECURITY;

-- Read: anyone at the job's site.
DROP POLICY IF EXISTS "ai_jobs: site-scoped read" ON public.ai_jobs;
CREATE POLICY "ai_jobs: site-scoped read" ON public.ai_jobs
  FOR SELECT USING (site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "ai_runs: site-scoped read" ON public.ai_runs;
CREATE POLICY "ai_runs: site-scoped read" ON public.ai_runs
  FOR SELECT USING (job_id IN (SELECT id FROM public.ai_jobs));

DROP POLICY IF EXISTS "ai_reviews: site-scoped read" ON public.ai_reviews;
CREATE POLICY "ai_reviews: site-scoped read" ON public.ai_reviews
  FOR SELECT USING (run_id IN (SELECT id FROM public.ai_runs));

-- Queue a job: as yourself, at your site, waiting and untouched. Planners,
-- supervisors and admins enter text by hand; a supervisor's close-out can
-- queue the debrief. A job about a work order must be at that work order's site.
DROP POLICY IF EXISTS "ai_jobs: named roles queue" ON public.ai_jobs;
CREATE POLICY "ai_jobs: named roles queue" ON public.ai_jobs
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND status = 'queued' AND attempts = 0 AND claimed_at IS NULL AND finished_at IS NULL AND error IS NULL
    AND public.current_user_role() IN ('planner', 'supervisor', 'admin')
    AND site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    AND (wo_id IS NULL OR wo_id IN (SELECT id FROM public.work_orders w WHERE w.site_id = ai_jobs.site_id))
  );

-- No update or delete policies on ai_jobs, and no write policies at all on
-- ai_runs: only the worker changes them, through the functions below.

-- Review a finished run: as yourself, at your site. No update or delete
-- policies: a review is never edited.
DROP POLICY IF EXISTS "ai_reviews: reviewers add" ON public.ai_reviews;
CREATE POLICY "ai_reviews: reviewers add" ON public.ai_reviews
  FOR INSERT WITH CHECK (
    reviewed_by = auth.uid()
    AND public.current_user_role() IN ('planner', 'supervisor', 'admin')
    AND run_id IN (
      SELECT r.id FROM public.ai_runs r JOIN public.ai_jobs j ON j.id = r.job_id
      WHERE r.output IS NOT NULL AND j.status = 'done'
        AND j.site_id IN (SELECT site_id FROM public.site_access WHERE user_id = auth.uid())
    )
  );

-- ============================================================
-- FUNCTIONS (worker only)
-- ============================================================

-- Take the oldest waiting job. A job whose worker went quiet for ten minutes
-- is offered again, up to three attempts, then marked failed.
CREATE OR REPLACE FUNCTION public.claim_ai_job(p_tasks text[] DEFAULT NULL)
RETURNS SETOF public.ai_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ai_jobs
  SET status = 'failed', error = 'Gave up after 3 attempts with no result', finished_at = now()
  WHERE status = 'running' AND attempts >= 3 AND claimed_at < now() - interval '10 minutes';

  RETURN QUERY
  UPDATE public.ai_jobs j
  SET status = 'running', attempts = j.attempts + 1, claimed_at = now()
  WHERE j.id = (
    SELECT q.id FROM public.ai_jobs q
    WHERE (q.status = 'queued' OR (q.status = 'running' AND q.claimed_at < now() - interval '10 minutes'))
      AND (p_tasks IS NULL OR q.task = ANY (p_tasks))
    ORDER BY q.created_at, q.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING j.*;
END $$;

-- Store what the model returned and finish the job: done when the run has an
-- output, failed when it has an error.
CREATE OR REPLACE FUNCTION public.complete_ai_job(p_job_id uuid, p_run jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job public.ai_jobs%ROWTYPE; v_run uuid; v_error text := p_run ->> 'error';
BEGIN
  SELECT * INTO v_job FROM public.ai_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI job not found'; END IF;
  IF v_job.status NOT IN ('queued', 'running') THEN
    RAISE EXCEPTION 'AI job % is already %', p_job_id, v_job.status;
  END IF;

  INSERT INTO public.ai_runs (job_id, provider, model, prompt_version, output, issues, raw_output, latency_ms, input_tokens, output_tokens, error)
  VALUES (
    p_job_id,
    coalesce(p_run ->> 'provider', 'unknown'),
    coalesce(p_run ->> 'model', 'unknown'),
    coalesce(p_run ->> 'prompt_version', 'unknown'),
    CASE WHEN v_error IS NULL THEN p_run -> 'output' END,
    coalesce(p_run -> 'issues', '[]'::jsonb),
    p_run ->> 'raw_output',
    (p_run ->> 'latency_ms')::integer,
    (p_run ->> 'input_tokens')::integer,
    (p_run ->> 'output_tokens')::integer,
    v_error
  ) RETURNING id INTO v_run;

  UPDATE public.ai_jobs
  SET status = CASE WHEN v_error IS NULL THEN 'done' ELSE 'failed' END, error = v_error, finished_at = now()
  WHERE id = p_job_id;
  RETURN v_run;
END $$;

REVOKE ALL ON FUNCTION public.claim_ai_job(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_ai_job(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_job(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ai_job(uuid, jsonb) TO service_role;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ai_jobs_site ON public.ai_jobs(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_waiting ON public.ai_jobs(created_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_ai_jobs_wo ON public.ai_jobs(wo_id) WHERE wo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_runs_job ON public.ai_runs(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reviews_run ON public.ai_reviews(run_id, created_at DESC);

-- ============================================================
-- ROLLBACK NOTES (manual — Supabase doesn't auto-rollback)
-- ============================================================
-- DROP FUNCTION IF EXISTS public.complete_ai_job(uuid, jsonb), public.claim_ai_job(text[]);
-- DROP TABLE IF EXISTS public.ai_reviews, public.ai_runs, public.ai_jobs CASCADE;
