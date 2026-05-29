import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

interface ChainMockOverrides {
  insertResult?: { data: unknown; error: { message: string } | null }
  updateResult?: { error: { message: string } | null }
  authUser?: { id: string } | null
}

function makeMockSupabase(overrides: ChainMockOverrides = {}) {
  const insertResult =
    overrides.insertResult ?? { data: { id: 'new-trend-id' }, error: null }
  const updateResult = overrides.updateResult ?? { error: null }

  const queryBuilder = {
    insert: vi.fn(function (this: unknown) {
      return queryBuilder
    }),
    update: vi.fn(function (this: unknown) {
      return queryBuilder
    }),
    delete: vi.fn(function (this: unknown) {
      return queryBuilder
    }),
    select: vi.fn(function (this: unknown) {
      return queryBuilder
    }),
    eq: vi.fn(function (this: unknown) {
      // After update().eq() the action awaits the result.
      return Promise.resolve(updateResult)
    }),
    maybeSingle: vi.fn(() => Promise.resolve(insertResult)),
  }

  const supabase = {
    from: vi.fn(() => queryBuilder),
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: overrides.authUser ?? { id: 'admin-1' } } })
      ),
    },
    _queryBuilder: queryBuilder,
  }
  return supabase
}

let mockSupabase = makeMockSupabase()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
  createServiceClient: vi.fn(() => mockSupabase),
}))

import { createTrend, updateTrend, toggleActive } from './actions'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

const validInputSchema = JSON.stringify({
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
})

function buildFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const defaults: Record<string, string> = {
    slug: 'cool-trend',
    title: 'A Cool Trend',
    description: '',
    prompt_template: 'Transform this photo into something cool',
    model: 'nano-banana',
    aspect_ratio: '1:1',
    display_order: '5',
    thumbnail_url: '',
    sample_before_url: '',
    sample_after_url: '',
    seo_title: '',
    seo_description: '',
    input_schema: validInputSchema,
    faq: '[]',
  }
  const merged = { ...defaults, ...overrides }
  for (const [k, v] of Object.entries(merged)) fd.set(k, v)
  return fd
}

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

describe('createTrend', () => {
  it('redirects to edit page with ?created=1 on success', async () => {
    await expect(createTrend(buildFormData())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/new-trend-id/edit?created=1')
  })

  it('redirects to new?error=... when Zod validation fails (missing slug)', async () => {
    const fd = buildFormData({ slug: '' })
    await expect(createTrend(fd)).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\/new\?error=/)
    expect(mockSupabase._queryBuilder.insert).not.toHaveBeenCalled()
  })

  it('redirects with ?error= on Supabase insert error (duplicate slug)', async () => {
    mockSupabase = makeMockSupabase({
      insertResult: { data: null, error: { message: 'duplicate key value' } },
    })
    await expect(createTrend(buildFormData())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\/new\?error=duplicate%20key%20value/)
  })

  it('calls revalidatePath("/admin/trends") on success', async () => {
    await expect(createTrend(buildFormData())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends')
  })

  it('inserts row with is_active=false and created_by=user id', async () => {
    await expect(createTrend(buildFormData())).rejects.toThrow(/NEXT_REDIRECT:/)
    const calls = mockSupabase._queryBuilder.insert.mock.calls as unknown as Array<
      [
        {
          is_active: boolean
          created_by: string | null
          slug: string
        },
      ]
    >
    const insertArgs = calls[0]?.[0]
    expect(insertArgs?.is_active).toBe(false)
    expect(insertArgs?.created_by).toBe('admin-1')
    expect(insertArgs?.slug).toBe('cool-trend')
  })
})

describe('updateTrend', () => {
  it('redirects to edit?saved=1 on success', async () => {
    await expect(updateTrend('trend-1', buildFormData())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/trend-1/edit?saved=1')
  })

  it('redirects with ?error= when Zod validation fails', async () => {
    const fd = buildFormData({ slug: 'INVALID-CAPS' })
    await expect(updateTrend('trend-1', fd)).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\/trend-1\/edit\?error=/)
    expect(mockSupabase._queryBuilder.update).not.toHaveBeenCalled()
  })

  it('redirects with ?error= when Supabase update returns an error', async () => {
    mockSupabase = makeMockSupabase({
      updateResult: { error: { message: 'constraint violation' } },
    })
    await expect(updateTrend('trend-1', buildFormData())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(
      /^\/admin\/trends\/trend-1\/edit\?error=constraint%20violation/
    )
  })

  it('revalidates trend list, edit page, and public trend slug on success', async () => {
    await expect(
      updateTrend('trend-1', buildFormData({ slug: 'fresh-slug' }))
    ).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends/trend-1/edit')
    expect(revalidatePath).toHaveBeenCalledWith('/trend/fresh-slug')
  })
})

describe('toggleActive', () => {
  it('redirects to ?activated=1 and sets is_active=true', async () => {
    await expect(toggleActive('trend-1', true)).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/trend-1/edit?activated=1')
    expect(mockSupabase._queryBuilder.update).toHaveBeenCalledWith({ is_active: true })
  })

  it('redirects to ?deactivated=1 and sets is_active=false', async () => {
    await expect(toggleActive('trend-1', false)).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/trend-1/edit?deactivated=1')
    expect(mockSupabase._queryBuilder.update).toHaveBeenCalledWith({ is_active: false })
  })

  it('redirects with ?error= when Supabase update errors', async () => {
    mockSupabase = makeMockSupabase({
      updateResult: { error: { message: 'rls denied' } },
    })
    await expect(toggleActive('trend-1', true)).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\/trend-1\/edit\?error=rls%20denied/)
  })

  it('revalidates /admin/trends and edit path on success', async () => {
    await expect(toggleActive('trend-1', true)).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/trends/trend-1/edit')
  })
})
