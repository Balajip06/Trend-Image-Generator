-- 20260709000003_admin_vip_unlimited.sql
-- Closed-testing admins get unlimited generations via the existing VIP
-- quota bypass (consume_quota_on_generation_insert short-circuits before
-- the credits/free-tier decrement when profiles.is_vip = true). Real Gemini/
-- OpenAI cost is still recorded on the completion path — this waives quota,
-- not cost tracking. Safe to re-run.

update public.profiles
set is_vip = true
where email in (
  'indhu@kimp.com',
  'abirami@kimp.xyz',
  'anto@kimp.xyz',
  'balaji@kimp.xyz'
);
