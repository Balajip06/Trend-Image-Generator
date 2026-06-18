-- Migration: extend generation_tier with new bucket labels.
-- Phase 0: add 'monthly' and 'kimp' values to the generation_tier enum.
--
-- CRITICAL: Postgres requires ALTER TYPE ... ADD VALUE to run in a separate
-- transaction from any statement that USES the new value. This migration
-- adds the labels; Task 3's trigger update will use them.

alter type public.generation_tier add value if not exists 'monthly';
alter type public.generation_tier add value if not exists 'kimp';
