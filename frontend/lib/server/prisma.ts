import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

/**
 * Prisma client, shared across requests.
 *
 * Serverless functions reuse their container between invocations, so a fresh
 * client (and a fresh connection pool) per request would exhaust the database's
 * connection limit under any real traffic. Caching it on `globalThis` also keeps
 * Next's dev-mode hot reload from opening a new pool on every edit.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local for local development, ' +
        'or add it to the project’s environment variables in Vercel.',
    )
  }

  // A small pool: each serverless instance gets its own, so the useful limit is
  // the database's total connection cap divided by peak concurrent instances.
  const pool = new Pool({ connectionString, max: 3 })
  return new PrismaClient({ adapter: new PrismaPg(pool) })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
