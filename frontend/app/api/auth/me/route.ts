import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'

/**
 * GET /api/auth/me — who the current session belongs to, or null.
 *
 * The session cookie is httpOnly, so this is how the client finds out who it is.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  return NextResponse.json(
    { user },
    // Per-user and cookie-dependent: it must never be cached by a CDN or browser.
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
