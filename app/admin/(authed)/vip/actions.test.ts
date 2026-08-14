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

interface ChainOverrides {
  updateResult?: { error: { message: string } | null }
  authUser?: { id: string } | null
}

let updateResult: { error: { message: string } | null } = { error: null }
let authUser: { id: string } | null = { id: 'admin-1' }
let lastUpdatePayload: Record<string, unknown> | null = null
// Result returned by select(...).eq(...).maybeSingle() — used by findUserForVip
// to simulate profile-lookup outcomes.
let selectMaybeSingleResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
}

function makeSupabase(): {
  from: ReturnType<typeof vi.fn>
  auth: { getUser: ReturnType<typeof vi.fn> }
} {
  let lastOp: 'update' | 'select' | 'insert' = 'select'
  const fromImpl = () => {
    const chain = {
      select: vi.fn(function (this: unknown) {
        lastOp = 'select'
        return chain
      }),
      update: vi.fn(function (this: unknown, payload: Record<string, unknown>) {
        lastOp = 'update'
        lastUpdatePayload = payload
        return chain
      }),
      insert: vi.fn(function (this: unknown) {
        lastOp = 'insert'
        return chain
      }),
      eq: vi.fn(function (this: unknown) {
        if (lastOp === 'update') {
          return Promise.resolve(updateResult)
        }
        return chain
      }),
      maybeSingle: vi.fn(() => Promise.resolve(selectMaybeSingleResult)),
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

import { setVip, findUserForVip } from './actions'
import { requireAdminRole } from '@/lib/admin/require-role'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

function lastRedirectUrl(): string {
  const calls = (redirect as unknown as { mock: { calls: [string][] } }).mock.calls
  return calls[calls.length - 1]?.[0] ?? ''
}

function resetState(overrides: ChainOverrides = {}) {
  updateResult = overrides.updateResult ?? { error: null }
  authUser = overrides.authUser === undefined ? { id: 'admin-1' } : overrides.authUser
  lastUpdatePayload = null
  selectMaybeSingleResult = { data: null, error: null }
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
  fd.set('user_id', 'a1b2c3d4-1111-4222-8333-444455556666')
  fd.set('email', 'user@example.com')
  fd.set('enable', '1')
  fd.set('reason', 'comp for early supporter')
  for (const [k, v] of Object.entries(overrides)) {
    if (v === '') fd.delete(k)
    else fd.set(k, v as string)
  }
  return fd
}

describe('setVip — happy path enable', () => {
  it('sets is_vip=true with reason + granted_by + granted_at, logs audit, redirects ok=1', async () => {
    await expect(setVip(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastUpdatePayload).not.toBeNull()
    expect(lastUpdatePayload).toMatchObject({
      is_vip: true,
      vip_reason: 'comp for early supporter',
      vip_granted_by: 'admin-1',
    })
    expect(lastUpdatePayload?.vip_granted_at).toEqual(expect.any(String))

    expect(logAdminAction).toHaveBeenCalledTimes(1)
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'vip_grant',
        targetTable: 'profiles',
        targetId: 'a1b2c3d4-1111-4222-8333-444455556666',
      })
    )

    expect(revalidatePath).toHaveBeenCalledWith('/admin/vip')
    expect(lastRedirectUrl()).toMatch(/^\/admin\/vip\?ok=1&email=/)
  })
})

describe('setVip — happy path disable', () => {
  it('sets is_vip=false + clears vip_reason / granted_by / granted_at, logs vip_revoke', async () => {
    await expect(setVip(makeForm({ enable: '0' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastUpdatePayload).toMatchObject({
      is_vip: false,
      vip_reason: null,
      vip_granted_by: null,
      vip_granted_at: null,
    })
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'vip_revoke' }))
  })
})

describe('setVip — input validation', () => {
  it('malformed UUID → redirects with error', async () => {
    await expect(setVip(makeForm({ user_id: 'not-a-uuid' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/vip\?error=/)
    expect(lastUpdatePayload).toBeNull()
  })

  it('malformed email → redirects with error', async () => {
    await expect(setVip(makeForm({ email: 'not-an-email' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/vip\?error=/)
    expect(lastUpdatePayload).toBeNull()
  })

  it('reason longer than 300 chars → redirects with error', async () => {
    const tooLong = 'x'.repeat(301)
    await expect(setVip(makeForm({ reason: tooLong }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/vip\?error=/)
    expect(lastUpdatePayload).toBeNull()
  })

  it('invalid `enable` value → redirects with error', async () => {
    await expect(setVip(makeForm({ enable: 'maybe' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/vip\?error=/)
    expect(lastUpdatePayload).toBeNull()
  })
})

describe('setVip — admin attribution', () => {
  it('stamps the acting admin on the grant and the audit row', async () => {
    resetState({})
    await expect(setVip(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastUpdatePayload).toMatchObject({
      is_vip: true,
      vip_granted_by: 'admin-1',
    })
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'admin-1' }))
  })

  it('refuses to grant VIP when the caller is not an admin', async () => {
    // Previously this action wrote with `vip_granted_by: null` for an
    // unauthenticated caller — an unattributable comp of the quota paying
    // users hit. requireAdminRole now redirects before any write.
    vi.mocked(requireAdminRole).mockRejectedValueOnce(new Error('NEXT_REDIRECT: /admin/login'))
    resetState({})
    await expect(setVip(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastUpdatePayload).toBeNull()
    expect(logAdminAction).not.toHaveBeenCalled()
  })
})

describe('setVip — DB error path', () => {
  it('redirects with error when update fails', async () => {
    resetState({ updateResult: { error: { message: 'rls violation' } } })
    await expect(setVip(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/vip\?error=/)
    expect(lastRedirectUrl().replace(/\+/g, ' ')).toMatch(/rls violation/)
  })
})

describe('findUserForVip', () => {
  function makeFindForm(overrides: Partial<Record<string, string>> = {}): FormData {
    const fd = new FormData()
    fd.set('email', 'user@example.com')
    for (const [k, v] of Object.entries(overrides)) {
      if (v === '') fd.delete(k)
      else fd.set(k, v as string)
    }
    return fd
  }

  it('happy path: profile found → redirects to /admin/vip?email=<email>', async () => {
    selectMaybeSingleResult = {
      data: { id: 'profile-1', email: 'user@example.com', is_vip: false },
      error: null,
    }
    await expect(findUserForVip(makeFindForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/vip?email=user%40example.com')
  })

  it('not found: redirects with error=no profile for <email>', async () => {
    selectMaybeSingleResult = { data: null, error: null }
    await expect(findUserForVip(makeFindForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/vip\?error=/)
    const decoded = decodeURIComponent(lastRedirectUrl().replace(/\+/g, ' '))
    expect(decoded).toMatch(/no profile for user@example\.com/)
  })

  it('invalid email format: redirects with error=invalid email', async () => {
    await expect(findUserForVip(makeFindForm({ email: 'not-an-email' }))).rejects.toThrow(
      /NEXT_REDIRECT:/
    )
    expect(lastRedirectUrl()).toMatch(/^\/admin\/vip\?error=/)
    expect(lastRedirectUrl().replace(/\+/g, ' ')).toMatch(/invalid email/)
  })

  it('DB error: redirects with error=lookup failed: <message>', async () => {
    selectMaybeSingleResult = {
      data: null,
      error: { message: 'connection refused' },
    }
    await expect(findUserForVip(makeFindForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/vip\?error=/)
    const decoded = decodeURIComponent(lastRedirectUrl().replace(/\+/g, ' '))
    expect(decoded).toMatch(/lookup failed: connection refused/)
  })
})
