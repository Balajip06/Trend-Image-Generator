import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

interface State {
  rowIsFavorite: boolean | null // null means row not found
  authUser: { id: string } | null
  lastUpdatePayload: Record<string, unknown> | null
  lastUpdateEqFilters: { column: string; value: unknown }[]
  lastSelectEqFilters: { column: string; value: unknown }[]
}

const state: State = {
  rowIsFavorite: false,
  authUser: { id: 'user-1' },
  lastUpdatePayload: null,
  lastUpdateEqFilters: [],
  lastSelectEqFilters: [],
}

function makeSupabase() {
  const fromImpl = () => {
    let lastOp: 'select' | 'update' = 'select'
    const chain = {
      select: vi.fn(function (this: unknown) {
        lastOp = 'select'
        return chain
      }),
      update: vi.fn(function (this: unknown, payload: Record<string, unknown>) {
        lastOp = 'update'
        state.lastUpdatePayload = payload
        return chain
      }),
      eq: vi.fn(function (this: unknown, column: string, value: unknown) {
        if (lastOp === 'select') {
          state.lastSelectEqFilters.push({ column, value })
        } else {
          state.lastUpdateEqFilters.push({ column, value })
        }
        return chain
      }),
      maybeSingle: vi.fn(() => {
        if (state.rowIsFavorite === null) {
          return Promise.resolve({ data: null, error: null })
        }
        return Promise.resolve({
          data: { is_favorite: state.rowIsFavorite },
          error: null,
        })
      }),
      then: (resolve: (v: { error: null }) => unknown) =>
        // for the awaited update().eq().eq() chain — resolve successfully
        Promise.resolve({ error: null }).then(resolve),
    }
    return chain
  }
  return {
    from: vi.fn(fromImpl),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: state.authUser } })),
    },
  }
}

let mockSupabase = makeSupabase()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

import { toggleFavorite } from './actions'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

function lastRedirectUrl(): string {
  const calls = (redirect as unknown as { mock: { calls: [string][] } }).mock.calls
  return calls[calls.length - 1]?.[0] ?? ''
}

function resetState(overrides: Partial<State> = {}) {
  state.rowIsFavorite =
    'rowIsFavorite' in overrides ? (overrides.rowIsFavorite as boolean | null) : false
  state.authUser = overrides.authUser === undefined ? { id: 'user-1' } : overrides.authUser
  state.lastUpdatePayload = null
  state.lastUpdateEqFilters = []
  state.lastSelectEqFilters = []
  mockSupabase = makeSupabase()
}

beforeEach(() => {
  vi.clearAllMocks()
  resetState()
})

afterEach(() => {
  vi.clearAllMocks()
})

const VALID_UUID = 'a1b2c3d4-1111-4222-8333-444455556666'

function makeForm(generationId: string = VALID_UUID): FormData {
  const fd = new FormData()
  fd.set('generation_id', generationId)
  return fd
}

describe('toggleFavorite — happy path favorite', () => {
  it('row not yet favorite → sets is_favorite=true + favorited_at=<iso>', async () => {
    resetState({ rowIsFavorite: false })
    await toggleFavorite(makeForm())
    expect(state.lastUpdatePayload).not.toBeNull()
    expect(state.lastUpdatePayload).toMatchObject({ is_favorite: true })
    expect(typeof state.lastUpdatePayload?.favorited_at).toBe('string')
    expect(revalidatePath).toHaveBeenCalledWith('/creations')
  })

  it('update is scoped to the current user (eq user_id filter)', async () => {
    resetState({ rowIsFavorite: false })
    await toggleFavorite(makeForm())
    const userFilter = state.lastUpdateEqFilters.find((f) => f.column === 'user_id')
    expect(userFilter?.value).toBe('user-1')
  })
})

describe('toggleFavorite — happy path unfavorite', () => {
  it('row currently favorite → sets is_favorite=false + favorited_at=null', async () => {
    resetState({ rowIsFavorite: true })
    await toggleFavorite(makeForm())
    expect(state.lastUpdatePayload).toMatchObject({
      is_favorite: false,
      favorited_at: null,
    })
  })
})

describe('toggleFavorite — auth + ownership', () => {
  it('redirects /login when user is not authenticated', async () => {
    resetState({ authUser: null })
    await expect(toggleFavorite(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/login?next=/creations')
    expect(state.lastUpdatePayload).toBeNull()
  })

  it('redirects /creations?error=not_found when row is not owned by user', async () => {
    resetState({ rowIsFavorite: null })
    await expect(toggleFavorite(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/creations?error=not_found')
    expect(state.lastUpdatePayload).toBeNull()
  })
})

describe('toggleFavorite — input validation', () => {
  it('redirects ?error=invalid_id when generation_id is not a UUID', async () => {
    await expect(toggleFavorite(makeForm('not-a-uuid'))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/creations?error=invalid_id')
    expect(state.lastUpdatePayload).toBeNull()
  })
})
