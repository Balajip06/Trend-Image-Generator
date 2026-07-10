-- Local-dev seed data.
-- Applied automatically by `supabase db reset`. Not used in production.
--
-- This file is intentionally minimal — it seeds:
--   1. A single sample admin user (you), so /admin loads after signin
--   2. One sample trend ("Ghibli-style portrait") with eval_status=passed
--      and is_active=true, so the home page + /trend/[slug] have content
--      without needing the admin CRUD flow to be built yet.
--
-- Replace ADMIN_EMAIL below with your actual auth.users email before reset.

DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@example.com';

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.admin_users (user_id, role)
    VALUES (v_admin_id, 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;
END $$;

-- Sample trend — Ghibli portrait
INSERT INTO public.trends (
  slug, title, description, prompt_template, model, aspect_ratio,
  input_schema, is_active, eval_status, display_order,
  seo_title, seo_description, faq
) VALUES (
  'ghibli-portrait',
  'Ghibli-style portrait',
  'Turn your selfie into a soft, painterly Studio Ghibli still.',
  'A Studio Ghibli style portrait of the subject in the photo, soft lighting, hand-painted background, gentle color palette',
  'nano-banana-2-lite',
  '1:1',
  '{"fields":[{"type":"image","name":"user_photo","label":"Your photo","required":true,"min_count":1,"max_count":1,"hint":"Clear front-facing photo works best."}]}'::jsonb,
  true,
  'passed',
  1,
  'Ghibli-style portrait generator — turn your photo into a Studio Ghibli still',
  'Free Ghibli-style portrait generator. Upload a photo and get a soft, painterly result in seconds.',
  '[
    {"question":"Is it free?","answer":"You get 5 free generations per week. Buy credits if you need more."},
    {"question":"Does it work on iPhone?","answer":"Yes — all modern mobile + desktop browsers are supported."},
    {"question":"What photos work best?","answer":"Clear front-facing photos with even lighting work best. Group shots are okay but quality varies."}
  ]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;
