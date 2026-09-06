import { Prisma } from "@prisma/client";

const MAX_RETRIES = 3;

/**
 * Postgres SQLSTATE 40001 (serialization_failure) — the expected, correct
 * outcome of two transactions racing under `isolationLevel: "Serializable"`,
 * not a bug. With this project's driver-adapter setup it surfaces as a
 * `PrismaClientKnownRequestError` with `code: "P2034"`; the raw SQLSTATE is
 * still checked directly (substring of the message/meta) as a fallback,
 * since exactly which layer raises it can vary. Anything else (a plain
 * `Error` thrown inside the transaction body — "แต้มไม่พอ", "ของรางวัลหมดแล้ว"
 * — or any other Prisma error) is a real rejection, not a race, and is not
 * a retry candidate.
 */
function isSerializationFailure(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2034") return true;
    const haystack = `${err.message} ${err.meta ? JSON.stringify(err.meta) : ""}`;
    return haystack.includes("40001");
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` (typically a `prisma.$transaction(..., {isolationLevel:
 * "Serializable"})` call) and retries it, with short jittered backoff, if
 * it fails specifically because Postgres aborted it for serialization —
 * the losing side of a race that should almost always succeed on a clean
 * re-read, not be surfaced to the caller as a raw database error. Any other
 * error (including a deliberate rejection thrown inside the transaction —
 * insufficient balance, out of stock, etc.) rethrows immediately, since a
 * retry can't fix it and re-running would just throw the same thing again.
 *
 * Generic on purpose — reusable by any future Serializable transaction in
 * this codebase, not just `lib/rewards.ts`'s `redeem()`.
 */
export async function withSerializableRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isSerializationFailure(err)) throw err;
      await sleep(20 * (attempt + 1) + Math.random() * 30);
    }
  }
}
