import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

/**
 * Session handling: a signed, HTTP-only cookie carrying the user's identity.
 *
 * The token is a JWT signed with a server-side secret, so the browser can hold
 * it but cannot forge or alter it. It is deliberately *not* readable from
 * JavaScript (httpOnly) — an XSS bug should not hand an attacker a usable
 * session — which is why the client learns who it is from /api/auth/me rather
 * than by parsing a cookie.
 */

export const SESSION_COOKIE = 'egc_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // 7 days

export interface SessionUser {
  id: string
  email: string
  name: string
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET is missing or too short (needs 32+ characters). Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    )
  }
  return new TextEncoder().encode(secret)
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret())
}

/** Verify a token and return its user, or null if absent/expired/tampered with. */
export async function readSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    if (!payload.sub || typeof payload.email !== 'string' || typeof payload.name !== 'string') {
      return null
    }
    return { id: payload.sub, email: payload.email, name: payload.name }
  } catch {
    // Expired, wrong signature, or malformed — all mean "not signed in".
    return null
  }
}

/** The signed-in user for the current request, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  return readSessionToken(store.get(SESSION_COOKIE)?.value)
}

export async function startSession(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user)
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Lax still sends the cookie on top-level navigation, so following a link
    // back into the app keeps you signed in, while blocking cross-site POSTs.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export async function endSession(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
