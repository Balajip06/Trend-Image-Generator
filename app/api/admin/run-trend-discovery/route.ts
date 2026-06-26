/**
 * Trend-discovery trigger — DISABLED.
 *
 * The admin Suggestions inbox was removed (it surfaced what this endpoint wrote),
 * so auto-discovery has nowhere to land. The route now returns 410 Gone and does
 * no work. The `trend_suggestions` table, orchestrator/proposer libs, and migrations
 * are intentionally left intact (dormant) so discovery can be re-enabled later.
 */

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function disabled(): NextResponse {
  return NextResponse.json(
    { error: 'gone', message: 'Trend discovery is disabled (Suggestions inbox removed).' },
    { status: 410 }
  )
}

export async function POST(): Promise<NextResponse> {
  return disabled()
}

export async function GET(): Promise<NextResponse> {
  return disabled()
}
