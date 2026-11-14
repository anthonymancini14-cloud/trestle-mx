-- Tests for 20261114000000_cost_and_downtime.sql. Run by scripts/db-test.sh
-- after every migration has been applied. Each block raises on failure.
\set ON_ERROR_STOP on

-- ------------------------------------------------------------ fixtures
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'cost-admin@test.local', '{"full_name":"Cost Admin"}'),
  ('f0000000-0000-4000-8000-000000000002', 'cost-super@test.local', '{"full_name":"Cost Supervisor"}'),
  ('f0000000-0000-4000-8000-000000000003', 'cost-tech@test.local', '{"full_name":"Cost Tech"}'),
  ('f0000000-0000-4000-8000-000000000004', 'cost-tech2@test.local', '{"full_name":"Cost Tech Two"}'),
  ('f0000000-0000-4000-8000-000000000005', 'cost-operator@test.local', '{"full_name":"Cost Operator"}'),
  ('f0000000-0000-4000-8000-000000000006', 'cost-other@test.local', '{"full_name":"Other Site Admin"}');
UPDATE public.profiles SET role = 'admin' WHERE id IN ('f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000006');
UPDATE public.profiles SET role = 'supervisor' WHERE id = 'f0000000-0000-4000-8000-000000000002';
UPDATE public.profiles SET role = 'technician', craft = 'mechanical' WHERE id IN ('f0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000004');
UPDATE public.profiles SET role = 'operator' WHERE id = 'f0000000-0000-4000-8000-000000000005';
INSERT INTO public.organizations (id, name) VALUES ('f1000000-0000-4000-8000-000000000001', 'Cost Test Org');
INSERT INTO public.sites (id, org_id, code, name, jcn_block) VALUES
  ('f2000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-000000000001', 'CTA', 'Cost Site A', 5000),
  ('f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-000000000001', 'CTB', 'Cost Site B', 6000);
INSERT INTO public.site_access (user_id, site_id)
  SELECT id, 'f2000000-0000-4000-8000-00000000000a'::uuid FROM public.profiles
  WHERE id::text LIKE 'f0000000-%' AND id <> 'f0000000-0000-4000-8000-000000000006';
INSERT INTO public.site_access (user_id, site_id) VALUES ('f0000000-0000-4000-8000-000000000006', 'f2000000-0000-4000-8000-00000000000b');
INSERT INTO public.area_codes (id, site_id, code, name) VALUES
  ('f3000000-0000-4000-8000-00000000000a', 'f2000000-0000-4000-8000-00000000000a', 'PMP', 'Pump house'),
  ('f3000000-0000-4000-8000-00000000000b', 'f2000000-0000-4000-8000-00000000000b', 'PMP', 'Pump house');
INSERT INTO public.assets (id, site_id, area_id, floc, name, asset_class) VALUES
  ('f4000000-0000-4000-8000-00000000000a', 'f2000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-00000000000a', 'CTA-PMP-P-1', 'Pump 1', 'pump'),
  ('f4000000-0000-4000-8000-0000000000a2', 'f2000000-0000-4000-8000-00000000000a', 'f3000000-0000-4000-8000-00000000000a', 'CTA-PMP-P-2', 'Pump 2', 'pump'),
  ('f4000000-0000-4000-8000-00000000000b', 'f2000000-0000-4000-8000-00000000000b', 'f3000000-0000-4000-8000-00000000000b', 'CTB-PMP-P-1', 'Pump 1', 'pump');
-- One job being worked, one still in planning, one at the other site.
INSERT INTO public.work_orders (id, site_id, title, asset_id, stage, created_at) VALUES
  ('f5000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-00000000000a', 'Seal replacement', 'f4000000-0000-4000-8000-00000000000a', 'execution', now() - interval '3 days'),
  ('f5000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-00000000000a', 'Not started', 'f4000000-0000-4000-8000-0000000000a2', 'planning', now() - interval '3 days'),
  ('f5000000-0000-4000-8000-00000000000b', 'f2000000-0000-4000-8000-00000000000b', 'Other site job', 'f4000000-0000-4000-8000-00000000000b', 'execution', now() - interval '3 days');
INSERT INTO public.parts_catalog (id, org_id, part_number, description, unit_cost) VALUES
  ('f6000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'SEAL-1', 'Mechanical seal', 412.50);
INSERT INTO public.inventory (site_id, part_id, on_hand, reserved) VALUES ('f2000000-0000-4000-8000-00000000000a', 'f6000000-0000-4000-8000-000000000001', 3, 2);
INSERT INTO public.wo_parts (id, wo_id, part_id, description, qty_required, status) VALUES
  ('f7000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001', 'Mechanical seal', 2, 'reserved');
COMMIT;

CREATE OR REPLACE FUNCTION pg_temp.refused(p_user uuid, p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN true;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.count_as(p_user uuid, p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE p_sql INTO n;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN n;
END $$;

-- ------------------------------------------------------------ labor rates
DO $$
DECLARE
  admin_a uuid := 'f0000000-0000-4000-8000-000000000001';
  super_a uuid := 'f0000000-0000-4000-8000-000000000002';
  tech_a uuid := 'f0000000-0000-4000-8000-000000000003';
  admin_b uuid := 'f0000000-0000-4000-8000-000000000006';
  rate text := $q$INSERT INTO public.labor_rates (site_id, craft, hourly_rate, effective_from, created_by) VALUES ('f2000000-0000-4000-8000-00000000000a', '%s', %s, current_date - %s, '%s')$q$;
BEGIN
  ASSERT NOT pg_temp.refused(admin_a, format(rate, 'mechanical', 60, 30, admin_a)), 'an admin sets a rate at their site';
  ASSERT NOT pg_temp.refused(admin_a, format(rate, 'mechanical', 66, 1, admin_a)), 'a later rate is a new row';
  ASSERT pg_temp.refused(super_a, format(rate, 'electrical', 70, 30, super_a)), 'a supervisor cannot set a rate';
  ASSERT pg_temp.refused(admin_b, format(rate, 'electrical', 70, 30, admin_b)), 'an admin cannot set a rate at another site';
  ASSERT pg_temp.refused(admin_a, format(rate, 'electrical', 0, 30, admin_a)), 'a rate is above zero';
  ASSERT pg_temp.count_as(tech_a, 'SELECT count(*) FROM public.labor_rates') = 2, 'everyone at the site reads the rates';
  ASSERT pg_temp.count_as(admin_b, 'SELECT count(*) FROM public.labor_rates') = 0, 'another site sees no rates';
  ASSERT pg_temp.count_as(admin_a, $q$WITH u AS (UPDATE public.labor_rates SET hourly_rate = 1 RETURNING 1) SELECT count(*) FROM u$q$) = 0, 'a rate is never edited';
  RAISE NOTICE 'ok: labor rates';
END $$;

-- ------------------------------------------------------------ logging hours
DO $$
DECLARE
  super_a uuid := 'f0000000-0000-4000-8000-000000000002';
  tech_a uuid := 'f0000000-0000-4000-8000-000000000003';
  tech_a2 uuid := 'f0000000-0000-4000-8000-000000000004';
  operator_a uuid := 'f0000000-0000-4000-8000-000000000005';
  admin_b uuid := 'f0000000-0000-4000-8000-000000000006';
  wo uuid := 'f5000000-0000-4000-8000-000000000001';
  labor text := $q$INSERT INTO public.wo_labor (wo_id, profile_id, craft, hours, work_date, note, entered_by, hourly_rate) VALUES ('%s', %s, '%s', %s, current_date - %s, %s, '%s', 999)$q$;
BEGIN
  ASSERT NOT pg_temp.refused(tech_a, format(labor, wo, quote_literal(tech_a), 'mechanical', 4, 2, 'NULL', tech_a)), 'a technician logs their own hours';
  ASSERT (SELECT hourly_rate FROM public.wo_labor WHERE wo_id = wo) = 60, 'the entry takes the rate in effect on the work date, not one the client sends';
  ASSERT NOT pg_temp.refused(tech_a, format(labor, wo, quote_literal(tech_a), 'mechanical', 2.5, 0, 'NULL', tech_a)), 'a second day';
  ASSERT (SELECT hourly_rate FROM public.wo_labor WHERE wo_id = wo AND hours = 2.5) = 66, 'today''s work takes the new rate';
  ASSERT (SELECT actual_hours FROM public.work_orders WHERE id = wo) = 6.5, 'the work order''s hours are the labor logged';

  ASSERT pg_temp.refused(tech_a, format(labor, wo, quote_literal(tech_a2), 'mechanical', 1, 0, 'NULL', tech_a)), 'a technician cannot log someone else''s hours';
  ASSERT pg_temp.refused(operator_a, format(labor, wo, quote_literal(operator_a), 'operations', 1, 0, 'NULL', operator_a)), 'an operator cannot log hours';
  ASSERT pg_temp.refused(admin_b, format(labor, wo, 'NULL', 'mechanical', 1, 0, 'NULL', admin_b)), 'another site cannot log hours here';
  ASSERT pg_temp.refused(tech_a, format(labor, wo, quote_literal(tech_a), 'mechanical', 1, 0, 'NULL', super_a)), 'an entry cannot be signed as someone else';
  ASSERT pg_temp.refused(tech_a, format(labor, 'f5000000-0000-4000-8000-000000000002', quote_literal(tech_a), 'mechanical', 1, 0, 'NULL', tech_a)), 'no hours on a job that is still in planning';
  ASSERT pg_temp.refused(tech_a, format(labor, wo, quote_literal(tech_a), 'mechanical', 30, 0, 'NULL', tech_a)), 'one entry is at most 24 hours';
  ASSERT pg_temp.refused(tech_a, format(labor, wo, quote_literal(tech_a), 'mechanical', 1, 9, 'NULL', tech_a)), 'no work dated before the work order was opened';
  ASSERT pg_temp.refused(super_a, format(labor, wo, quote_literal(admin_b), 'mechanical', 1, 0, 'NULL', super_a)), 'no hours for someone who is not on this site''s roster';

  ASSERT NOT pg_temp.refused(super_a, format(labor, wo, quote_literal(tech_a2), 'mechanical', 3, 0, 'NULL', super_a)), 'a supervisor logs anyone''s hours';
  ASSERT NOT pg_temp.refused(super_a, format(labor, wo, 'NULL', 'contractor', 5, 0, 'NULL', super_a)), 'a supervisor logs a crew that is not on the roster';
  ASSERT (SELECT hourly_rate IS NULL FROM public.wo_labor WHERE wo_id = wo AND craft = 'contractor'), 'a craft with no rate is logged with no rate, not a guess';

  ASSERT pg_temp.refused(super_a, format(labor, wo, quote_literal(tech_a2), 'mechanical', -1, 0, 'NULL', super_a)), 'a correction needs a note';
  ASSERT pg_temp.refused(super_a, format(labor, wo, quote_literal(tech_a2), 'mechanical', -20, 0, quote_literal('Too much'), super_a)), 'a correction cannot take the hours below zero';
  ASSERT NOT pg_temp.refused(super_a, format(labor, wo, quote_literal(tech_a2), 'mechanical', -1, 0, quote_literal('Entered 3, was 2'), super_a)), 'a correction with a note';
  ASSERT (SELECT actual_hours FROM public.work_orders WHERE id = wo) = 13.5, 'hours follow corrections too';

  ASSERT pg_temp.count_as(super_a, $q$WITH u AS (UPDATE public.wo_labor SET hours = 1 RETURNING 1) SELECT count(*) FROM u$q$) = 0, 'an entry is never edited';
  ASSERT pg_temp.count_as(super_a, $q$WITH d AS (DELETE FROM public.wo_labor RETURNING 1) SELECT count(*) FROM d$q$) = 0, 'an entry is never deleted';
  ASSERT pg_temp.count_as(operator_a, 'SELECT count(*) FROM public.wo_labor') = 5, 'everyone at the site reads the hours';
  ASSERT pg_temp.count_as(admin_b, 'SELECT count(*) FROM public.wo_labor') = 0, 'another site sees no hours';
  RAISE NOTICE 'ok: logging hours';
END $$;

-- ------------------------------------------------------------ the price is fixed when a part is issued
DO $$
DECLARE tech_a uuid := 'f0000000-0000-4000-8000-000000000003';
BEGIN
  ASSERT NOT pg_temp.refused(tech_a, $q$SELECT public.issue_work_order_part('f7000000-0000-4000-8000-000000000001')$q$), 'the crew issues the part';
  ASSERT (SELECT unit_cost FROM public.wo_parts WHERE id = 'f7000000-0000-4000-8000-000000000001') = 412.50, 'the line takes the catalog price';
  UPDATE public.parts_catalog SET unit_cost = 500 WHERE id = 'f6000000-0000-4000-8000-000000000001';
  ASSERT (SELECT unit_cost FROM public.wo_parts WHERE id = 'f7000000-0000-4000-8000-000000000001') = 412.50, 'a later price change does not rewrite the job';
  ASSERT (SELECT on_hand = 1 AND reserved = 0 FROM public.inventory WHERE part_id = 'f6000000-0000-4000-8000-000000000001'), 'stock moves as before';
  RAISE NOTICE 'ok: part price fixed at issue';
END $$;

-- ------------------------------------------------------------ asset status
DO $$
DECLARE
  admin_a uuid := 'f0000000-0000-4000-8000-000000000001';
  tech_a uuid := 'f0000000-0000-4000-8000-000000000003';
  operator_a uuid := 'f0000000-0000-4000-8000-000000000005';
  admin_b uuid := 'f0000000-0000-4000-8000-000000000006';
  pump uuid := 'f4000000-0000-4000-8000-00000000000a';
  change text := $q$INSERT INTO public.asset_status_events (asset_id, status, wo_id, recorded_by, started_at) VALUES ('%s', '%s', %s, '%s', now() - interval '30 days')$q$;
BEGIN
  ASSERT NOT pg_temp.refused(operator_a, format(change, pump, 'down', quote_literal('f5000000-0000-4000-8000-000000000001'), operator_a)), 'an operator records that equipment went down';
  ASSERT (SELECT status FROM public.assets WHERE id = pump) = 'down', 'the asset follows its latest event';
  ASSERT (SELECT started_at > now() - interval '1 minute' FROM public.asset_status_events WHERE asset_id = pump), 'a signed-in user''s change starts now, whatever the client sends';
  ASSERT pg_temp.refused(tech_a, format(change, pump, 'down', 'NULL', tech_a)), 'a change has to change something';
  ASSERT pg_temp.refused(tech_a, format(change, pump, 'running', quote_literal('f5000000-0000-4000-8000-000000000002'), tech_a)), 'a work order on another asset cannot be named';
  ASSERT pg_temp.refused(tech_a, format(change, pump, 'running', 'NULL', admin_a)), 'a change cannot be signed as someone else';
  ASSERT pg_temp.refused(admin_b, format(change, pump, 'running', 'NULL', admin_b)), 'another site cannot change it';
  ASSERT pg_temp.refused(tech_a, format(change, pump, 'retired', 'NULL', tech_a)), 'only an admin retires an asset';
  ASSERT NOT pg_temp.refused(tech_a, format(change, pump, 'running', quote_literal('f5000000-0000-4000-8000-000000000001'), tech_a)), 'a technician returns it to service';
  ASSERT (SELECT status FROM public.assets WHERE id = pump) = 'running', 'back in service';

  ASSERT NOT pg_temp.refused(admin_a, format(change, pump, 'retired', 'NULL', admin_a)), 'an admin retires it';
  ASSERT pg_temp.refused(tech_a, format(change, pump, 'running', 'NULL', tech_a)), 'a retired asset stays retired unless an admin says otherwise';
  ASSERT NOT pg_temp.refused(admin_a, format(change, pump, 'standby', 'NULL', admin_a)), 'an admin puts it back';

  ASSERT pg_temp.count_as(admin_a, $q$WITH u AS (UPDATE public.asset_status_events SET status = 'running' RETURNING 1) SELECT count(*) FROM u$q$) = 0, 'history is never edited';
  ASSERT pg_temp.count_as(admin_a, $q$WITH d AS (DELETE FROM public.asset_status_events RETURNING 1) SELECT count(*) FROM d$q$) = 0, 'history is never deleted';
  ASSERT pg_temp.count_as(operator_a, 'SELECT count(*) FROM public.asset_status_events') = 4, 'everyone at the site reads the history';
  ASSERT pg_temp.count_as(admin_b, 'SELECT count(*) FROM public.asset_status_events') = 0, 'another site sees none of it';
  RAISE NOTICE 'ok: asset status';
END $$;

-- ------------------------------------------------------------ history loaded by the seed script
DO $$
DECLARE pump2 uuid := 'f4000000-0000-4000-8000-0000000000a2';
BEGIN
  -- No signed-in user: the rows are history. They keep their dates and their rate.
  INSERT INTO public.asset_status_events (asset_id, status, started_at) VALUES
    (pump2, 'down', now() - interval '10 days'),
    (pump2, 'running', now() - interval '9 days'),
    (pump2, 'standby', now() - interval '20 days');
  ASSERT (SELECT status FROM public.assets WHERE id = pump2) = 'running', 'the latest event by start time wins, whatever order the rows arrive in';
  INSERT INTO public.wo_labor (wo_id, craft, hours, work_date, hourly_rate) VALUES ('f5000000-0000-4000-8000-000000000002', 'electrical', 40, current_date - 200, 58);
  ASSERT (SELECT hourly_rate FROM public.wo_labor WHERE wo_id = 'f5000000-0000-4000-8000-000000000002') = 58, 'seeded history keeps the rate it was costed at';
  RAISE NOTICE 'ok: seeded history';
END $$;
