import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  var __prisma: PrismaClient | undefined;
}

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// Reuse the client across Next.js dev HMR reloads to avoid exhausting the
// connection pool. A Prisma client generated before the Homework model has
// no `homework` delegate, though; discard that stale HMR singleton after a
// schema/client regeneration instead of serving a runtime TypeError.
function hasCurrentSchema(client: PrismaClient | undefined): client is PrismaClient {
  return client !== undefined && "homework" in client;
}

export const prisma = hasCurrentSchema(globalThis.__prisma) ? globalThis.__prisma : createClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
