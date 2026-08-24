import bcrypt from 'bcryptjs'

/**
 * Password hashing.
 *
 * bcryptjs is the pure-JavaScript implementation. It produces and accepts the
 * same `$2b$` hashes as the native `bcrypt` package, so existing accounts are
 * unaffected — but it needs no native build step, which is what makes it usable
 * in a serverless function.
 */

/** Work factor. Higher is slower to crack and slower to verify; 12 is a sane 2020s default. */
const BCRYPT_COST = 12

/**
 * A valid hash of a value nobody knows, compared against when the email doesn't
 * exist. Without it, a missing account returns much faster than a wrong
 * password, and that difference alone tells an attacker which addresses are
 * registered. Not a secret — its only job is to cost the same as a real compare.
 */
const TIMING_DECOY_HASH = '$2b$12$SYAY0phA6wYKQnj2ZA5Hd.ZKq65PycuLPPxyonmPr8ib/oRq.azlW'

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/** Burn the same time a real verification would, then fail. */
export async function fakeVerify(password: string): Promise<false> {
  await bcrypt.compare(password, TIMING_DECOY_HASH)
  return false
}
