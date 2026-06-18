-- 20260602000003_trend_model_enum_gpt.sql
-- Phase 1: extend trend_model enum with 'gpt-image'.
-- Must be a separate migration/transaction — Postgres requires ALTER TYPE
-- ADD VALUE to run outside any function body that uses the new value.

alter type public.trend_model add value if not exists 'gpt-image';
