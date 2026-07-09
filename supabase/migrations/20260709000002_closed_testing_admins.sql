-- 20260709000002_closed_testing_admins.sql
-- Closed-testing phase: grant admin_users role to the 4 test accounts.
-- Run AFTER these accounts exist in auth.users (created via Supabase dashboard).
-- Safe to re-run — on conflict does nothing.

insert into public.admin_users (user_id, role)
select id, 'admin'::admin_role
from auth.users
where email in (
  'indhu@kimp.com',
  'abirami@kimp.xyz',
  'anto@kimp.xyz',
  'balaji@kimp.xyz'
)
on conflict (user_id) do nothing;
