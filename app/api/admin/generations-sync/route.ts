import { type NextRequest } from 'next/server'
import { GET as realtimeSync } from '../realtime-sync/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Back-compat delegate.
 *
 * The generic `/api/admin/realtime-sync?table=…` route replaced this
 * single-table handler. Kept so `GenerationsMonitor`'s `syncUrl` (and any
 * bookmarked call) keeps working; it forwards with the table pinned.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  url.searchParams.set('table', 'admin_generations_feed')
  return realtimeSync(new Request(url, request) as NextRequest)
}
