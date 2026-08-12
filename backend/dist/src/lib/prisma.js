import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
const globalForPrisma = globalThis;
function createPrismaClient() {
    const connectionString = "postgresql://neondb_owner:npg_Np8nQqW3GZIy@ep-green-bread-ajh6vd61-pooler.c-3.us-east-2.aws.neon.tech/chess?sslmode=require&channel_binding=require";
    if (!connectionString) {
        throw new Error("DATABASE_URL environment variable is not set");
    }
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
}
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env["NODE_ENV"] !== "production") {
    globalForPrisma.prisma = prisma;
}
//# sourceMappingURL=prisma.js.map