"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/session";
import { createReward, deleteReward, fulfillRedemption } from "@/lib/rewards";

export async function createRewardAction(formData: FormData) {
  const actor = await requireActor();
  const schoolId = String(formData.get("schoolId"));
  const name = String(formData.get("name"));
  const cost = Number(formData.get("cost"));
  await createReward(actor, { schoolId, name, cost });
  revalidatePath("/teacher/rewards");
}

export async function deleteRewardAction(formData: FormData) {
  const actor = await requireActor();
  const rewardId = String(formData.get("rewardId"));
  await deleteReward(actor, rewardId);
  revalidatePath("/teacher/rewards");
}

export async function fulfillRedemptionAction(formData: FormData) {
  const actor = await requireActor();
  const redemptionId = String(formData.get("redemptionId"));
  await fulfillRedemption(actor, redemptionId);
  revalidatePath("/teacher/rewards");
}
