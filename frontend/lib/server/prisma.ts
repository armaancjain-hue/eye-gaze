import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { ConfigError } from './config-error'

/**
 * Prisma client, shared across requests.
 *
 * Serverless functions reuse their container between invocations, so a fresh
 * client (and a fresh connection pool) per request would exhaust the database's
 * connection limit under any real traffic. Caching it on `globalThis` also keeps
 * Next's dev-mode hot reload from opening a new pool on every edit.
 *
 * Construction is deferred to the first query. Building it at module scope meant
 * a missing DATABASE_URL threw while the route module was still being evaluated,
 * so the handler's own try/catch never ran and the deploy answered with an opaque
 * platform 500 — no code, no message, nothing in the response to work from.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new ConfigError(
      'DATABASE_URL is not set. Copy .env.example to .env.local for local development, ' +
        'or add it to the project’s environment variables in Vercel.',
    )
  }

  // A small pool: each serverless instance gets its own, so the useful limit is
  // the database's total connection cap divided by peak concurrent instances.
  const pool = new Pool({ connectionString, max: 3 })
  return new PrismaClient({ adapter: new PrismaPg(pool) })
}

function getPrismaClient(): PrismaClient {
  const existing = globalForPrisma.prisma
  if (existing) return existing
  const client = createPrismaClient()
  globalForPrisma.prisma = client
  return client
}

/**
 * Lazily-constructed stand-in for the client: identical to use, but the pool is
 * only opened when a query is actually issued, so a configuration fault surfaces
 * inside the request handler where it can be reported.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getPrismaClient(), property, receiver)
  },
  has(_target, property) {
    return Reflect.has(getPrismaClient(), property)
  },
})

/** Reachability check for the health endpoint. */
export async function checkDatabase(): Promise<{ ok: boolean; code?: string }> {
  try {
    // Touches the table the auth routes depend on, so a database that is up but
    // never migrated is reported as broken rather than healthy.
    await prisma.user.count()
    return { ok: true }
  } catch (error) {
    // Codes only. Prisma's messages quote the connection target and the failing
    // SQL, neither of which belongs in a public response body.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unknown'
    return { ok: false, code }
  }
}
