/**
 * A deployment/configuration fault — a missing or malformed environment
 * variable — as opposed to anything the caller did wrong.
 *
 * These used to land in the same `catch` as a genuine database error and come
 * back as an indistinguishable "Something went wrong", which is how a one-line
 * env fix turned into a production mystery. Keeping them a distinct type lets
 * the routes answer 503 with a code, and log the real reason once, loudly.
 */
export class ConfigError extends Error {
  /** Stable, non-sensitive identifier returned to the client. */
  readonly code = 'server_misconfigured'

  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export function isConfigError(error: unknown): error is ConfigError {
  return error instanceof ConfigError
}
