-- Tests for 20261111000000_ai_platform.sql. Run by scripts/db-test.sh after
-- every migration has been applied. Each block raises on failure.
\set ON_ERROR_STOP on

-- ------------------------------------------------------------ fixtures
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'planner-a@test.local', '{"full_name":"Planner A"}'),
  ('a0000000-0000-4000-8000-000000000002', 'tech-a@test.local', '{"full_name":"Tech A"}'),
  ('a0000000-0000-4000-8000-000000000003', 'planner-b@test.local', '{"full_name":"Planner B"}'),
  ('a0000000-0000-4000-8000-000000000004', 'supervisor-a@test.local', '{"full_name":"Supervisor A"}');
UPDATE public.profiles SET role = 'planner' WHERE id IN ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003');
UPDATE public.profiles SET role = 'supervisor' WHERE id = 'a0000000-0000-4000-8000-000000000004';
INSERT INTO public.organizations (id, name) VALUES ('b0000000-0000-4000-8000-000000000001', 'Test Org');
INSERT INTO public.sites (id, org_id, code, name, jcn_block) VALUES
  ('c0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-000000000001', 'TSA', 'Test Site A', 7000),
  ('c0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-000000000001', 'TSB', 'Test Site B', 8000);
INSERT INTO public.site_access (user_id, site_id) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000a'),
  ('a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-00000000000a'),
  ('a0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-00000000000a'),
  ('a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-00000000000b');
INSERT INTO public.work_orders (id, site_id, title) VALUES
  ('d0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000b', 'A work order at site B');
COMMIT;

-- Run a statement as a signed-in user; report whether it was refused.
CREATE OR REPLACE FUNCTION pg_temp.refused(p_user uuid, p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    RESET ROLE;
    RETURN true;
  END;
  RESET ROLE;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.count_as(p_user uuid, p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO n;
  RESET ROLE;
  RETURN n;
END $$;

-- ------------------------------------------------------------ queueing a job
DO $$
DECLARE
  planner_a uuid := 'a0000000-0000-4000-8000-000000000001';
  tech_a uuid := 'a0000000-0000-4000-8000-000000000002';
  job text := $q$INSERT INTO public.ai_jobs (id, site_id, task, input, created_by) VALUES ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000a', 'worklog.extract', '{"text":"P-101 seal leaking"}', '%s')$q$;
BEGIN
  ASSERT NOT pg_temp.refused(planner_a, format(job, planner_a)), 'a planner can queue a job at their own site';
  ASSERT pg_temp.refused(tech_a, format(replace(job, '000000000001''', '000000000002'''), tech_a)), 'a technician cannot queue a job';
  ASSERT pg_temp.refused(planner_a, format(replace(replace(job, '00000000000a''', '00000000000b'''), '000000000001'', ''c', '000000000003'', ''c'), planner_a)), 'a planner cannot queue a job at another site';
  ASSERT pg_temp.refused(planner_a, format(replace(job, '000000000001'', ''c', '000000000004'', ''c'), tech_a)), 'a job cannot be queued in someone else''s name';
  ASSERT pg_temp.refused(planner_a, $q$INSERT INTO public.ai_jobs (site_id, task, input, created_by, status) VALUES ('c0000000-0000-4000-8000-00000000000a', 'worklog.extract', '{"text":"x"}', 'a0000000-0000-4000-8000-000000000001', 'done')$q$), 'a job cannot be inserted already done';
  ASSERT pg_temp.refused(planner_a, $q$INSERT INTO public.ai_jobs (site_id, task, input, created_by, wo_id) VALUES ('c0000000-0000-4000-8000-00000000000a', 'worklog.extract', '{"text":"x"}', 'a0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000b')$q$), 'a job cannot point at another site''s work order';
  RAISE NOTICE 'ok: queueing a job';
END $$;

-- ------------------------------------------------------------ only the worker writes runs
DO $$
DECLARE
  planner_a uuid := 'a0000000-0000-4000-8000-000000000001';
  claimed public.ai_jobs%ROWTYPE;
  run_id uuid;
BEGIN
  ASSERT pg_temp.refused(planner_a, $q$SELECT * FROM public.claim_ai_job()$q$), 'a signed-in user cannot claim a job';
  ASSERT pg_temp.refused(planner_a, $q$SELECT public.complete_ai_job('e0000000-0000-4000-8000-000000000001', '{"output":{}}')$q$), 'a signed-in user cannot complete a job';
  ASSERT pg_temp.refused(planner_a, $q$INSERT INTO public.ai_runs (job_id, provider, model, prompt_version, output) VALUES ('e0000000-0000-4000-8000-000000000001', 'x', 'x', 'x', '{}')$q$), 'a signed-in user cannot insert a run';
  ASSERT pg_temp.count_as(planner_a, $q$WITH u AS (UPDATE public.ai_jobs SET status = 'done' RETURNING 1) SELECT count(*) FROM u$q$) = 0, 'a signed-in user cannot change a job';

  SET LOCAL ROLE service_role;
  SELECT * INTO claimed FROM public.claim_ai_job(ARRAY['worklog.extract']);
  ASSERT claimed.id = 'e0000000-0000-4000-8000-000000000001' AND claimed.status = 'running' AND claimed.attempts = 1, 'the worker claims the waiting job';
  ASSERT (SELECT count(*) FROM public.claim_ai_job()) = 0, 'a claimed job is not offered twice';
  run_id := public.complete_ai_job(claimed.id, '{"provider":"openai-compatible","model":"test-model","prompt_version":"v0.2-test","output":{"asset_tag":"P-101"},"issues":[],"raw_output":"{}","latency_ms":1200,"input_tokens":400,"output_tokens":90,"error":null}');
  ASSERT (SELECT status FROM public.ai_jobs WHERE id = claimed.id) = 'done', 'a run with an output finishes the job';
  ASSERT (SELECT output ->> 'asset_tag' FROM public.ai_runs WHERE id = run_id) = 'P-101', 'the output is stored';
  BEGIN
    PERFORM public.complete_ai_job(claimed.id, '{"output":{}}');
    ASSERT false, 'a finished job cannot be completed again';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'ok: only the worker writes runs';
END $$;

-- ------------------------------------------------------------ a failed run, and a stale claim
DO $$
DECLARE j uuid; claimed public.ai_jobs%ROWTYPE;
BEGIN
  INSERT INTO public.ai_jobs (site_id, task, input) VALUES ('c0000000-0000-4000-8000-00000000000a', 'worklog.extract', '{"text":"fails"}') RETURNING id INTO j;
  SET LOCAL ROLE service_role;
  SELECT * INTO claimed FROM public.claim_ai_job();
  PERFORM public.complete_ai_job(claimed.id, '{"provider":"lmstudio","model":"m","prompt_version":"v","output":null,"raw_output":"not json","latency_ms":10,"error":"The model''s reply was not JSON."}');
  RESET ROLE;
  ASSERT (SELECT status FROM public.ai_jobs WHERE id = j) = 'failed', 'a run with an error fails the job';
  ASSERT (SELECT output IS NULL AND error IS NOT NULL FROM public.ai_runs WHERE job_id = j), 'a failed run keeps the error and no output';

  INSERT INTO public.ai_jobs (site_id, task, input, status, attempts, claimed_at) VALUES ('c0000000-0000-4000-8000-00000000000a', 'worklog.extract', '{"text":"stale"}', 'running', 1, now() - interval '11 minutes') RETURNING id INTO j;
  SET LOCAL ROLE service_role;
  SELECT * INTO claimed FROM public.claim_ai_job();
  RESET ROLE;
  ASSERT claimed.id = j AND claimed.attempts = 2, 'a job whose worker went quiet is offered again';
  UPDATE public.ai_jobs SET attempts = 3, claimed_at = now() - interval '11 minutes' WHERE id = j;
  SET LOCAL ROLE service_role;
  ASSERT (SELECT count(*) FROM public.claim_ai_job()) = 0, 'no fourth attempt';
  RESET ROLE;
  ASSERT (SELECT status FROM public.ai_jobs WHERE id = j) = 'failed', 'a job is failed after three attempts';
  RAISE NOTICE 'ok: failed runs and stale claims';
END $$;

-- ------------------------------------------------------------ reading and reviewing
DO $$
DECLARE
  planner_a uuid := 'a0000000-0000-4000-8000-000000000001';
  tech_a uuid := 'a0000000-0000-4000-8000-000000000002';
  planner_b uuid := 'a0000000-0000-4000-8000-000000000003';
  supervisor_a uuid := 'a0000000-0000-4000-8000-000000000004';
  run_id uuid := (SELECT id FROM public.ai_runs WHERE job_id = 'e0000000-0000-4000-8000-000000000001');
  failed_run uuid := (SELECT id FROM public.ai_runs WHERE error IS NOT NULL LIMIT 1);
  review text := $q$INSERT INTO public.ai_reviews (run_id, verdict, corrected_output, note, reviewed_by) VALUES ('%s', '%s', %s, %s, '%s')$q$;
BEGIN
  ASSERT pg_temp.count_as(tech_a, 'SELECT count(*) FROM public.ai_runs') = 2, 'anyone at the site reads its runs';
  ASSERT pg_temp.count_as(planner_b, 'SELECT count(*) FROM public.ai_jobs') = 0, 'another site sees no jobs';
  ASSERT pg_temp.count_as(planner_b, 'SELECT count(*) FROM public.ai_runs') = 0, 'another site sees no runs';

  ASSERT pg_temp.refused(tech_a, format(review, run_id, 'accepted', 'NULL', 'NULL', tech_a)), 'a technician cannot review';
  ASSERT pg_temp.refused(planner_b, format(review, run_id, 'accepted', 'NULL', 'NULL', planner_b)), 'another site cannot review';
  ASSERT pg_temp.refused(planner_a, format(review, run_id, 'accepted', 'NULL', 'NULL', supervisor_a)), 'a review cannot be signed as someone else';
  ASSERT pg_temp.refused(planner_a, format(review, failed_run, 'accepted', 'NULL', 'NULL', planner_a)), 'a failed run cannot be reviewed';
  ASSERT pg_temp.refused(planner_a, format(review, run_id, 'corrected', 'NULL', 'NULL', planner_a)), 'a correction needs the corrected record';
  ASSERT pg_temp.refused(planner_a, format(review, run_id, 'accepted', $j$'{"asset_tag":"P-102"}'$j$, 'NULL', planner_a)), 'only a correction carries a corrected record';
  ASSERT pg_temp.refused(planner_a, format(review, run_id, 'rejected', 'NULL', 'NULL', planner_a)), 'a rejection needs a reason';

  ASSERT NOT pg_temp.refused(planner_a, format(review, run_id, 'accepted', 'NULL', 'NULL', planner_a)), 'a planner at the site can accept';
  ASSERT NOT pg_temp.refused(supervisor_a, format(review, run_id, 'corrected', $j$'{"asset_tag":"P-102"}'$j$, $j$'Tag was misread'$j$, supervisor_a)), 'a supervisor at the site can correct';
  ASSERT pg_temp.count_as(planner_a, $q$WITH u AS (UPDATE public.ai_reviews SET verdict = 'rejected', note = 'changed' RETURNING 1) SELECT count(*) FROM u$q$) = 0, 'a review cannot be edited';
  ASSERT pg_temp.count_as(planner_a, $q$WITH d AS (DELETE FROM public.ai_reviews RETURNING 1) SELECT count(*) FROM d$q$) = 0, 'a review cannot be deleted';
  ASSERT pg_temp.count_as(tech_a, 'SELECT count(*) FROM public.ai_reviews') = 2, 'both reviews stay on record';
  RAISE NOTICE 'ok: reading and reviewing';
END $$;
