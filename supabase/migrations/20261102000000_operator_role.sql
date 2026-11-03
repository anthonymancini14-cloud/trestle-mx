-- Migration: 20261102000000_operator_role.sql
-- Purpose: Seventh role, operator (TMX-009): logs discrepancies and records
--          what they saw and tried before maintenance arrived. On its own so
--          the next migration can use the new value (Postgres can't use an
--          enum value in the transaction that adds it).

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'operator';

-- ROLLBACK NOTES: Postgres can't drop an enum value. Reassign operators first:
-- UPDATE public.profiles SET role = 'technician' WHERE role = 'operator';
