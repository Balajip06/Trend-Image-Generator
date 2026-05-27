# Trend Image Generator — Project Plan

> A web app where users try viral image-generation trends (Ghibli effect, Stranger Things style, etc.) by uploading their photo and getting it transformed in that style.

---

## 1. Product Overview

**Core idea**: When a visual trend goes viral (Ghibli effect, Stranger Things poster, Barbie-fication, etc.), users open the app, pick the trend from a thumbnail grid, upload their photo, and get a stylized output in seconds.

**Competitive moat**: Speed-to-market on new trends. Adding a new trend = filling out an admin form, not redeploying the app.

---

## 2. Key Decisions (Locked)

| Area | Decision |
|---|---|
| Trends managed by | Me + small team (admin panel with roles) |
| Platform | Web first, mobile (React Native) later |
| Monetization | Freemium — 10 free generations lifetime, then Pro plan |
| Priority for v1 | Best output quality |
| Backend / DB / Auth / Storage | **Supabase** |
| Frontend | **Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui** |
| Auth | Google + Email |
| Default model | **Nano Banana Pro (Gemini 3 Pro Image)** — quality-first |
| Quick option | Nano Banana v1 — cheaper/faster toggle for users |
| Watermark | None — clean output for all tiers |
| Content moderation | Allow all uploads; moderate **outputs** only |
| Payment gateway | Decide later (interface stubbed) |

---

## 3. Model Strategy

- **Default → Nano Banana Pro**: 2K/4K output, better text rendering, multi-reference composition, better lighting control. Quality matches v1 priority.
- **User-toggleable → Nano Banana v1**: ~4-6x cheaper and faster. Power users doing trial-and-error save quota.
- **Per-trend override**: Each trend row in DB specifies its preferred model. Some trends genuinely need Pro (e.g., movie posters with text).
- **Refund on output moderation failure**: If Gemini's output safety filters block the result, mark generation `failed` and don't deduct the user's quota credit.

---

## 4. Architecture

### Stack
- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui
- **Backend**: Next.js API routes + Supabase Edge Functions (for generation jobs)
- **DB + Auth + Storage**: Supabase (Postgres + Auth + Storage)
- **Image model**: Gemini API (Nano Banana / Nano Banana Pro)
- **Queue**: Supabase Edge Function + DB row status polling via Realtime subscription (no Redis needed at this scale)
- **Hosting**: Vercel (frontend) + Supabase (everything else)
- **Analytics**: PostHog (free tier)

### Folder structure
```
/app           (Next.js routes — public, admin, api)
/components    (UI components)
/lib
  /supabase    (client + server clients, generated types)
  /gemini      (model wrappers, prompt building)
  /utils       (image compression, validation)
/types         (shared TS types)
```

---

## 5. Data Model

### `profiles`
| Column | Type | Notes |
|---|---|---|
| id | uuid | FK → auth.users |
| email | text | |
| name | text | |
| avatar_url | text | |
| plan | enum | `free` \| `pro` |
| free_generations_used | int | Default 0, lifetime-capped at 10 |
| pro_credits | int | Default 0 |
| created_at | timestamptz | |

### `trends`
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| slug | text | URL-safe identifier |
| title | text | |
| description | text | |
| thumbnail_url | text | |
| sample_before_url | text | |
| sample_after_url | text | |
| prompt_template | text | The actual prompt sent to Gemini |
| model | enum | `nano-banana` \| `nano-banana-pro` |
| reference_image_urls | text[] | Optional anchor images |
| aspect_ratio | enum | `1:1` \| `3:4` \| `16:9` |
| is_active | bool | |
| display_order | int | For sorting in UI |
| created_by | uuid | FK → admin_users |
| created_at | timestamptz | |

### `generations`
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid | FK → profiles |
| trend_id | uuid | FK → trends |
| input_image_url | text | |
| output_image_url | text | Null until completed |
| status | enum | `queued` \| `processing` \| `completed` \| `failed` |
| error_message | text | |
| model_used | text | Snapshot of model at generation time |
| created_at | timestamptz | |
| completed_at | timestamptz | |

### `admin_users`
| Column | Type | Notes |
|---|---|---|
| user_id | uuid | FK → auth.users |
| role | enum | `admin` \| `editor` |
| created_at | timestamptz | |

### Critical RLS policy
On `generations` INSERT — reject if:
```
(plan = 'free' AND free_generations_used >= 10) AND pro_credits <= 0
```
Quota enforcement happens at the database layer. Impossible to bypass from the client.

---

## 6. User Flow

1. **Home (`/`)** — Grid of active trends sorted by `display_order`. Hover/tap shows before/after preview.
2. **Trend page (`/trend/[slug]`)** — Hero with sample output, "Upload your photo" CTA, model toggle (Quick / Pro), optional gallery of community results.
3. **Upload** — Client-side resize to max 2048px → upload to Supabase Storage at `uploads/{user_id}/{uuid}.jpg` → show preview.
4. **Generate** — `POST /api/generate` → creates `generations` row with status `queued` → triggers Edge Function → returns `generation_id`.
5. **Result (`/result/[id]`)** — Subscribes to that row via Supabase Realtime. Shows skeleton while `processing`, swaps to final image when `completed`. Download + share buttons.
6. **Admin (`/admin`)** — Protected by `admin_users` check. CRUD for trends, drag-to-reorder, toggle active, upload thumbnails.

---

## 7. Phased Build Plan

### Phase 1 — Foundation (2–3 days)
- Next.js + Supabase project setup
- Auth (Google + Email) with profile auto-creation trigger
- Full DB schema + RLS policies
- Empty admin route gated by `admin_users` table check
- Generate TypeScript types from schema (`supabase gen types typescript`)

### Phase 2 — Trends + Admin (2 days)
- Admin CRUD for trends (form + Supabase Storage upload for thumbnails)
- Public home page rendering the trends grid
- Trend detail page

### Phase 3 — Core Generation (3–4 days)
- Upload flow with client-side compression
- `/api/generate` endpoint with quota check
- Edge Function calling Gemini API with the prompt template + user image
- Result page with Realtime subscription
- Output moderation check (Gemini safetySettings)
- Refund logic on moderation failure

### Phase 4 — Polish (2 days)
- Download + share-to-social with OG preview
- `/my-creations` history page
- Error states, retry logic, edge cases
- PostHog analytics

### Phase 5 — Payments (when traction exists)
- Drop in Razorpay or Stripe behind the payment interface stub
- Pro plan pricing: e.g., ₹299/month for 100 generations, or per-credit packs

**Total to MVP: ~10 days** of solo Cursor + Claude work.

---

## 8. Cost & Risk Controls

- **Hard quota at DB level**: 10 free lifetime, enforced via RLS.
- **Per-user rate limit**: Max 1 generation in flight at a time per user.
- **API billing alert**: Set Google Cloud billing alert at ₹500–1000 threshold.
- **Image size cap**: Client-side resize uploads to max 2048px to control per-call cost.
- **Output moderation refund**: Failed outputs don't deduct quota.

---

## 9. Pre-Build Checklist

Before writing any code:

- [ ] Create empty Supabase project, save URL + anon key
- [ ] Get Google AI Studio API key for Gemini
- [ ] Set billing alert on Google Cloud
- [ ] Decide on trend taxonomy: flat list or categories (Movies, Anime, Memes, Seasonal)?
- [ ] Draft 3–5 launch trends with their prompt templates (real prompts shape how flexible the template field needs to be — e.g., placeholders like `{gender}`, `{age}` or static prompts)
- [ ] Decide on initial Pro plan pricing (can change later)

---

## 10. Open Questions for Later

- Should Quick generations count as 0.5 quota vs Pro at 1.0? Or both at 1.0 for v1 simplicity?
- Public gallery of community generations on each trend page — yes/no?
- Referral system (invite a friend = +5 free generations)?
- Trend categories or flat list?
- Watermark policy if abuse becomes an issue post-launch?
