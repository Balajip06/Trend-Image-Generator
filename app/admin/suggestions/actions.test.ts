import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const validInputSchema = {
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
}

function makeAutoPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'auto',
    candidate: {
      source: 'tiktok',
      external_id: 'tt-123',
      title: 'A trend',
      description: '',
      exemplar_urls: [],
      momentum_score: 87,
      source_url: 'https://www.tiktok.com/some/url',
      observed_at: '2026-05-20T10:00:00.000Z',
    },
    proposal: {
      suggested_slug: 'auto-cool',
      suggested_title: 'Auto Cool Title',
      suggested_description: 'A nice description',
      prompt_template: 'Transform this photo into something cool',
      model: 'nano-banana',
      input_schema: validInputSchema,
      proposer_model: 'gemini-2.5-flash',
      confidence: 0.88,
    },
    ...overrides,
  }
}

interface ChainOverrides {
  suggestionRow?: {
    id: string
    source: 'auto' | 'user'
    payload: unknown
    status: string
  } | null
  // Override insert into 'trends' (during approveAutoSuggestion)
  trendInsertResult?: { data: unknown; error: { message: string } | null }
  // Update result (for marking suggestion reviewed)
  updateResult?: { error: { message: string } | null }
  authUser?: { id: string } | null
}

function makeMockSupabase(overrides: ChainOverrides = {}) {
  const suggestionRow =
    overrides.suggestionRow === undefined
      ? {
          id: 'sug-1',
          source: 'auto' as const,
          payload: makeAutoPayload(),
          status: 'pending',
        }
      : overrides.suggestionRow
  const trendInsertResult =
    overrides.trendInsertResult ?? { data: { id: 'new-trend-id' }, error: null }
  const updateResult = overrides.updateResult ?? { error: null }

  let lastTable: string | null = null
  let lastOp: 'select' | 'update' | 'insert' | 'delete' = 'select'

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
        if (lastOp === 'update') {
          return Promise.resolve(updateResult)
        }
        if (lastOp === 'delete') {
          return Promise.resolve({ error: null })
        }
        // select chain — return chainable thenable
        const thenable = {
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null }),
          maybeSingle: chain.maybeSingle,
          eq: chain.eq,
        }
        return thenable
      }),
      maybeSingle: vi.fn(() => {
        if (lastTable === 'trend_suggestions') {
          return Promise.resolve({ data: suggestionRow, error: null })
        }
        if (lastTable === 'trends' && lastOp === 'insert') {
          return Promise.resolve(trendInsertResult)
        }
        return Promise.resolve({ data: null, error: null })
      }),
    }
    return chain
  }

  const supabase = {
    from: vi.fn(fromImpl),
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: overrides.authUser ?? { id: 'admin-1' } } })
      ),
    },
    _lastTable: () => lastTable,
  }
  return supabase
}

let mockSupabase = makeMockSupabase()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
  createServiceClient: vi.fn(() => mockSupabase),
}))

import { approveAutoSuggestion, rejectSuggestion } from './actions'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

function lastRedirectUrl(): string {
  const calls = (redirect as unknown as { mock: { calls: [string][] } }).mock.calls
  return calls[calls.length - 1]?.[0] ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase = makeMockSupabase()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('approveAutoSuggestion', () => {
  it('happy path: inserts trends row + marks suggestion approved + revalidates', async () => {
    await expect(approveAutoSuggestion('sug-1')).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/new-trend-id/edit?created=1')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/suggestions')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends')

    const tables = mockSupabase.from.mock.calls.map((c) => c[0])
    expect(tables).toContain('trends')
    expect(tables).toContain('trend_suggestions')
  })

  it('redirects ?error= when payload Zod validation fails', async () => {
    mockSupabase = makeMockSupabase({
      suggestionRow: {
        id: 'sug-1',
        source: 'auto',
        payload: { type: 'auto' /* missing candidate + proposal */ },
        status: 'pending',
      },
    })
    await expect(approveAutoSuggestion('sug-1')).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/suggestions\?error=payload%20invalid/)
  })

  it('duplicate slug → redirects with friendly error message', async () => {
    mockSupabase = makeMockSupabase({
      trendInsertResult: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint' },
      },
    })
    await expect(approveAutoSuggestion('sug-1')).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/suggestions\?error=/)
    expect(decodeURIComponent(lastRedirectUrl())).toMatch(/already exists/)
  })

  it('redirects to ?created=1 with the new trend edit URL', async () => {
    mockSupabase = makeMockSupabase({
      trendInsertResult: { data: { id: 'tx-abc' }, error: null },
    })
    await expect(approveAutoSuggestion('sug-1')).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/tx-abc/edit?created=1')
  })

  it('rejects user-sourced suggestion (only auto can be auto-approved)', async () => {
    mockSupabase = makeMockSupabase({
      suggestionRow: {
        id: 'sug-2',
        source: 'user',
        payload: {
          type: 'user',
          submitted_by: 'a1b2c3d4-1111-4222-8333-444455556666',
          title: 'cool',
          description: 'desc',
          example_urls: ['https://example.com/a.jpg'],
        },
        status: 'pending',
      },
    })
    await expect(approveAutoSuggestion('sug-2')).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/only%20auto/)
  })
})

describe('rejectSuggestion', () => {
  it('marks suggestion rejected, revalidates inbox, redirects ?rejected=1', async () => {
    await expect(rejectSuggestion('sug-1')).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/suggestions?rejected=1')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/suggestions')
  })

  it('redirects ?error=not_found when suggestion missing', async () => {
    mockSupabase = makeMockSupabase({ suggestionRow: null })
    await expect(rejectSuggestion('missing-id')).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/suggestions?error=not_found')
  })
})
