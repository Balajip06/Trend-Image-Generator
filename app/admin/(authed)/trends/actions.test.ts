import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const logAdminAction = vi.fn<(arg: unknown) => Promise<void>>(async () => undefined)
vi.mock('@/lib/admin/audit', () => ({
  logAdminAction: (arg: unknown) => logAdminAction(arg),
}))

interface ChainMockOverrides {
  insertResult?: { data: unknown; error: { message: string } | null }
  updateResult?: { error: { message: string } | null }
  authUser?: { id: string } | null
}

function makeMockSupabase(overrides: ChainMockOverrides = {}) {
  const insertResult = overrides.insertResult ?? { data: { id: 'new-trend-id' }, error: null }
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

  const storageBucket = {
    upload: vi.fn(
      (): Promise<{ error: { message: string } | null }> => Promise.resolve({ error: null })
    ),
    getPublicUrl: vi.fn((path: string) => ({
      data: { publicUrl: `https://cdn.example.com/${path}` },
    })),
  }

  const supabase = {
    from: vi.fn(() => queryBuilder),
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({ data: { user: overrides.authUser ?? { id: 'admin-1' } } })
      ),
    },
    storage: {
      from: vi.fn(() => storageBucket),
    },
    _queryBuilder: queryBuilder,
    _storageBucket: storageBucket,
  }
  return supabase
}

let mockSupabase = makeMockSupabase()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
  createServiceClient: vi.fn(() => mockSupabase),
}))

import {
  createTrend,
  updateTrend,
  toggleActive,
  cloneTrend,
  toggleFeatured,
  bumpOrder,
  uploadTrendImage,
} from './actions'
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
    model: 'nano-banana-2',
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

  // Regression: parseJsonField used to call schema.parse(undefined) when the
  // form field was empty, which throws for schemas without a default. Empty
  // FAQ now falls back to []; empty input_schema falls back to DEFAULT_TREND_INPUT.
  it('falls back to [] when faq field is empty', async () => {
    const fd = buildFormData({ faq: '' })
    await expect(createTrend(fd)).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/new-trend-id/edit?created=1')
    const calls = mockSupabase._queryBuilder.insert.mock.calls as unknown as Array<
      [{ faq: unknown }]
    >
    expect(calls[0]?.[0]?.faq).toEqual([])
  })

  it('falls back to DEFAULT_TREND_INPUT when input_schema field is empty', async () => {
    const fd = buildFormData({ input_schema: '' })
    await expect(createTrend(fd)).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/new-trend-id/edit?created=1')
    const calls = mockSupabase._queryBuilder.insert.mock.calls as unknown as Array<
      [{ input_schema: { fields: Array<{ name: string; type: string }> } }]
    >
    const inserted = calls[0]?.[0]?.input_schema
    expect(inserted?.fields?.[0]?.name).toBe('user_photo')
    expect(inserted?.fields?.[0]?.type).toBe('image')
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
    await expect(updateTrend('trend-1', buildFormData({ slug: 'fresh-slug' }))).rejects.toThrow(
      /NEXT_REDIRECT:/
    )
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

// ---------------------------------------------------------------------------
// cloneTrend / toggleFeatured / bumpOrder — these multi-step actions need a
// richer mock than the simple chain-mock above. We use a scriptable per-test
// supabase where each `from('trends').*` call pulls the next queued behavior.
// ---------------------------------------------------------------------------

interface ScriptableBehavior {
  // Single-row read result (after select/eq/maybeSingle or select/eq/order/limit/maybeSingle)
  maybeSingle?: { data: unknown; error: { message: string } | null }
  // Terminal update result (after update/eq)
  update?: { error: { message: string } | null }
  // Terminal insert result (after insert/select/maybeSingle)
  insert?: { data: unknown; error: { message: string } | null }
  // Terminal multi-row read result (after select/like — used by cloneTrend slug scan)
  like?: { data: unknown; error: { message: string } | null }
}

interface ScriptableMockSupabase {
  from: ReturnType<typeof vi.fn>
  auth: { getUser: ReturnType<typeof vi.fn> }
  _calls: {
    updates: Array<{ table: string; payload: Record<string, unknown>; eqArgs: unknown[] }>
    inserts: Array<{ table: string; payload: Record<string, unknown> }>
    selects: Array<{ table: string }>
  }
}

function makeScriptable(
  queue: ScriptableBehavior[],
  user: { id: string } | null = { id: 'admin-1' }
): ScriptableMockSupabase {
  const calls = {
    updates: [] as Array<{ table: string; payload: Record<string, unknown>; eqArgs: unknown[] }>,
    inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
    selects: [] as Array<{ table: string }>,
  }

  function nextBehavior(): ScriptableBehavior {
    return queue.shift() ?? {}
  }

  function makeChain(table: string) {
    // The chain captures the operation so the terminal step (await, maybeSingle)
    // can resolve to the right behavior pulled from the queue.
    let op: 'select' | 'update' | 'insert' = 'select'
    let updatePayload: Record<string, unknown> = {}
    const eqArgs: unknown[] = []
    let behavior: ScriptableBehavior | null = null

    function ensureBehavior() {
      if (behavior === null) behavior = nextBehavior()
      return behavior
    }

    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(function (this: unknown) {
      op = op === 'insert' ? 'insert' : 'select'
      if (op === 'select') calls.selects.push({ table })
      return chain
    })
    chain.update = vi.fn(function (this: unknown, payload: Record<string, unknown>) {
      op = 'update'
      updatePayload = payload
      return chain
    })
    chain.insert = vi.fn(function (this: unknown, payload: Record<string, unknown>) {
      op = 'insert'
      calls.inserts.push({ table, payload })
      return chain
    })
    chain.eq = vi.fn(function (this: unknown, _col: string, val: unknown) {
      eqArgs.push(val)
      if (op === 'update') {
        const b = ensureBehavior()
        calls.updates.push({ table, payload: updatePayload, eqArgs: [...eqArgs] })
        return Promise.resolve(b.update ?? { error: null })
      }
      return chain
    })
    chain.lt = vi.fn(function (this: unknown) {
      return chain
    })
    chain.gt = vi.fn(function (this: unknown) {
      return chain
    })
    chain.order = vi.fn(function (this: unknown) {
      return chain
    })
    chain.limit = vi.fn(function (this: unknown) {
      return chain
    })
    chain.like = vi.fn(() => {
      const b = ensureBehavior()
      return Promise.resolve(b.like ?? { data: [], error: null })
    })
    chain.maybeSingle = vi.fn(() => {
      const b = ensureBehavior()
      if (op === 'insert') {
        return Promise.resolve(b.insert ?? { data: { id: 'new-id' }, error: null })
      }
      return Promise.resolve(b.maybeSingle ?? { data: null, error: null })
    })
    return chain
  }

  return {
    from: vi.fn((table: string) => makeChain(table)),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user } })),
    },
    _calls: calls,
  }
}

function installScriptable(s: ScriptableMockSupabase) {
  // The module-level mock returns `mockSupabase`; reassign so createClient picks
  // it up. createClient/createServiceClient are vi.fn closures over `mockSupabase`.
  mockSupabase = s as unknown as ReturnType<typeof makeMockSupabase>
}

describe('cloneTrend', () => {
  const validId = 'a1b2c3d4-1111-4222-8333-444455556666'

  function makeForm(id: string = validId): FormData {
    const fd = new FormData()
    fd.set('id', id)
    return fd
  }

  const sourceRow = {
    id: validId,
    title: 'Cool Trend',
    description: 'desc',
    prompt_template: 'do stuff',
    model: 'nano-banana-2',
    aspect_ratio: '1:1',
    display_order: 5,
    thumbnail_url: null,
    sample_before_url: null,
    sample_after_url: null,
    seo_title: null,
    seo_description: null,
    input_schema: { fields: [] },
    faq: [],
    goes_live_at: null,
    auto_deactivate_threshold: 5,
    auto_deactivate_disabled: false,
  }

  it('redirects to invalid_id when id is not a UUID', async () => {
    installScriptable(makeScriptable([]))
    await expect(cloneTrend(makeForm('not-a-uuid'))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends?error=invalid_id')
  })

  it('redirects to clone_failed when source trend is not found', async () => {
    installScriptable(makeScriptable([{ maybeSingle: { data: null, error: null } }]))
    await expect(cloneTrend(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\?error=clone_failed/)
    expect(lastRedirectUrl()).toMatch(/reason=not_found/)
  })

  it('redirects to clone_failed with reason on read error', async () => {
    installScriptable(
      makeScriptable([{ maybeSingle: { data: null, error: { message: 'permission denied' } } }])
    )
    await expect(cloneTrend(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\?error=clone_failed/)
    expect(lastRedirectUrl()).toMatch(/permission/)
  })

  it('happy path: inserts clone with cloned_from, eval_status=untested, is_active=false, version=1, redirects to edit?cloned=1', async () => {
    const script = makeScriptable([
      // 1. read source
      { maybeSingle: { data: sourceRow, error: null } },
      // 2. slug-collision scan: no existing rows
      { like: { data: [], error: null } },
      // 3. insert new clone
      { insert: { data: { id: 'cloned-id' }, error: null } },
    ])
    installScriptable(script)
    await expect(cloneTrend(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends/cloned-id/edit?cloned=1')

    expect(script._calls.inserts.length).toBe(1)
    const inserted = script._calls.inserts[0]?.payload
    expect(inserted?.cloned_from).toBe(validId)
    expect(inserted?.eval_status).toBe('untested')
    expect(inserted?.is_active).toBe(false)
    expect(inserted?.version).toBe(1)
    expect(inserted?.is_featured).toBe(false)
    expect(inserted?.slug).toBe('cool-trend-copy')
    expect(inserted?.title).toBe('Cool Trend (copy)')

    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'clone',
        targetTable: 'trends',
        targetId: 'cloned-id',
      })
    )
  })

  it('dedups slug when -copy and -copy-2 collide: picks -copy-3', async () => {
    const script = makeScriptable([
      // 1. read source
      { maybeSingle: { data: sourceRow, error: null } },
      // 2. slug-collision scan returns base + -2 already taken
      {
        like: {
          data: [{ slug: 'cool-trend-copy' }, { slug: 'cool-trend-copy-2' }],
          error: null,
        },
      },
      // 3. insert
      { insert: { data: { id: 'cloned-id' }, error: null } },
    ])
    installScriptable(script)
    await expect(cloneTrend(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    const inserted = script._calls.inserts[0]?.payload
    expect(inserted?.slug).toBe('cool-trend-copy-3')
  })

  it('redirects with clone_failed when insert errors', async () => {
    installScriptable(
      makeScriptable([
        { maybeSingle: { data: sourceRow, error: null } },
        { like: { data: [], error: null } },
        { insert: { data: null, error: { message: 'unique violation' } } },
      ])
    )
    await expect(cloneTrend(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\?error=clone_failed/)
    expect(lastRedirectUrl()).toMatch(/unique/)
  })
})

describe('toggleFeatured', () => {
  const validId = 'b1b2c3d4-1111-4222-8333-444455556666'

  function makeForm(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData()
    fd.set('id', validId)
    fd.set('featured', '1')
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
    return fd
  }

  it('happy path enable: updates is_featured=true, audit-logs feature, redirects ?featured=1', async () => {
    const script = makeScriptable([{ update: { error: null } }])
    installScriptable(script)
    await expect(toggleFeatured(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends?featured=1')
    expect(script._calls.updates[0]?.payload).toEqual({ is_featured: true })
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feature',
        targetTable: 'trends',
        targetId: validId,
        after: { is_featured: true },
      })
    )
  })

  it('happy path disable: updates is_featured=false, audit-logs unfeature, redirects ?unfeatured=1', async () => {
    const script = makeScriptable([{ update: { error: null } }])
    installScriptable(script)
    await expect(toggleFeatured(makeForm({ featured: '0' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends?unfeatured=1')
    expect(script._calls.updates[0]?.payload).toEqual({ is_featured: false })
    expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'unfeature' }))
  })

  it('redirects with invalid_input when id is not a UUID', async () => {
    installScriptable(makeScriptable([]))
    await expect(toggleFeatured(makeForm({ id: 'not-a-uuid' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends?error=invalid_input')
  })

  it('redirects with invalid_input when featured is not "0" or "1"', async () => {
    installScriptable(makeScriptable([]))
    await expect(toggleFeatured(makeForm({ featured: 'yes' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends?error=invalid_input')
  })

  it('redirects with ?error= on DB error', async () => {
    installScriptable(makeScriptable([{ update: { error: { message: 'rls denied' } } }]))
    await expect(toggleFeatured(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\?error=rls%20denied/)
  })
})

describe('bumpOrder', () => {
  const validId = 'c1b2c3d4-1111-4222-8333-444455556666'
  const adjacentId = 'd1b2c3d4-1111-4222-8333-444455556666'

  function makeForm(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData()
    fd.set('id', validId)
    fd.set('direction', 'up')
    for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
    return fd
  }

  it('redirects with invalid_input when id is not a UUID', async () => {
    installScriptable(makeScriptable([]))
    await expect(bumpOrder(makeForm({ id: 'not-a-uuid' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends?error=invalid_input')
  })

  it('redirects with invalid_input when direction is not up/down', async () => {
    installScriptable(makeScriptable([]))
    await expect(bumpOrder(makeForm({ direction: 'sideways' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends?error=invalid_input')
  })

  it('redirects ?error=not_found when current row missing', async () => {
    installScriptable(makeScriptable([{ maybeSingle: { data: null, error: null } }]))
    await expect(bumpOrder(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends?error=not_found')
  })

  it('no-op redirect when there is no adjacent row (already at top)', async () => {
    installScriptable(
      makeScriptable([
        { maybeSingle: { data: { id: validId, display_order: 0 }, error: null } },
        { maybeSingle: { data: null, error: null } },
      ])
    )
    await expect(bumpOrder(makeForm({ direction: 'up' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends')
  })

  it('happy path up: swaps display_orders, audit-logs reorder, redirects /admin/trends', async () => {
    const script = makeScriptable([
      // 1. current row
      { maybeSingle: { data: { id: validId, display_order: 5 }, error: null } },
      // 2. adjacent (lower display_order, sorted desc)
      { maybeSingle: { data: { id: adjacentId, display_order: 4 }, error: null } },
      // 3. first update (current.id ← adjacent.display_order)
      { update: { error: null } },
      // 4. second update (adjacent.id ← current.display_order)
      { update: { error: null } },
    ])
    installScriptable(script)
    await expect(bumpOrder(makeForm({ direction: 'up' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends')
    expect(script._calls.updates.length).toBe(2)
    expect(script._calls.updates[0]?.payload).toEqual({ display_order: 4 })
    expect(script._calls.updates[0]?.eqArgs).toEqual([validId])
    expect(script._calls.updates[1]?.payload).toEqual({ display_order: 5 })
    expect(script._calls.updates[1]?.eqArgs).toEqual([adjacentId])
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reorder',
        targetTable: 'trends',
        targetId: validId,
        before: { display_order: 5 },
        after: { display_order: 4, swapped_with: adjacentId },
      })
    )
  })

  it('happy path down: swaps with higher display_order row', async () => {
    const script = makeScriptable([
      { maybeSingle: { data: { id: validId, display_order: 5 }, error: null } },
      { maybeSingle: { data: { id: adjacentId, display_order: 6 }, error: null } },
      { update: { error: null } },
      { update: { error: null } },
    ])
    installScriptable(script)
    await expect(bumpOrder(makeForm({ direction: 'down' }))).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toBe('/admin/trends')
    expect(script._calls.updates[0]?.payload).toEqual({ display_order: 6 })
    expect(script._calls.updates[1]?.payload).toEqual({ display_order: 5 })
  })

  it('redirects with ?error= when first swap update fails', async () => {
    installScriptable(
      makeScriptable([
        { maybeSingle: { data: { id: validId, display_order: 5 }, error: null } },
        { maybeSingle: { data: { id: adjacentId, display_order: 4 }, error: null } },
        { update: { error: { message: 'constraint fail' } } },
      ])
    )
    await expect(bumpOrder(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\?error=constraint%20fail/)
  })

  it('best-effort revert + error redirect when second update fails', async () => {
    const script = makeScriptable([
      { maybeSingle: { data: { id: validId, display_order: 5 }, error: null } },
      { maybeSingle: { data: { id: adjacentId, display_order: 4 }, error: null } },
      // 1st update succeeds
      { update: { error: null } },
      // 2nd update fails
      { update: { error: { message: 'mid swap fail' } } },
      // revert update
      { update: { error: null } },
    ])
    installScriptable(script)
    await expect(bumpOrder(makeForm())).rejects.toThrow(/NEXT_REDIRECT:/)
    expect(lastRedirectUrl()).toMatch(/^\/admin\/trends\?error=mid%20swap%20fail/)
    // 3 updates total: forward1, forward2, revert
    expect(script._calls.updates.length).toBe(3)
    // revert reasserts current.id back to its original display_order=5
    expect(script._calls.updates[2]?.payload).toEqual({ display_order: 5 })
    expect(script._calls.updates[2]?.eqArgs).toEqual([validId])
  })
})

describe('uploadTrendImage', () => {
  function makeFile(bytes: number[], name = 'photo.jpg', type = 'image/jpeg'): File {
    return new File([new Uint8Array(bytes)], name, { type })
  }

  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
  const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]

  it('returns ok:false when no file provided', async () => {
    const fd = new FormData()
    const result = await uploadTrendImage(fd)
    expect(result).toEqual({ ok: false, error: 'No file provided.' })
  })

  it('accepts a real PNG (sniffed by magic bytes) regardless of claimed name/type', async () => {
    mockSupabase = makeMockSupabase()
    const fd = new FormData()
    // Deliberately mislabel a real PNG as .jpg/image/jpeg — detection must
    // still go by the actual bytes, not the client-supplied metadata.
    fd.set('file', makeFile(PNG_MAGIC, 'thumb.jpg', 'image/jpeg'))
    const result = await uploadTrendImage(fd)
    expect(result.ok).toBe(true)
    expect(mockSupabase._storageBucket.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^trends\/.+\.png$/),
      expect.anything(),
      expect.objectContaining({ contentType: 'image/png' })
    )
  })

  it('accepts a real JPEG', async () => {
    mockSupabase = makeMockSupabase()
    const fd = new FormData()
    fd.set('file', makeFile(JPEG_MAGIC))
    const result = await uploadTrendImage(fd)
    expect(result.ok).toBe(true)
    expect(mockSupabase._storageBucket.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^trends\/.+\.jpg$/),
      expect.anything(),
      expect.objectContaining({ contentType: 'image/jpeg' })
    )
  })

  it('rejects an SVG payload spoofed with a .jpg name and image/jpeg type (stored-XSS guard)', async () => {
    mockSupabase = makeMockSupabase()
    const svgBytes = Array.from(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    )
    const fd = new FormData()
    fd.set('file', makeFile(svgBytes, 'thumb.jpg', 'image/jpeg'))
    const result = await uploadTrendImage(fd)
    expect(result).toEqual({
      ok: false,
      error: 'File must be a JPEG, PNG, GIF, or WEBP image.',
    })
    expect(mockSupabase._storageBucket.upload).not.toHaveBeenCalled()
  })

  it('rejects an empty file', async () => {
    mockSupabase = makeMockSupabase()
    const fd = new FormData()
    fd.set('file', new File([], 'empty.jpg', { type: 'image/jpeg' }))
    const result = await uploadTrendImage(fd)
    expect(result).toEqual({ ok: false, error: 'No file provided.' })
  })

  it('returns ok:false when storage upload fails', async () => {
    mockSupabase = makeMockSupabase()
    mockSupabase._storageBucket.upload.mockResolvedValueOnce({
      error: { message: 'bucket unavailable' },
    })
    const fd = new FormData()
    fd.set('file', makeFile(JPEG_MAGIC))
    const result = await uploadTrendImage(fd)
    expect(result).toEqual({ ok: false, error: 'bucket unavailable' })
  })
})
