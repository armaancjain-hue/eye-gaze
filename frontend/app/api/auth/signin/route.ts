import { NextResponse } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { fakeVerify, verifyPassword } from '@/lib/server/auth'
import { startSession } from '@/lib/server/session'
import { readJsonBody, validateCredentials } from '@/lib/server/validation'

/** POST /api/auth/signin — verify credentials and start a session. */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One message for both "no such account" and "wrong password". Telling them
 * apart turns the sign-in form into a way to check whether any given address is
 * registered here, which is not something to hand out.
 */
const INVALID = 'Incorrect email or password.'

export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body) {
    return NextResponse.json({ msg: 'Expected a JSON body.' }, { status: 400 })
  }

  const { errors, email, password } = validateCredentials(body, { requireName: false })
  // Only the presence of the fields is worth reporting here; a "password too
  // short" hint on sign-in would leak the stored password's shape.
  if (!email || !password) {
    return NextResponse.json(
      { msg: 'Please check the form.', errors: { email: errors.email, password: errors.password } },
      { status: 400 },
    )
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    const ok = user ? await verifyPassword(password, user.password) : await fakeVerify(password)

    if (!user || !ok) {
      return NextResponse.json({ msg: INVALID }, { status: 401 })
    }

    await startSession({ id: user.id, email: user.email, name: user.name })
    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } })
  } catch (error) {
    console.error('[signin] failed:', error)
    return NextResponse.json({ msg: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
