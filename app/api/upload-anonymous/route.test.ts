import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

let uploadResult: { error: { message: string } | null } = { error: null }
let signResult: { data: { signedUrl: string } | null; error: { message: string } | null } = {
  data: { signedUrl: 'https://storage.example/uploads/anon/abc/file.jpg?sig=x' },
  error: null,
}

const calls: { uploadPaths: string[] } = { uploadPaths: [] }

function makeServiceClient() {
  return {
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn((path: string) => {
          calls.uploadPaths.push(path)
          return Promise.resolve(uploadResult)
        }),
        createSignedUrl: vi.fn(() => Promise.resolve(signResult)),
      })),
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => makeServiceClient(),
}))

async function loadRoute() {
  vi.resetModules()
  return await import('./route')
}

const VALID_FP = 'a'.repeat(64)

function makeReq(form: FormData): NextRequest {
  return {
    formData: async () => form,
  } as unknown as NextRequest
}

describe('POST /api/upload-anonymous', () => {
  it('returns 400 when fingerprint_hash is missing', async () => {
    const { POST } = await loadRoute()
    const form = new FormData()
    form.set('file', new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeReq(form))
    expect(res.status).toBe(400)
  })

  it('returns 400 when fingerprint_hash is not a 64-char hex digest', async () => {
    const { POST } = await loadRoute()
    const form = new FormData()
    form.set('fingerprint_hash', 'not-a-hash')
    form.set('file', new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeReq(form))
    expect(res.status).toBe(400)
  })

  it('returns 400 when file is missing', async () => {
    const { POST } = await loadRoute()
    const form = new FormData()
    form.set('fingerprint_hash', VALID_FP)
    const res = await POST(makeReq(form))
    expect(res.status).toBe(400)
  })

  it('returns 400 for an unsupported content-type', async () => {
    const { POST } = await loadRoute()
    const form = new FormData()
    form.set('fingerprint_hash', VALID_FP)
    form.set('file', new File(['x'], 'a.gif', { type: 'image/gif' }))
    const res = await POST(makeReq(form))
    expect(res.status).toBe(400)
  })

  it('returns 413 when file exceeds the size cap', async () => {
    const { POST } = await loadRoute()
    const form = new FormData()
    form.set('fingerprint_hash', VALID_FP)
    const big = new Uint8Array(15 * 1024 * 1024 + 1)
    form.set('file', new File([big], 'a.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeReq(form))
    expect(res.status).toBe(413)
  })

  it('uploads under uploads/anon/{fingerprint_hash}/... and returns a signed url', async () => {
    const { POST } = await loadRoute()
    const form = new FormData()
    form.set('fingerprint_hash', VALID_FP)
    form.set('file', new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeReq(form))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe(signResult.data?.signedUrl)
    expect(calls.uploadPaths[0]).toMatch(new RegExp(`^anon/${VALID_FP}/.+\\.jpg$`))
  })

  it('returns 500 when the storage upload fails', async () => {
    uploadResult = { error: { message: 'boom' } }
    const { POST } = await loadRoute()
    const form = new FormData()
    form.set('fingerprint_hash', VALID_FP)
    form.set('file', new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeReq(form))
    expect(res.status).toBe(500)
    uploadResult = { error: null }
  })

  it('returns 500 when signing the url fails', async () => {
    signResult = { data: null, error: { message: 'sign boom' } }
    const { POST } = await loadRoute()
    const form = new FormData()
    form.set('fingerprint_hash', VALID_FP)
    form.set('file', new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeReq(form))
    expect(res.status).toBe(500)
    signResult = {
      data: { signedUrl: 'https://storage.example/uploads/anon/abc/file.jpg?sig=x' },
      error: null,
    }
  })
})
