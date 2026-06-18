/**
 * Server-to-server KIMP360 status API client.
 * Authenticates with HMAC over (timestamp + body) to prevent replay attacks.
 * Response is Zod-validated — untrusted JSON must not drive entitlements directly.
 *
 * See plan H-S7: response schema prevents cross-account grants and unknown status values.
 */

import { z } from 'zod'
import { createHmac } from 'node:crypto'

const StatusResultSchema = z.object({
  results: z.array(
    z.object({
      sub: z.string().min(1),
      status: z.enum(['active', 'inactive']),
      checked_at: z.string().datetime(),
    })
  ),
})

export type KimpStatusResult = z.infer<typeof StatusResultSchema>['results'][number]

export async function checkKimpStatus(subjects: string[]): Promise<KimpStatusResult[]> {
  const apiUrl = process.env.KIMP360_STATUS_API_URL
  const apiKey = process.env.KIMP360_STATUS_API_KEY

  if (!apiUrl || !apiKey) throw new Error('KIMP360_STATUS_API_URL / KEY not configured')
  if (subjects.length === 0) return []

  const timestamp = Date.now().toString()
  const body = JSON.stringify({ subjects })
  const signature = createHmac('sha256', apiKey).update(timestamp + body).digest('hex')

  const res = await fetch(`${apiUrl}/clients/status`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-timestamp': timestamp,
      'x-signature': signature,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`KIMP360 status API ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`)
  }

  const parsed = StatusResultSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error(`KIMP360 status API invalid response: ${parsed.error.message}`)

  // Intersect: only return results for subjects we requested (H-S7: drop extras)
  const requestedSet = new Set(subjects)
  return parsed.data.results.filter(r => requestedSet.has(r.sub))
}
