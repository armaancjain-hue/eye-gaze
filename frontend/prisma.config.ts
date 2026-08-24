import { defineConfig } from 'prisma/config'

/**
 * Prisma CLI configuration. The connection string is read from the environment
 * rather than inlined — it is a live database credential, and this file is
 * committed.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
})
