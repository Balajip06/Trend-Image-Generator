# Phase 1 — Dual AI Provider + Safe Global Model Toggle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI gpt-image as a second image provider alongside Gemini, expose an admin global-default-model toggle backed by an `app_settings` DB table, and extend the eval proof gate to be model-aware — so a Gemini pass cannot certify OpenAI generation.

**Architecture:** `ImageModel` widens to a 3-value union (`'nano-banana' | 'nano-banana-pro' | 'gpt-image'`); `MODEL_PROVIDER` map derives the provider from the model (no separate env toggle needed per generation). The Deno Edge Function gains a parallel `callOpenAI` + `callProvider` dispatcher — it cannot share Node code, so the provider logic is duplicated with cross-reference comments. The global default lives in `app_settings` (key-value table); flipping it bulk-UPDATEs `trends.model` for non-pinned trends, which fires `bump_trend_version` → forces re-eval. The eval proof trigger gains a `model` column match.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase Postgres (PL/pgSQL), Deno Edge Function, Vitest, OpenAI Images API.

## Global Constraints

- `ImageModel` must be a string-literal union: `'nano-banana' | 'nano-banana-pro' | 'gpt-image'` — additive, existing values unchanged.
- OpenAI model ID is config: read from `OPENAI_IMAGE_MODEL` env (default `'gpt-image-1'`). Never hardcode.
- OpenAI cost constant: `0.04` USD/image (configurable; defined alongside Gemini costs).
- Every PL/pgSQL function: `security definer set search_path = public`.
- Migration files: `20260602NNNNNN_<slug>.sql` sequential timestamps.
- The Edge Function (`supabase/functions/generate-image/index.ts`) is Deno — cannot use Node imports. Keep Node lib and Deno code in sync manually; add cross-reference comment in both files.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must stay green (use `npx vitest run` / `npx tsc --noEmit` if pnpm approval issue).
- The admin settings action requires `requireAdminRole('admin')` (H-S2 from Phase 0 audit — but `lib/admin/require-role.ts` doesn't exist yet; create it in this phase).
- The `app.admin_actor` GUC approach doesn't work from PostgREST; use `logAdminAction({adminId})` (the `setVip` pattern) for the settings action audit trail.

---

## File Map

**Create:**

- `supabase/migrations/20260602000001_app_settings.sql` — `app_settings` table, RLS, audit trigger, seed row
- `supabase/migrations/20260602000002_trends_model_pinned.sql` — `trends.model_pinned` column + `trend_eval_runs.model` column + extend `require_eval_proof_for_passed` to match model
- `supabase/migrations/20260602000003_trend_model_enum_gpt.sql` — add `'gpt-image'` to `trend_model` enum
- `lib/admin/require-role.ts` — `requireAdminRole('admin' | 'editor')` helper
- `app/admin/(authed)/settings/page.tsx` — RSC settings page
- `app/admin/(authed)/settings/actions.ts` — server actions for global model flip
- `lib/image-provider/openai.ts` — replace stub with full implementation

**Modify:**

- `lib/image-provider/types.ts` — widen `ImageModel`, add `MODEL_PROVIDER` map
- `lib/image-provider/index.ts` — route by `MODEL_PROVIDER[args.model]` instead of env var
- `lib/gemini/cost.ts` — widen to provider-neutral; add `'gpt-image'` cost
- `lib/env.ts` — add `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, `IMAGE_PROVIDER` (all optional)
- `supabase/functions/generate-image/index.ts` — add `callOpenAI`, `callProvider` dispatcher, widen model maps
- `app/admin/(authed)/trends/actions.ts` — add `'gpt-image'` + `model_pinned` to `TrendUpsertSchema`
- `app/admin/(authed)/trends/TrendFormSections.tsx` — add gpt-image option + "Follow global default" option
- `components/admin/AdminShell.tsx` — add Settings nav item in Operations group

---

## Task 1 — Widen ImageModel + implement OpenAI provider (lib layer)

**Files:**

- Modify: `lib/image-provider/types.ts`
- Modify: `lib/image-provider/index.ts`
- Modify: `lib/gemini/cost.ts`
- Modify: `lib/env.ts`
- Modify: `lib/image-provider/openai.ts` (replace stub)
- Create: `lib/image-provider/openai.test.ts`

**Interfaces:**

- Produces: `ImageModel = 'nano-banana' | 'nano-banana-pro' | 'gpt-image'`
- Produces: `MODEL_PROVIDER: Record<ImageModel, ImageProvider>` mapping gpt-image → openai, others → gemini
- Produces: `costForOutput(model: ImageModel): number` — returns 0.04 for gpt-image
- Produces: `generateImage` in `openai.ts` — real implementation using `/v1/images/edits` (with imageUrls) or `/v1/images/generations` (without); mock-mode when no key

- [ ] **Step 1: Update `lib/image-provider/types.ts`**

Replace the `ImageModel` type and add `MODEL_PROVIDER`:

```typescript
import type { GeminiModel } from '@/lib/gemini/cost'

// Widen: add 'gpt-image' as a third model. Provider is derived from the model,
// not from a separate env var — one source of truth.
// See also: supabase/functions/generate-image/index.ts (Deno copy must stay in sync)
export type ImageModel = GeminiModel | 'gpt-image'

export const MODEL_PROVIDER: Record<ImageModel, ImageProvider> = {
  'nano-banana': 'gemini',
  'nano-banana-pro': 'gemini',
  'gpt-image': 'openai',
}

export interface GenerateImageArgs {
  model: ImageModel
  prompt: string
  /** Image URLs (Supabase Storage public/signed) passed as multimodal context. */
  imageUrls: string[]
  /** Hard wall-clock budget; default 90s. */
  timeoutMs?: number
}

// ... rest of types unchanged (GenerateImageOk, GenerateImageFail, GenerateImageResult, ImageProvider)
```

Keep all existing exported interfaces unchanged; only add `MODEL_PROVIDER` and widen `ImageModel`.

- [ ] **Step 2: Update `lib/image-provider/index.ts`**

Change `resolveProvider()` to derive from the model rather than a bare env var:

```typescript
import { MODEL_PROVIDER } from './types'

export async function generateImage(args: GenerateImageArgs): Promise<GenerateImageResult> {
  const provider = MODEL_PROVIDER[args.model] ?? 'gemini'
  switch (provider) {
    case 'openai':
      return openaiGenerate(args)
    case 'gemini':
    default:
      return geminiGenerate(args)
  }
}
```

Keep the `resolveProvider()` function for the `IMAGE_PROVIDER` env override (backward-compat fallback for the default model in non-trend contexts):

```typescript
function resolveProvider(model: ImageModel): ImageProvider {
  const envOverride = process.env.IMAGE_PROVIDER?.toLowerCase()
  if (envOverride === 'openai') return 'openai'
  if (envOverride === 'gemini') return 'gemini'
  return MODEL_PROVIDER[model] ?? 'gemini'
}
```

- [ ] **Step 3: Update `lib/gemini/cost.ts`**

Widen `costForOutput` to accept `ImageModel`:

```typescript
import type { ImageModel } from '@/lib/image-provider/types'

// Keep GeminiModel export for backward compat (Edge Function imports it)
export type GeminiModel = 'nano-banana' | 'nano-banana-pro'

const COST_USD_PER_IMAGE: Record<ImageModel, number> = {
  'nano-banana': 0.0039,
  'nano-banana-pro': 0.024,
  // OpenAI gpt-image medium-quality; update when pricing changes
  // See also: supabase/functions/generate-image/index.ts COST_USD (Deno copy)
  'gpt-image': 0.04,
}

export function costForOutput(model: ImageModel): number {
  return COST_USD_PER_IMAGE[model] ?? 0
}
```

- [ ] **Step 4: Update `lib/env.ts`**

Add three optional env vars after `GEMINI_API_KEY`:

```typescript
GEMINI_API_KEY: z.string().min(1).optional(),
OPENAI_API_KEY: z.string().min(1).optional(),
OPENAI_IMAGE_MODEL: z.string().min(1).optional(),
IMAGE_PROVIDER: z.enum(['gemini', 'openai']).optional(),
```

- [ ] **Step 5: Write the failing test `lib/image-provider/openai.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdef.supabase.co')

describe('openai generateImage', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdef.supabase.co')
  })

  it('returns mock PNG when OPENAI_API_KEY is not set', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const { generateImage } = await import('./openai')
    const result = await generateImage({
      model: 'gpt-image',
      prompt: 'test prompt',
      imageUrls: [],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.modelUsed).toMatch(/^mock:/)
      expect(result.costUsd).toBe(0.04)
    }
  })

  it('maps failure reason correctly for safety block', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key')
    vi.stubEnv('OPENAI_IMAGE_MODEL', 'gpt-image-1')
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: { code: 'content_policy_violation', message: 'Policy violation' },
        }),
    })
    const { generateImage } = await import('./openai')
    const result = await generateImage({
      model: 'gpt-image',
      prompt: 'test',
      imageUrls: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('safety')
  })

  it('maps 429 to transient', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key')
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })
    const { generateImage } = await import('./openai')
    const result = await generateImage({ model: 'gpt-image', prompt: 'test', imageUrls: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('transient')
  })
})
```

- [ ] **Step 6: Run — expect FAIL (module still a stub)**

```bash
npx vitest run lib/image-provider/openai.test.ts
```

Expected: FAIL — mock test passes but others fail (stub always returns `not-configured`).

- [ ] **Step 7: Implement `lib/image-provider/openai.ts`**

```typescript
/**
 * OpenAI image-generation client.
 *
 * Uses /v1/images/edits when imageUrls.length > 0 (identity-preserving,
 * multimodal), otherwise /v1/images/generations (text-only).
 * Response: b64_json → PNG Uint8Array.
 *
 * Failure taxonomy mirrors gemini.ts exactly:
 *   safety   → HTTP 400 with content_policy_violation code
 *   transient → HTTP 429 or 5xx
 *   timeout  → AbortError
 *   invalid  → other 4xx or malformed response
 *   not-configured → OPENAI_API_KEY missing
 *
 * Mock mode: returns MOCK_PNG_HEADER when OPENAI_API_KEY is unset.
 *
 * See also: supabase/functions/generate-image/index.ts callOpenAI (Deno copy)
 * — keep MODEL_ID, COST_USD, and failure taxonomy in sync.
 */

import { costForOutput } from '@/lib/gemini/cost'
import type { GenerateImageArgs, GenerateImageResult } from './types'

const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const MOCK_PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export async function generateImage(args: GenerateImageArgs): Promise<GenerateImageResult> {
  const apiKey = process.env.OPENAI_API_KEY
  const modelId = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1'

  if (!apiKey) {
    return {
      ok: true,
      outputPng: MOCK_PNG_HEADER,
      costUsd: costForOutput(args.model),
      modelUsed: `mock:${modelId}`,
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 90_000)

  try {
    let res: Response

    if (args.imageUrls.length > 0) {
      // Identity-preserving: use /v1/images/edits (multipart form)
      const form = new FormData()
      form.append('model', modelId)
      form.append('prompt', args.prompt)
      form.append('n', '1')
      form.append('response_format', 'b64_json')

      // Fetch each image URL and append as form parts
      for (let i = 0; i < args.imageUrls.length; i++) {
        const imgRes = await fetch(args.imageUrls[i], { redirect: 'error' })
        if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status} ${args.imageUrls[i]}`)
        const blob = await imgRes.blob()
        form.append(`image${i === 0 ? '' : `[${i}]`}`, blob, `image${i}.png`)
      }

      res = await fetch(`${OPENAI_BASE_URL}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      })
    } else {
      // Text-to-image: use /v1/images/generations
      res = await fetch(`${OPENAI_BASE_URL}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          prompt: args.prompt,
          n: 1,
          response_format: 'b64_json',
        }),
        signal: controller.signal,
      })
    }

    if (!res.ok) {
      const text = await res.text()
      // Safety / content policy rejection
      if (res.status === 400 && text.includes('content_policy_violation')) {
        return {
          ok: false,
          costUsd: 0,
          reason: 'safety',
          message: `OpenAI policy: ${text.slice(0, 200)}`,
        }
      }
      const transient = res.status === 429 || res.status >= 500
      return {
        ok: false,
        costUsd: 0,
        reason: transient ? 'transient' : 'invalid',
        message: `OpenAI ${res.status}: ${text.slice(0, 200)}`,
      }
    }

    interface OpenAIResponse {
      data?: Array<{ b64_json?: string }>
    }
    const json = (await res.json()) as OpenAIResponse
    const b64 = json.data?.[0]?.b64_json
    if (!b64) {
      return { ok: false, costUsd: 0, reason: 'invalid', message: 'No b64_json in OpenAI response' }
    }

    const outputPng = decodeBase64(b64)
    return {
      ok: true,
      outputPng,
      costUsd: costForOutput(args.model),
      modelUsed: modelId,
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, costUsd: 0, reason: 'timeout', message: 'OpenAI call timed out' }
    }
    const message = err instanceof Error ? err.message : 'unknown'
    return { ok: false, costUsd: 0, reason: 'transient', message }
  } finally {
    clearTimeout(timeout)
  }
}

function decodeBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'))
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
```

- [ ] **Step 8: Run tests — expect PASS**

```bash
npx vitest run lib/image-provider/openai.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 9: Run full suite + typecheck**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: typecheck clean, 567/569 passing (same 2 pre-existing failures).

- [ ] **Step 10: Commit**

```bash
git add lib/image-provider/types.ts lib/image-provider/index.ts lib/image-provider/openai.ts \
        lib/image-provider/openai.test.ts lib/gemini/cost.ts lib/env.ts
git commit -m "feat(providers): add OpenAI gpt-image provider, widen ImageModel to 3-value union"
```

---

## Task 2 — Edge Function: add callOpenAI + callProvider dispatcher

**Files:**

- Modify: `supabase/functions/generate-image/index.ts`

**Interfaces:**

- Consumes: nothing new from prior tasks (Deno standalone; no shared imports)
- Produces: `callProvider(model, prompt, imageUrls)` dispatcher used at generation time

**Note:** This is Deno — no Node imports. The OpenAI implementation is a parallel copy of the Node lib, not an import. The model union type is local to this file. Cross-reference comments point to `lib/image-provider/openai.ts`.

- [ ] **Step 1: Widen `TrendRow['model']` type in the Edge Function**

In `supabase/functions/generate-image/index.ts`, change:

```typescript
// Old:
interface TrendRow {
  // ...
  model: 'nano-banana' | 'nano-banana-pro'
}

// New:
type EdgeImageModel = 'nano-banana' | 'nano-banana-pro' | 'gpt-image'
type EdgeProvider = 'gemini' | 'openai'

interface TrendRow {
  // ...
  model: EdgeImageModel
}
```

- [ ] **Step 2: Extend COST_USD and MODEL_ID maps**

```typescript
// See also: lib/gemini/cost.ts COST_USD_PER_IMAGE (Node copy — keep in sync)
const COST_USD: Record<EdgeImageModel, number> = {
  'nano-banana': 0.0039,
  'nano-banana-pro': 0.024,
  'gpt-image': 0.04,
}

// Gemini model IDs — not used for OpenAI
const GEMINI_MODEL_ID: Record<'nano-banana' | 'nano-banana-pro', string> = {
  'nano-banana': 'gemini-2.5-flash-image',
  'nano-banana-pro': 'gemini-3.0-pro-image',
}

const MODEL_PROVIDER: Record<EdgeImageModel, EdgeProvider> = {
  'nano-banana': 'gemini',
  'nano-banana-pro': 'gemini',
  'gpt-image': 'openai',
}
```

- [ ] **Step 3: Add `callOpenAI` function after `callGemini`**

Add after the existing `callGemini` function:

```typescript
/**
 * OpenAI image generation (Deno).
 * See also: lib/image-provider/openai.ts (Node copy — keep failure taxonomy in sync)
 */
async function callOpenAI(prompt: string, imageUrls: string[]): Promise<GeminiOk | GeminiFail> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  const modelId = Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-1'

  if (!apiKey) return { ok: false, reason: 'invalid', message: 'OPENAI_API_KEY missing' }

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)

  try {
    let res: Response

    if (imageUrls.length > 0) {
      const form = new FormData()
      form.append('model', modelId)
      form.append('prompt', prompt)
      form.append('n', '1')
      form.append('response_format', 'b64_json')

      for (let i = 0; i < imageUrls.length; i++) {
        const imgRes = await fetchAsInlineData(imageUrls[i])
        // fetchAsInlineData returns inlineData; for OpenAI we need the raw bytes
        // Re-fetch with no encoding
        const rawRes = await fetch(imageUrls[i])
        if (!rawRes.ok) throw new Error(`image fetch ${rawRes.status}: ${imageUrls[i]}`)
        const blob = await rawRes.blob()
        form.append(i === 0 ? 'image' : `image[${i}]`, blob, `image${i}.png`)
      }

      res = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      })
    } else {
      res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelId, prompt, n: 1, response_format: 'b64_json' }),
        signal: controller.signal,
      })
    }

    if (!res.ok) {
      const text = await res.text()
      if (res.status === 400 && text.includes('content_policy_violation')) {
        return { ok: false, reason: 'safety', message: `OpenAI policy: ${text.slice(0, 200)}` }
      }
      const transient = res.status === 429 || res.status >= 500
      return {
        ok: false,
        reason: transient ? 'transient' : 'invalid',
        message: `OpenAI ${res.status}: ${text.slice(0, 200)}`,
      }
    }

    interface OpenAIResponse {
      data?: Array<{ b64_json?: string }>
    }
    const json = (await res.json()) as OpenAIResponse
    const b64 = json.data?.[0]?.b64_json
    if (!b64) return { ok: false, reason: 'invalid', message: 'no b64_json in OpenAI response' }
    return { ok: true, outputPng: decodeBase64(b64) }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: 'OpenAI call timed out' }
    }
    return {
      ok: false,
      reason: 'transient',
      message: err instanceof Error ? err.message : 'unknown',
    }
  } finally {
    clearTimeout(t)
  }
}
```

- [ ] **Step 4: Add `callProvider` dispatcher**

```typescript
async function callProvider(
  model: EdgeImageModel,
  prompt: string,
  imageUrls: string[]
): Promise<GeminiOk | GeminiFail> {
  const provider = MODEL_PROVIDER[model]
  if (provider === 'openai') return callOpenAI(prompt, imageUrls)
  return callGemini(model as 'nano-banana' | 'nano-banana-pro', prompt, imageUrls)
}
```

- [ ] **Step 5: Replace `callGemini(trendData.model, ...)` with `callProvider`**

In the `process` function, find the Gemini call (around line 153):

```typescript
// Old:
const result = await callGemini(trendData.model, prompt, imageUrls)

// New:
const result = await callProvider(trendData.model, prompt, imageUrls)
```

Also update the cost/model_used recording after step 6 (around line 200):

```typescript
// Old:
cost_usd: COST_USD[trendData.model],
model_used: MODEL_ID[trendData.model],

// New:
cost_usd: COST_USD[trendData.model],
model_used: trendData.model === 'gpt-image'
  ? (Deno.env.get('OPENAI_IMAGE_MODEL') ?? 'gpt-image-1')
  : GEMINI_MODEL_ID[trendData.model as 'nano-banana' | 'nano-banana-pro'],
```

- [ ] **Step 6: Add OPENAI_API_KEY + OPENAI_IMAGE_MODEL to Edge Function header comment**

Update the comment block at the top (around line 5):

```typescript
//   3. Function secrets: GEMINI_API_KEY, OPENAI_API_KEY, OPENAI_IMAGE_MODEL,
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected by Supabase)
```

- [ ] **Step 7: Typecheck the Edge Function**

```bash
npx tsc --noEmit supabase/functions/generate-image/index.ts 2>&1 | head -20
```

Expected: clean (or only Deno-specific import errors which are expected in Node typecheck).

- [ ] **Step 8: Run full suite**

```bash
npx vitest run
```

Expected: 567/569 passing.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/generate-image/index.ts
git commit -m "feat(edge): add callOpenAI + callProvider dispatcher to Edge Function"
```

---

## Task 3 — DB migrations: app_settings, model_pinned, eval model-awareness, gpt-image enum

**Files:**

- Create: `supabase/migrations/20260602000001_app_settings.sql`
- Create: `supabase/migrations/20260602000002_trends_model_pinned.sql`
- Create: `supabase/migrations/20260602000003_trend_model_enum_gpt.sql`

**Interfaces:**

- Produces: `app_settings(key text pk, value jsonb, updated_by uuid, updated_at timestamptz)`
- Produces: `trends.model_pinned boolean default true`
- Produces: `trend_eval_runs.model text` — the model the run was generated with
- Produces: `require_eval_proof_for_passed` checks `r.model = new.model`
- Produces: `trend_model` enum includes `'gpt-image'`

**Note:** The enum migration (0003) must be last because `'gpt-image'` is used in the schema actions (Task 4) and the trigger (0002) after the enum exists.

- [ ] **Step 1: Write `20260602000001_app_settings.sql`**

```sql
-- 20260602000001_app_settings.sql
-- Phase 1: global app settings key-value store.
-- Used for: default_image_model (the global model default admins can toggle).
-- RLS: admin-read only (mirrors admin_audit_log_admin_read policy).
-- Writes: service-role only (admin server action + logAdminAction for audit trail).

create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Admin read: any row in admin_users can read all settings
create policy "app_settings_admin_read" on public.app_settings
  for select using (
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );
-- No insert/update/delete policy — writes via service-role only

-- Seed the default model value
insert into public.app_settings (key, value)
values ('default_image_model', '"nano-banana-pro"'::jsonb);

comment on table public.app_settings is
  'Global app-level config key-value store. Currently: default_image_model.';
comment on column public.app_settings.value is
  'JSON scalar or object. For default_image_model: one of "nano-banana", "nano-banana-pro", "gpt-image".';
```

- [ ] **Step 2: Write `20260602000002_trends_model_pinned.sql`**

```sql
-- 20260602000002_trends_model_pinned.sql
-- Phase 1: model_pinned column on trends + model column on trend_eval_runs.
--
-- model_pinned = true  → this trend uses its own explicit model value.
-- model_pinned = false → this trend inherits the global default from app_settings.
--
-- When the admin flips the global default, the settings action bulk-UPDATEs
-- trends SET model = <new> WHERE model_pinned = false, which fires
-- bump_trend_version → eval_status='untested' + is_active=false for each.
--
-- trend_eval_runs.model: records which model the run was generated with.
-- require_eval_proof_for_passed now requires a passing run for the CURRENT
-- (version, model) pair — a Gemini pass cannot certify an OpenAI serving.

-- 1. Add model_pinned to trends (existing trends default to pinned=true)
alter table public.trends
  add column if not exists model_pinned boolean not null default true;

-- New trends created via admin form will have model_pinned=false by default
-- (inherits global default). The form sends model_pinned explicitly.

-- 2. Add model column to trend_eval_runs
alter table public.trend_eval_runs
  add column if not exists model text;

-- Backfill existing runs with the trend's current model (best approximation)
update public.trend_eval_runs ter
   set model = t.model::text
  from public.trends t
 where ter.trend_id = t.id
   and ter.model is null;

-- 3. Extend require_eval_proof_for_passed to be model-aware
--    The trigger now requires a passing run matching (trend_id, prompt_version, model).
create or replace function public.require_eval_proof_for_passed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_pass_count int;
begin
  if new.eval_status is not distinct from old.eval_status then
    return new;
  end if;
  if new.eval_status <> 'passed' then
    return new;
  end if;

  -- Require at least one eval run with admin_rating='pass' matching
  -- the current (version, model). A Gemini-passing run does NOT certify
  -- an OpenAI generation, and vice versa (H-M1 from Phase 0 audit).
  select count(*) into v_pass_count
    from public.trend_eval_runs r
   where r.trend_id       = new.id
     and r.prompt_version = new.version
     and r.admin_rating   = 'pass'
     and (r.model = new.model::text or r.model is null);
     -- r.model IS NULL: backwards compat for runs created before this migration
     -- that were backfilled. Once all runs carry a model value, drop the IS NULL
     -- clause (add a comment to revisit after all historical runs are migrated).

  if v_pass_count = 0 then
    raise exception 'eval proof missing: trends.eval_status cannot be set to ''passed'' for trend % version % model % — no trend_eval_runs row with admin_rating=''pass'' exists for this (version, model)',
      new.id, new.version, new.model
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
```

- [ ] **Step 3: Write `20260602000003_trend_model_enum_gpt.sql`**

```sql
-- 20260602000003_trend_model_enum_gpt.sql
-- Phase 1: extend trend_model enum with 'gpt-image'.
-- Must be a separate migration/transaction — Postgres requires ALTER TYPE
-- ADD VALUE to run outside any function body that uses the new value.

alter type public.trend_model add value if not exists 'gpt-image';
```

- [ ] **Step 4: Apply all three migrations**

```bash
./node_modules/.bin/supabase db reset
```

Expected: all migrations apply cleanly.

- [ ] **Step 5: Verify schema**

```bash
./node_modules/.bin/supabase db query "
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'trends' AND column_name = 'model_pinned';
" 2>&1 | grep model_pinned

./node_modules/.bin/supabase db query "
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'trend_eval_runs' AND column_name = 'model';
" 2>&1 | grep model

./node_modules/.bin/supabase db query "
  SELECT key, value FROM app_settings;
" 2>&1
```

Expected: all three queries return results; `app_settings` shows `default_image_model = "nano-banana-pro"`.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: 567/569.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260602000001_app_settings.sql \
        supabase/migrations/20260602000002_trends_model_pinned.sql \
        supabase/migrations/20260602000003_trend_model_enum_gpt.sql
git commit -m "feat(db): app_settings table, model_pinned on trends, model-aware eval proof"
```

---

## Task 4 — Admin settings page + requireAdminRole helper

**Files:**

- Create: `lib/admin/require-role.ts`
- Create: `app/admin/(authed)/settings/page.tsx`
- Create: `app/admin/(authed)/settings/actions.ts`
- Modify: `components/admin/AdminShell.tsx` (add Settings nav item)

**Interfaces:**

- Consumes: `app_settings` table (Task 3), `createClient`/`createServiceClient` from `lib/supabase/server`
- Produces: `requireAdminRole(min)` helper used in settings action and future money actions
- Produces: `/admin/settings` page with a global model radio toggle

- [ ] **Step 1: Write `lib/admin/require-role.ts`**

```typescript
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type AdminRole = 'admin' | 'editor'

/**
 * Gate for money/eligibility admin actions (H-S2 / Risk #14).
 * Reads admin_users.role for the current session user.
 * Redirects to /admin/login?error=forbidden if the user is not at least `min` role.
 *
 * Call at the TOP of every server action that grants entitlements or modifies
 * global settings (VIP, KIMP allowlist, app_settings, credit refunds).
 *
 * Role hierarchy: admin > editor. Minimum 'editor' accepts both; 'admin' rejects editors.
 */
export async function requireAdminRole(
  min: AdminRole = 'editor'
): Promise<{ userId: string; role: AdminRole }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  const { data: adminRow } = await supabase
    .from('admin_users')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!adminRow) redirect('/admin/login?error=not_admin')

  if (min === 'admin' && adminRow.role !== 'admin') {
    redirect('/admin/login?error=forbidden')
  }

  return { userId: user.id, role: adminRow.role as AdminRole }
}
```

- [ ] **Step 2: Write `app/admin/(authed)/settings/actions.ts`**

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAdminAction } from '@/lib/admin/audit'
import { requireAdminRole } from '@/lib/admin/require-role'
import { createServiceClient } from '@/lib/supabase/server'

const ModelSchema = z.enum(['nano-banana', 'nano-banana-pro', 'gpt-image'])

export async function setGlobalDefaultModel(
  formData: FormData
): Promise<{ error?: string; affectedTrends?: string[] }> {
  // Only 'admin' role can change global model (H-S2)
  const { userId } = await requireAdminRole('admin')

  const parsed = ModelSchema.safeParse(formData.get('model'))
  if (!parsed.success) return { error: 'Invalid model value' }
  const newModel = parsed.data

  const service = createServiceClient()

  // 1. Read current default
  const { data: current } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'default_image_model')
    .maybeSingle()

  const currentModel =
    (current?.value as string | undefined)?.replace(/"/g, '') ?? 'nano-banana-pro'
  if (currentModel === newModel) return {} // No change

  // 2. Find live non-pinned trends that will be affected
  const { data: affectedRows } = await service
    .from('trends')
    .select('slug')
    .eq('model_pinned', false)
    .eq('is_active', true)

  const affectedSlugs = (affectedRows ?? []).map((r: { slug: string }) => r.slug)

  // 3. Bulk-UPDATE non-pinned trends to the new model.
  //    This fires bump_trend_version → eval_status='untested' + is_active=false per row.
  //    These trends go dark until re-evaluated. This is intentional and correct (H-M2).
  if (affectedSlugs.length > 0) {
    await service.from('trends').update({ model: newModel }).eq('model_pinned', false)
  }

  // 4. Write the new global default
  await service
    .from('app_settings')
    .update({
      value: JSON.stringify(newModel),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('key', 'default_image_model')

  // 5. Audit trail (H-S9: app.admin_actor GUC doesn't work via PostgREST; use logAdminAction)
  await logAdminAction({
    adminId: userId,
    action: 'model_provider_switched',
    targetTable: 'app_settings',
    targetId: 'default_image_model',
    before: { model: currentModel },
    after: { model: newModel, affected_trend_count: affectedSlugs.length },
  })

  revalidatePath('/admin/settings')
  revalidatePath('/admin/trends')

  return { affectedTrends: affectedSlugs }
}
```

- [ ] **Step 3: Write `app/admin/(authed)/settings/page.tsx`**

```tsx
import { createServiceClient } from '@/lib/supabase/server'
import { setGlobalDefaultModel } from './actions'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const service = createServiceClient()
  const { data: setting } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'default_image_model')
    .maybeSingle()

  const currentModel =
    (setting?.value as string | undefined)?.replace(/"/g, '') ?? 'nano-banana-pro'

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">Global configuration for all trends.</p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-medium">Default Generation Model</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Applies to all trends with &ldquo;Follow global default&rdquo; selected. Changing this
            will deactivate live non-pinned trends until they are re-evaluated.
          </p>
        </div>

        <form action={setGlobalDefaultModel} className="space-y-3">
          {(['nano-banana', 'nano-banana-pro', 'gpt-image'] as const).map((model) => (
            <label key={model} className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="model"
                value={model}
                defaultChecked={currentModel === model}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">{model}</span>
              {model === 'nano-banana-pro' && (
                <span className="text-muted-foreground text-xs">(Gemini — quality default)</span>
              )}
              {model === 'nano-banana' && (
                <span className="text-muted-foreground text-xs">(Gemini — fast/cheap)</span>
              )}
              {model === 'gpt-image' && (
                <span className="text-muted-foreground text-xs">
                  (OpenAI — requires OPENAI_API_KEY)
                </span>
              )}
            </label>
          ))}

          <button
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Add Settings to `AdminShell.tsx` nav**

In `components/admin/AdminShell.tsx`, find the `Operations` group items array. Add a Settings item:

```typescript
// Add this import at the top:
import { Settings } from 'lucide-react'

// In NAV_GROUPS Operations.items, add:
{
  href: '/admin/settings',
  label: 'Settings',
  icon: <Settings className="size-4" />,
},
```

- [ ] **Step 5: Run typecheck + build**

```bash
npx tsc --noEmit && pnpm build
```

Expected: clean build, 30+ routes.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: 567/569.

- [ ] **Step 7: Commit**

```bash
git add lib/admin/require-role.ts \
        app/admin/\(authed\)/settings/page.tsx \
        app/admin/\(authed\)/settings/actions.ts \
        components/admin/AdminShell.tsx
git commit -m "feat(admin): settings page with global model toggle, requireAdminRole helper"
```

---

## Task 5 — Trend editor: add gpt-image + model_pinned support

**Files:**

- Modify: `app/admin/(authed)/trends/actions.ts` (widen Zod schema)
- Modify: `app/admin/(authed)/trends/TrendFormSections.tsx` (add gpt-image option + Follow default)

**Interfaces:**

- Consumes: `trends.model_pinned` (Task 3), `trend_model` enum with `'gpt-image'` (Task 3)

- [ ] **Step 1: Update `TrendUpsertSchema` in `trends/actions.ts`**

Find `model: z.enum(['nano-banana', 'nano-banana-pro'])` and change to:

```typescript
model: z.enum(['nano-banana', 'nano-banana-pro', 'gpt-image']),
model_pinned: z.coerce.boolean().default(true),
```

Also add `model_pinned` to the upsert data object passed to Supabase (find the object that spreads `parsed.data` fields).

- [ ] **Step 2: Update the model `<select>` in `TrendFormSections.tsx`**

Find `TrendFormValues` interface; add `model_pinned?: boolean`.

Find the model `<select>` field around line 123. Replace with:

```tsx
<Field label="Model" htmlFor="model">
  <select
    id="model"
    name="model"
    defaultValue={initial.model ?? 'nano-banana-pro'}
    className={selectClasses}
  >
    <option value="nano-banana-pro">nano-banana-pro (Gemini — quality)</option>
    <option value="nano-banana">nano-banana (Gemini — fast)</option>
    <option value="gpt-image">gpt-image (OpenAI)</option>
  </select>
</Field>
<Field label="Model source" htmlFor="model_pinned">
  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      id="model_pinned"
      name="model_pinned"
      value="true"
      defaultChecked={initial.model_pinned ?? true}
    />
    Pin model (uncheck to follow global default)
  </label>
</Field>
```

- [ ] **Step 3: Run typecheck + tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/admin/\(authed\)/trends/actions.ts \
        app/admin/\(authed\)/trends/TrendFormSections.tsx
git commit -m "feat(admin): add gpt-image + model_pinned to trend editor"
```

---

## Task 6 — Verify end-to-end: mock mode, eval invalidation

**Files:**

- No new files — verification only

**This task has no code changes** — it's a verification checklist to confirm all pieces work together before shipping.

- [ ] **Step 1: Verify mock mode works for all 3 models**

```bash
# Start dev server, then verify generation doesn't crash for gpt-image in mock mode
# (no API keys needed — mock returns stub PNG)
GEMINI_API_KEY="" OPENAI_API_KEY="" npx vitest run lib/image-provider/
```

Expected: all provider tests pass.

- [ ] **Step 2: Verify global flip invalidates non-pinned trends**

Write a quick Vitest-compatible SQL test or use `supabase db query`:

```bash
./node_modules/.bin/supabase db query "
-- Setup: create a non-pinned trend at version 1 with eval_status='untested'
-- Then simulate an admin update to the model via the settings path
-- by running the bulk UPDATE that settings/actions.ts would do.

-- First confirm: do non-pinned trends exist?
SELECT count(*) FROM trends WHERE model_pinned = false;
" 2>&1
```

- [ ] **Step 3: Verify eval proof rejects cross-model pass**

```bash
./node_modules/.bin/supabase db query "
SELECT proname, prosrc FROM pg_proc
WHERE proname = 'require_eval_proof_for_passed'
AND prosrc LIKE '%r.model%';" 2>&1
```

Expected: returns a row confirming the function body includes `r.model` check.

- [ ] **Step 4: Run full suite one final time**

```bash
npx tsc --noEmit && npx vitest run && pnpm build
```

Expected: typecheck clean, 567/569, build clean (30+ routes).

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "chore(phase-1): verification complete — all 3 providers work in mock mode, eval gate is model-aware"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement                                                                         | Task covering it |
| ---------------------------------------------------------------------------------------- | ---------------- |
| `ImageModel` widens to 3-value union                                                     | Task 1           |
| `MODEL_PROVIDER` map derives provider from model                                         | Task 1           |
| OpenAI `/v1/images/edits` (with images) + `/v1/images/generations` (without)             | Task 1           |
| OpenAI failure taxonomy mirrors Gemini                                                   | Task 1           |
| OpenAI mock-mode when no key                                                             | Task 1           |
| `'gpt-image': 0.04` cost entry                                                           | Task 1           |
| `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` in `lib/env.ts`                                   | Task 1           |
| Edge Function `callOpenAI` + `callProvider` dispatcher                                   | Task 2           |
| Edge Function model/cost maps widened to include gpt-image                               | Task 2           |
| `app_settings` table with RLS + seed row                                                 | Task 3           |
| `trends.model_pinned` column                                                             | Task 3           |
| `trend_eval_runs.model` column                                                           | Task 3           |
| `require_eval_proof_for_passed` checks `r.model = new.model` (H-M1)                      | Task 3           |
| `trend_model` enum includes `'gpt-image'`                                                | Task 3           |
| `requireAdminRole('admin')` helper (H-S2)                                                | Task 4           |
| `/admin/settings` page with radio toggle                                                 | Task 4           |
| Settings action bulk-UPDATEs non-pinned trends → fires bump_version → dark until re-eval | Task 4           |
| `logAdminAction` for audit trail (not GUC — H-S9)                                        | Task 4           |
| Settings nav item in AdminShell Operations group                                         | Task 4           |
| Trend editor: `gpt-image` option + `model_pinned` checkbox                               | Task 5           |
| `TrendUpsertSchema` widens model + adds model_pinned                                     | Task 5           |
| End-to-end verification                                                                  | Task 6           |
