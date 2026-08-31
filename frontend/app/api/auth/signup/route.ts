import { NextResponse } from 'next/server'
import { prisma } from '@/lib/server/prisma'
import { hashPassword } from '@/lib/server/auth'
import { assertSessionConfig, startSession } from '@/lib/server/session'
import { readJsonBody, validateCredentials } from '@/lib/server/validation'
import { isConfigError } from '@/lib/server/config-error'

/** POST /api/auth/signup — create an account and sign in. */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = await readJsonBody(request)
  if (!body) {
    return NextResponse.json({ msg: 'Expected a JSON body.' }, { status: 400 })
  }

  const { errors, email, password, name } = validateCredentials(body, { requireName: true })
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ msg: 'Please check the form.', errors }, { status: 400 })
  }

  try {
    // Before the insert: a session we cannot sign is not worth an account row.
    assertSessionConfig()

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { msg: 'An account with that email already exists.', errors: { email: 'Already registered.' } },
        { status: 409 },
      )
    }

    const user = await prisma.user.create({
      data: { name, email, password: await hashPassword(password) },
    })

    await startSession({ id: user.id, email: user.email, name: user.name })
    return NextResponse.json(
      { user: { id: user.id, email: user.email, name: user.name } },
      { status: 201 },
    )
  } catch (error) {
    // Two simultaneous signups for the same address both pass the check above;
    // the unique index is what actually decides, so treat its violation as the
    // same "already exists" outcome rather than a server error.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return NextResponse.json(
        { msg: 'An account with that email already exists.', errors: { email: 'Already registered.' } },
        { status: 409 },
      )
    }
    if (isConfigError(error)) {
      console.error('[signup] server misconfigured:', error.message)
      return NextResponse.json(
        { msg: 'The server is not configured correctly. Please try again later.', code: error.code },
        { status: 503 },
      )
    }
    console.error('[signup] failed:', error)
    return NextResponse.json({ msg: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
