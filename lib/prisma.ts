import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  var __prisma: PrismaClient | undefined;
}

function createClient() {
  // max caps how many physical connections *this one pool* ever opens.
  // Left at pg's default (10), a handful of concurrent serverless function
  // instances each spin up their own pool and collectively blow past
  // Supabase's pooler connection ceiling (session-mode pool_size 15 on the
  // free tier) — the exact error a parallel seed insert hit directly
  // (EMAXCONNSESSION), and very likely the same failure mode behind
  // unrelated-looking 500s on ordinary page loads. A real page needs at
  // most a couple of connections at once, so this has no effect on local
  // dev correctness.
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 3 });
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
