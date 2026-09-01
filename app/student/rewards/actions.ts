"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/session";
import { redeem } from "@/lib/rewards";

export async function redeemAction(formData: FormData) {
  const actor = await requireActor();
  const rewardId = String(formData.get("rewardId"));
  await redeem(actor, rewardId);
  revalidatePath("/student/rewards");
}
