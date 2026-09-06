import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { withSerializableRetry } from "@/lib/db-retry";

// Pure control-flow logic — no real transaction needed, a fake error of the
// exact shape lib/rewards.ts's redeem() actually hit in practice (verified
// against this project's real Prisma + @prisma/adapter-pg setup) is enough.
function serializationFailure() {
  return new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict or a deadlock.", {
    code: "P2034",
    clientVersion: "test",
  });
}

// The alternate shape called out in the task: the SQLSTATE surfacing
// directly rather than as a clean P2034 code.
function rawSqlStateError() {
  return new Prisma.PrismaClientKnownRequestError("could not serialize access due to concurrent update", {
    code: "P2010",
    clientVersion: "test",
    meta: { code: "40001" },
  });
}

describe("withSerializableRetry", () => {
  it("retries a P2034 serialization failure and returns the eventual success", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(serializationFailure())
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValueOnce("ok");

    await expect(withSerializableRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("also retries the raw-SQLSTATE-40001 shape, not just P2034", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValueOnce(rawSqlStateError()).mockResolvedValueOnce("ok");

    await expect(withSerializableRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after 3 retries and rethrows the serialization failure", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(serializationFailure());

    await expect(withSerializableRetry(fn)).rejects.toThrow(/write conflict|deadlock/);
    expect(fn).toHaveBeenCalledTimes(4); // the initial attempt + 3 retries
  });

  it("rethrows a non-serialization error immediately, without retrying", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("แต้มไม่พอ"));

    await expect(withSerializableRetry(fn)).rejects.toThrow("แต้มไม่พอ");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
