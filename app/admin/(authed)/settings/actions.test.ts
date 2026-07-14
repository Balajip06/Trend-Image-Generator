import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const logAdminAction = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined)
vi.mock('@/lib/admin/audit', () => ({
  logAdminAction: (arg: unknown) => logAdminAction(arg),
}))

vi.mock('@/lib/admin/require-role', () => ({
  requireAdminRole: vi.fn(async () => ({ userId: 'admin-1' })),
}))

vi.mock('@/lib/analytics/server', () => ({
  EVENTS: { MODEL_PROVIDER_SWITCHED: 'model_provider_switched' },
  trackServer: vi.fn(),
  flushServer: vi.fn(async () => undefined),
}))

// Current value returned by the initial select(...).eq(...).maybeSingle() read.
let currentValue: unknown = null
// Result of the write UPDATE.
let updateResult: { error: { message: string } | null } = { error: null }
let lastUpdatePayload: Record<string, unknown> | null = null

function makeSupabase() {
  let lastOp: 'update' | 'select' = 'select'
  const fromImpl = () => {
    const chain = {
      select: vi.fn(function () {
        lastOp = 'select'
        return chain
      }),
      update: vi.fn(function (payload: Record<string, unknown>) {
        lastOp = 'update'
        lastUpdatePayload = payload
        return chain
      }),
      eq: vi.fn(function () {
        if (lastOp === 'update') return Promise.resolve(updateResult)
        return chain
      }),
      maybeSingle: vi.fn(() => Promise.resolve({ data: { value: currentValue }, error: null })),
    }
    return chain
  }
  return { from: vi.fn(fromImpl) }
}

let mockSupabase = makeSupabase()

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}))

import { setBannerTrend, setGlobalDefaultModel } from './actions'

beforeEach(() => {
  vi.clearAllMocks()
  currentValue = null
  updateResult = { error: null }
  lastUpdatePayload = null
  mockSupabase = makeSupabase()
})

afterEach(() => vi.clearAllMocks())

const UUID = 'a1b2c3d4-1111-4222-8333-444455556666'

function form(key: string, value: string): FormData {
  const fd = new FormData()
  fd.set(key, value)
  return fd
}

describe('setBannerTrend', () => {
  it('writes the raw uuid string (no JSON.stringify double-encode)', async () => {
    currentValue = null
    await setBannerTrend(form('trend_id', UUID))
    // Must be the bare uuid — supabase-js JSON-encodes the body itself.
    expect(lastUpdatePayload?.value).toBe(UUID)
  })

  it('writes SQL null when cleared to "no override"', async () => {
    currentValue = UUID
    await setBannerTrend(form('trend_id', ''))
    expect(lastUpdatePayload).not.toBeNull()
    expect(lastUpdatePayload?.value).toBeNull()
  })

  it('no-ops when the trend id is unchanged', async () => {
    currentValue = UUID
    await setBannerTrend(form('trend_id', UUID))
    expect(lastUpdatePayload).toBeNull()
  })

  it('throws when the write fails instead of failing silently', async () => {
    currentValue = null
    updateResult = { error: { message: 'boom' } }
    await expect(setBannerTrend(form('trend_id', UUID))).rejects.toThrow(/boom/)
  })
})

describe('setGlobalDefaultModel', () => {
  it('writes the raw model string (no double-encode)', async () => {
    currentValue = 'gpt-image-2'
    await setGlobalDefaultModel(form('model', 'nano-banana-2'))
    expect(lastUpdatePayload?.value).toBe('nano-banana-2')
  })

  it('no-ops when the model is unchanged', async () => {
    currentValue = 'gpt-image-2'
    await setGlobalDefaultModel(form('model', 'gpt-image-2'))
    expect(lastUpdatePayload).toBeNull()
  })
})
