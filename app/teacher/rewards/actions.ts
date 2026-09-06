"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/session";
import { createReward, deleteReward, fulfillRedemption, updateReward } from "@/lib/rewards";

export async function createRewardAction(formData: FormData) {
  const actor = await requireActor();
  const schoolId = String(formData.get("schoolId"));
  const name = String(formData.get("name"));
  const cost = Number(formData.get("cost"));
  const stockRaw = String(formData.get("stock") ?? "").trim();
  const stock = stockRaw === "" ? null : Number(stockRaw);
  await createReward(actor, { schoolId, name, cost, stock });
  revalidatePath("/teacher/rewards");
}

export async function restockRewardAction(formData: FormData) {
  const actor = await requireActor();
  const rewardId = String(formData.get("rewardId"));
  const stockRaw = String(formData.get("stock") ?? "").trim();
  const stock = stockRaw === "" ? null : Number(stockRaw);
  await updateReward(actor, rewardId, { stock });
  revalidatePath("/teacher/rewards");
}

export async function toggleRewardActiveAction(formData: FormData) {
  const actor = await requireActor();
  const rewardId = String(formData.get("rewardId"));
  const active = formData.get("active") === "true";
  await updateReward(actor, rewardId, { active });
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
