"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/session";
import { grantConsentOnline, revokeConsent } from "@/lib/consent";

export async function grantConsentAction(formData: FormData) {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId"));
  await grantConsentOnline(actor, { studentId, scope: "PHOTO_CAPTURE" });
  revalidatePath(`/parent/${studentId}/consent`);
}

export async function revokeConsentAction(formData: FormData) {
  const actor = await requireActor();
  const studentId = String(formData.get("studentId"));
  await revokeConsent(actor, { studentId, scope: "PHOTO_CAPTURE" });
  revalidatePath(`/parent/${studentId}/consent`);
}
