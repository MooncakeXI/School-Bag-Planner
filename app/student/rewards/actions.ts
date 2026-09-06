"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/session";
import { redeem } from "@/lib/rewards";
import { ForbiddenError } from "@/lib/errors";

// Returns a result instead of throwing so a genuine race (stock/balance
// changed between page render and tap — the case withSerializableRetry,
// lib/rewards.ts, exists for) shows an inline message next to the button
// the student just tapped, instead of blowing away the whole page into the
// generic error boundary (app/error.tsx) for what's an ordinary, expected
// outcome, not a real crash.
export async function redeemAction(rewardId: string) {
  const actor = await requireActor();
  try {
    await redeem(actor, rewardId);
    revalidatePath("/student/rewards");
    return { ok: true as const };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false as const, error: "ของรางวัลชิ้นนี้แลกไม่ได้" };
    if (err instanceof Error) return { ok: false as const, error: err.message };
    throw err;
  }
}
