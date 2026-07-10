import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// Default Gemini mock — overridden per test by reassigning mockGenerateImageImpl.
let mockGenerateImageImpl: (args: unknown) => Promise<unknown> = async () => ({
  ok: true,
  outputPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  costUsd: 0.039,
  modelUsed: 'gemini-2.5-flash-image',
})

vi.mock('@/lib/image-provider', () => ({
  generateImage: vi.fn((args: unknown) => mockGenerateImageImpl(args)),
}))

interface ChainOverrides {
  // Per-table fetch results (used by maybeSingle)
  trendFetchResult?: { data: unknown; error: { message: string } | null } | null
  // For listing inputs: .eq(...) on a select chain
  inputsListResult?: { data: unknown; error: { message: string } | null }
  // For insertion into trend_eval_inputs / trend_eval_runs
  insertResult?: { data: unknown; error: { message: string } | null }
  // For update results
  updateResult?: { error: { message: string } | null }
  // Storage upload
  uploadResult?: { error: { message: string } | null }
  publicUrl?: string
}

function makeMockSupabase(overrides: ChainOverrides = {}) {
  const inputsList = overrides.inputsListResult ?? { data: [], error: null }
  const updateResult = overrides.updateResult ?? { error: null }
  const insertResult = overrides.insertResult ?? { data: { id: 'new-id' }, error: null }
  const trendFetchResult =
    overrides.trendFetchResult === undefined
      ? {
          data: {
            id: 'trend-1',
            prompt_template: 'do thing',
            model: 'nano-banana-2',
            version: 3,
            input_schema: {
              fields: [
                {
                  type: 'image',
                  name: 'user_photo',
                  label: 'Your photo',
                  required: true,
                  min_count: 1,
                  max_count: 1,
                },
              ],
            },
          },
          error: null,
        }
      : overrides.trendFetchResult
  const uploadResult = overrides.uploadResult ?? { error: null }
  const publicUrl = overrides.publicUrl ?? 'https://cdn.example.com/eval/abc.png'

  // Track operation state to switch behavior in eq(): select(...).eq(...) for inputs
  // vs update(...).eq(...) for writes.
  let lastOp: 'select' | 'update' | 'delete' | 'insert' = 'select'
  let lastTable: string | null = null

  const fromImpl = (table: string) => {
    lastTable = table
    const chain = {
      insert: vi.fn(function (this: unknown) {
        lastOp = 'insert'
        return chain
      }),
      update: vi.fn(function (this: unknown) {
        lastOp = 'update'
        return chain
      }),
      delete: vi.fn(function (this: unknown) {
        lastOp = 'delete'
        return chain
      }),
      select: vi.fn(function (this: unknown) {
        if (lastOp !== 'insert') lastOp = 'select'
        return chain
      }),
      eq: vi.fn(function (this: unknown) {
        // For select().eq().maybeSingle() this is intermediate.
        // For select(...).eq(...) terminal (list query), return the list result.
        // For update().eq() the action awaits this directly.
        if (lastOp === 'update') {
          return Promise.resolve(updateResult)
        }
        if (lastOp === 'delete') {
          return Promise.resolve({ error: null })
        }
        // select() chain — could be terminal (list) or precede maybeSingle().
        // Return an object that is both awaitable (resolves to list) and chainable.
        const thenable = {
          then: (resolve: (v: unknown) => void) => resolve(inputsList),
          maybeSingle: chain.maybeSingle,
          eq: chain.eq,
        }
        return thenable
      }),
      maybeSingle: vi.fn(() => {
        if (lastTable === 'trends') return Promise.resolve(trendFetchResult)
        if (lastOp === 'insert') return Promise.resolve(insertResult)
        if (lastTable === 'trend_eval_inputs') {
          const rows = (inputsList.data ?? []) as Array<{ id: string }>
          return Promise.resolve({ data: rows[0] ?? null, error: inputsList.error })
        }
        return Promise.resolve({ data: null, error: null })
      }),
    }
    return chain
  }

  const storageBucket = {
    upload: vi.fn(() => Promise.resolve(uploadResult)),
    getPublicUrl: vi.fn(() => ({ data: { publicUrl } })),
  }

  const supabase = {
    from: vi.fn(fromImpl),
    storage: {
      from: vi.fn(() => storageBucket),
    },
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: { id: 'admin-user-1' } }, error: null })
      ),
    },
    _lastTable: () => lastTable,
    _storageBucket: storageBucket,
  }
  return supabase
}

let mockSupabase = makeMockSupabase()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
  createServiceClient: vi.fn(() => mockSupabase),
}))

import { addEvalInput, removeEvalInput, runEval, rateEvalRun, markTrendEval } from './actions'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { generateImage } from '@/lib/image-provider'

function lastRedirectUrl(): string {
  const calls = (redirect as unknown as { mock: { calls: [string][] } }).mock.calls
  return calls[calls.length - 1]?.[0] ?? ''
}

function makeAddInputForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const defaults: Record<string, string> = {
    label: 'Sample person',
    image_url: 'https://example.com/photo.jpg',
  }
  const merged = { ...defaults, ...overrides }
  for (const [k, v] of Object.entries(merged)) {
    fd.set(k, v)
  }
  return fd
}

// collectImageInputs runs an SSRF guard (assertStorageUrl) that only accepts
// URLs on the project's Supabase host in the `uploads` bucket. Eval test photos
// are real uploads, so the fixtures must use a valid uploads URL.
const SUPABASE_HOST = 'https://proj.supabase.co'
const UPLOADS_URL = `${SUPABASE_HOST}/storage/v1/object/public/uploads/a.jpg`

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_HOST
  mockSupabase = makeMockSupabase()
  mockGenerateImageImpl = async () => ({
    ok: true,
    outputPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    costUsd: 0.039,
    modelUsed: 'gemini-2.5-flash-image',
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('addEvalInput', () => {
  it('redirects with ?added=1 on success', async () => {
    await expect(addEvalInput('trend-1', makeAddInputForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/trend-1/eval?added=1')
  })

  it('rejects invalid URL with ?error=...', async () => {
    const fd = makeAddInputForm({ image_url: 'not-a-url' })
    await expect(addEvalInput('trend-1', fd)).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\/trend-1\/eval\?error=/)
  })

  it('rejects missing label', async () => {
    const fd = makeAddInputForm({ label: '' })
    await expect(addEvalInput('trend-1', fd)).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\/trend-1\/eval\?error=/)
  })

  it('redirects ?error= on Supabase insert error', async () => {
    mockSupabase = makeMockSupabase({
      updateResult: { error: null },
    })
    // Override the insert flow: monkey-patch chain to return error after insert().
    // Easiest: rebuild with a different chain via from() override.
    const origFrom = mockSupabase.from
    mockSupabase.from = vi.fn((table: string) => {
      const chain = origFrom(table) as Record<string, unknown>
      chain.insert = vi.fn(() =>
        Promise.resolve({ error: { message: 'fk violation' } })
      ) as unknown as typeof chain.insert
      return chain as ReturnType<typeof origFrom>
    }) as typeof mockSupabase.from
    await expect(addEvalInput('trend-1', makeAddInputForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\/trend-1\/eval\?error=fk%20violation/)
  })
})

describe('removeEvalInput', () => {
  it('deletes by id and returns ok, revalidates', async () => {
    const result = await removeEvalInput('trend-1', 'input-9')
    expect(result).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends/trend-1/eval')
  })

  it('returns ok:false on delete error', async () => {
    mockSupabase = makeMockSupabase()
    const origFrom = mockSupabase.from
    mockSupabase.from = vi.fn((table: string) => {
      const chain = origFrom(table) as Record<string, unknown>
      chain.delete = vi.fn(function (this: unknown) {
        return { eq: vi.fn(() => Promise.resolve({ error: { message: 'denied' } })) }
      }) as unknown as typeof chain.delete
      return chain as ReturnType<typeof origFrom>
    }) as typeof mockSupabase.from
    const result = await removeEvalInput('trend-1', 'input-9')
    expect(result).toEqual({ ok: false, error: 'denied' })
  })
})

describe('runEval', () => {
  it('returns ok:false when trend missing', async () => {
    mockSupabase = makeMockSupabase({ trendFetchResult: { data: null, error: null } })
    const result = await runEval('missing-trend', 'input-1')
    expect(result).toEqual({ ok: false, error: 'Trend not found.' })
  })

  it('returns ok:false when input missing', async () => {
    mockSupabase = makeMockSupabase({ inputsListResult: { data: [], error: null } })
    const result = await runEval('trend-1', 'missing-input')
    expect(result).toEqual({ ok: false, error: 'Reference photo not found.' })
  })

  it('happy path: inserts run, calls Gemini exactly once, uploads PNG, returns ok', async () => {
    mockSupabase = makeMockSupabase({
      inputsListResult: {
        data: [{ id: 'input-1', image_url: UPLOADS_URL }],
        error: null,
      },
    })
    const result = await runEval('trend-1', 'input-1')
    expect(result).toEqual({ ok: true })
    // Regression guard: this action must fire exactly one generation call per
    // invocation — bulk-firing across every reference photo is the behavior
    // this redesign explicitly removes.
    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'nano-banana-2',
        prompt: expect.stringContaining('do thing'),
        imageUrls: [UPLOADS_URL],
      })
    )
    const sentPrompt = (generateImage as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .prompt as string
    expect(sentPrompt).toContain('visible pores')
    expect(mockSupabase._storageBucket.upload).toHaveBeenCalled()
    const uploadCalls = mockSupabase._storageBucket.upload.mock.calls as unknown as Array<
      [string, unknown, unknown]
    >
    expect(uploadCalls[0]?.[0]).toMatch(/^eval\/trend-1\/new-id\.png$/)
  })

  it('uses the model override when provided, not the trend default', async () => {
    mockSupabase = makeMockSupabase({
      inputsListResult: {
        data: [{ id: 'input-1', image_url: UPLOADS_URL }],
        error: null,
      },
    })
    // Trend fixture model is 'nano-banana-2'; override with gpt-image-2.
    const result = await runEval('trend-1', 'input-1', 'gpt-image-2')
    expect(result).toEqual({ ok: true })
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-2' })
    )
  })

  it('Gemini error: returns ok:false with the provider message, does not upload', async () => {
    mockSupabase = makeMockSupabase({
      inputsListResult: {
        data: [{ id: 'input-1', image_url: UPLOADS_URL }],
        error: null,
      },
    })
    mockGenerateImageImpl = async () => ({
      ok: false,
      reason: 'safety',
      message: 'blocked',
      costUsd: 0,
    })
    const result = await runEval('trend-1', 'input-1')
    expect(result).toEqual({ ok: false, error: 'blocked' })
    expect(mockSupabase._storageBucket.upload).not.toHaveBeenCalled()
  })

  it('storage upload error returns ok:false, short-circuits before the post-upload update', async () => {
    mockSupabase = makeMockSupabase({
      inputsListResult: {
        data: [{ id: 'input-1', image_url: UPLOADS_URL }],
        error: null,
      },
      uploadResult: { error: { message: 'storage down' } },
    })
    const result = await runEval('trend-1', 'input-1')
    expect(result).toEqual({ ok: false, error: 'storage down' })
    expect(mockSupabase._storageBucket.upload).toHaveBeenCalled()
    // getPublicUrl should never be reached if upload failed
    expect(mockSupabase._storageBucket.getPublicUrl).not.toHaveBeenCalled()
  })
})

describe('rateEvalRun', () => {
  it('updates the run with the rating, revalidates eval page, returns ok', async () => {
    const result = await rateEvalRun('trend-1', 'run-1', 'pass')
    expect(result).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends/trend-1/eval')
    expect(mockSupabase.from).toHaveBeenCalledWith('trend_eval_runs')
  })

  it('returns ok:false on update error', async () => {
    mockSupabase = makeMockSupabase({ updateResult: { error: { message: 'denied' } } })
    const result = await rateEvalRun('trend-1', 'run-1', 'fail')
    expect(result).toEqual({ ok: false, error: 'denied' })
  })
})

describe('markTrendEval', () => {
  it('marks passed: redirects ?marked-passed=1 and revalidates 3 paths', async () => {
    await expect(markTrendEval('trend-1', 'passed')).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/trend-1/eval?marked-passed=1')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends/trend-1/eval')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends/trend-1/edit')
  })

  it('marks failed: redirects ?marked-failed=1 and sets eval_status="failed"', async () => {
    await expect(markTrendEval('trend-1', 'failed')).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/trend-1/eval?marked-failed=1')
  })

  it('redirects ?error= on update error', async () => {
    mockSupabase = makeMockSupabase({ updateResult: { error: { message: 'denied' } } })
    await expect(markTrendEval('trend-1', 'passed')).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\/trend-1\/eval\?error=denied/)
  })
})
