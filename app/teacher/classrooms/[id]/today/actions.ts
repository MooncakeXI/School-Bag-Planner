"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/session";
import { spotCheck } from "@/lib/packing";

export async function spotCheckAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = String(formData.get("classroomId"));
  const itemCopyId = String(formData.get("itemCopyId"));
  await spotCheck(actor, { itemCopyId, actuallyPacked: false });
  revalidatePath(`/teacher/classrooms/${classroomId}/today`);
}
