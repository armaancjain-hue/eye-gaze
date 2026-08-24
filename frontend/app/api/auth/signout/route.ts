import { NextResponse } from 'next/server'
import { endSession } from '@/lib/server/session'

/**
 * POST /api/auth/signout — clear the session cookie.
 *
 * POST rather than GET so that a prefetch, an image tag, or a link from another
 * site cannot sign the user out behind their back.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  await endSession()
  return NextResponse.json({ ok: true })
}
