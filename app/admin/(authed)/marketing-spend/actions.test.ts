import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const logAdminAction = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined)
vi.mock('@/lib/admin/require-role', () => ({
  requireAdminRole: vi.fn(async () => ({ userId: 'admin-1', role: 'admin' })),
  checkAdminRole: vi.fn(async () => ({ ok: true, userId: 'admin-1', role: 'admin' })),
}))

vi.mock('@/lib/admin/audit', () => ({
  logAdminAction: (arg: unknown) => logAdminAction(arg),
}))

let upsertResult: { error: { message: string } | null } = { error: null }
let authUser: { id: string } | null = { id: 'admin-1' }
let lastUpsertPayload: Record<string, unknown> | null = null
let lastUpsertOptions: Record<string, unknown> | null = null

function makeSupabase(): {
  from: ReturnType<typeof vi.fn>
  auth: { getUser: ReturnType<typeof vi.fn> }
} {
  const fromImpl = () => {
    const chain = {
      upsert: vi.fn(function (
        this: unknown,
        payload: Record<string, unknown>,
        options?: Record<string, unknown>
      ) {
        lastUpsertPayload = payload
        lastUpsertOptions = options ?? null
        return Promise.resolve(upsertResult)
      }),
    }
    return chain
  }
  return {
    from: vi.fn(fromImpl),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: authUser } })),
    },
  }
}

let mockSupabase = makeSupabase()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
  createServiceClient: vi.fn(() => mockSupabase),
}))

import { recordMarketingSpend } from './actions'
import { requireAdminRole } from '@/lib/admin/require-role'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

function lastRedirectUrl(): string {
  const calls = (redirect as unknown as { mock: { calls: [string][] } }).mock.calls
  return calls[calls.length - 1]?.[0] ?? ''
}

function resetState(
  overrides: {
    upsertResult?: { error: { message: string } | null }
    authUser?: { id: string } | null
  } = {}
) {
  upsertResult = overrides.upsertResult ?? { error: null }
  authUser = overrides.authUser === undefined ? { id: 'admin-1' } : overrides.authUser
  lastUpsertPayload = null
  lastUpsertOptions = null
  mockSupabase = makeSupabase()
}

beforeEach(() => {
  vi.clearAllMocks()
  resetState()
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeForm(overrides: Partial<Record<string, string>> = {}): FormData {
  const fd = new FormData()
  fd.set('week_start', '2026-05-25')
  fd.set('channel', 'TikTok')
  fd.set('usd_spent', '120.50')
  fd.set('notes', 'Influencer collab pilot')
  for (const [k, v] of Object.entries(overrides)) {
    if (v === '') fd.delete(k)
    else fd.set(k, v as string)
  }
  return fd
}

describe('recordMarketingSpend — happy path', () => {
  it('upserts with onConflict=week_start,channel + audit-logs + redirects ok=1', async () => {
    await expect(recordMarketingSpend(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastUpsertPayload).toMatchObject({
      week_start: '2026-05-25',
      // Channel must be lowercased
      channel: 'tiktok',
      usd_spent: 120.5,
      notes: 'Influencer collab pilot',
      recorded_by: 'admin-1',
    })
    expect(lastUpsertOptions).toMatchObject({ onConflict: 'week_start,channel' })

    expect(logAdminAction).toHaveBeenCalledTimes(1)
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'marketing_spend_recorded',
        targetTable: 'admin_marketing_spend',
        targetId: null,
      })
    )

    expect(revalidatePath).toHaveBeenCalledWith('/admin/marketing-spend')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/margin')
    expect(lastRedirectUrl()).toBe('/admin/marketing-spend?ok=1')
  })

  it('lowercases the channel even when input is mixed case', async () => {
    await expect(recordMarketingSpend(makeForm({ channel: 'Instagram-Reels' }))).rejects.toThrow(
      /NEXT_REDIRECT:/
    )
    expect(lastUpsertPayload?.channel).toBe('instagram-reels')
  })

  it('accepts a zero-spend value', async () => {
    await expect(recordMarketingSpend(makeForm({ usd_spent: '0' }))).rejects.toThrow(
      /NEXT_REDIRECT:/
    )
    expect(lastUpsertPayload?.usd_spent).toBe(0)
  })

  it('stamps the acting admin as recorded_by', async () => {
    resetState({})
    await expect(recordMarketingSpend(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastUpsertPayload?.recorded_by).toBe('admin-1')
  })

  it('refuses to record spend when the caller is not an admin', async () => {
    // Previously wrote `recorded_by: null` for an unauthenticated caller,
    // producing an unattributable spend row that feeds CAC.
    vi.mocked(requireAdminRole).mockRejectedValueOnce(new Error('NEXT_REDIRECT: /admin/login'))
    resetState({})
    await expect(recordMarketingSpend(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastUpsertPayload).toBeNull()
  })
})

describe('recordMarketingSpend — input validation', () => {
  it('malformed week_start (not YYYY-MM-DD) → redirects with error', async () => {
    await expect(recordMarketingSpend(makeForm({ week_start: '05/25/2026' }))).rejects.toThrow(
      /NEXT_REDIRECT:/
    )
    expect(lastRedirectUrl()).toMatch(/^\/admin\/marketing-spend\?error=/)
    expect(lastUpsertPayload).toBeNull()
  })

  it('negative usd_spent → redirects with error', async () => {
    await expect(recordMarketingSpend(makeForm({ usd_spent: '-5' }))).rejects.toThrow(
      /NEXT_REDIRECT:/
    )
    expect(lastRedirectUrl()).toMatch(/^\/admin\/marketing-spend\?error=/)
    expect(lastUpsertPayload).toBeNull()
  })

  it('empty channel → redirects with error', async () => {
    await expect(recordMarketingSpend(makeForm({ channel: '' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/marketing-spend\?error=/)
    expect(lastUpsertPayload).toBeNull()
  })
})

describe('recordMarketingSpend — DB error path', () => {
  it('redirects with error when upsert fails', async () => {
    resetState({ upsertResult: { error: { message: 'unique violation' } } })
    await expect(recordMarketingSpend(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/marketing-spend\?error=/)
    expect(lastRedirectUrl().replace(/\+/g, ' ')).toMatch(/unique violation/)
  })
})
