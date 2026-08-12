import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const SIGNED_URL_TTL_SECONDS = 3600
const MAX_BYTES = 15 * 1024 * 1024 // generous backstop; client already re-encodes to <=2048px JPEG
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

// Matches the SHA-256 hex digest produced by lib/fingerprint/client.ts —
// this value becomes part of the storage path, so it must be constrained
// before use (no path traversal via a crafted fingerprint_hash).
const FingerprintHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'fingerprint_hash must be a 64-char hex SHA-256 digest')

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const fingerprintHashRaw = form.get('fingerprint_hash')
  const file = form.get('file')

  if (typeof fingerprintHashRaw !== 'string') {
    return NextResponse.json({ error: 'fingerprint_hash is required' }, { status: 400 })
  }
  const fpCheck = FingerprintHashSchema.safeParse(fingerprintHashRaw)
  if (!fpCheck.success) {
    return NextResponse.json({ error: fpCheck.error.issues[0].message }, { status: 400 })
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported content-type: ${file.type}` }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `anon/${fpCheck.data}/${randomUUID()}.${ext}`

  const supabase = createServiceClient()
  const { error: uploadError } = await supabase.storage
    .from('uploads')
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) {
    return NextResponse.json({ error: `upload failed: ${uploadError.message}` }, { status: 500 })
  }

  const { data: signed, error: signError } = await supabase.storage
    .from('uploads')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (signError || !signed?.signedUrl) {
    return NextResponse.json(
      { error: `sign failed: ${signError?.message ?? 'no url'}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ url: signed.signedUrl })
}
