/**
 * Input validation for the auth endpoints.
 *
 * These run on the server because the client's checks are a convenience, not a
 * guarantee — anything can POST to these routes directly.
 */

export interface FieldErrors {
  [field: string]: string
}

// Deliberately permissive: the only authority on whether an address exists is
// the address itself, and over-strict patterns reject valid ones (subaddresses,
// new TLDs, unicode domains). This catches typos, nothing more.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const MIN_PASSWORD_LENGTH = 8
/** bcrypt silently truncates past 72 bytes, so reject rather than mislead. */
export const MAX_PASSWORD_LENGTH = 72

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function validateCredentials(
  input: { email?: unknown; password?: unknown; name?: unknown },
  { requireName }: { requireName: boolean },
): { errors: FieldErrors; email: string; password: string; name: string } {
  const errors: FieldErrors = {}

  const email = typeof input.email === 'string' ? normaliseEmail(input.email) : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const name = typeof input.name === 'string' ? input.name.trim() : ''

  if (!email) errors.email = 'Email is required.'
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'That doesn’t look like an email address.'
  else if (email.length > 254) errors.email = 'That email address is too long.'

  if (!password) errors.password = 'Password is required.'
  else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  } else if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_LENGTH) {
    errors.password = `Password must be at most ${MAX_PASSWORD_LENGTH} bytes.`
  }

  if (requireName) {
    if (!name) errors.name = 'Name is required.'
    else if (name.length > 80) errors.name = 'Name must be at most 80 characters.'
  }

  return { errors, email, password, name }
}

/** Parse a JSON body, returning null rather than throwing on malformed input. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}
