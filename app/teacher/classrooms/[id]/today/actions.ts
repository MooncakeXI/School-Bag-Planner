"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/session";
import { spotCheck } from "@/lib/packing";
import { bulkSetItemCopyStateForClassroom } from "@/lib/roster";

export async function spotCheckAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = String(formData.get("classroomId"));
  const itemCopyId = String(formData.get("itemCopyId"));
  await spotCheck(actor, { itemCopyId, actuallyPacked: false });
  revalidatePath(`/teacher/classrooms/${classroomId}/today`);
}

export async function bulkCollectAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = String(formData.get("classroomId"));
  const subjectItemId = String(formData.get("subjectItemId"));
  const collected = formData.get("collected") === "true";
  await bulkSetItemCopyStateForClassroom(actor, {
    classroomId,
    subjectItemId,
    state: collected ? "GRADING" : "WITH_STUDENT",
  });
  revalidatePath(`/teacher/classrooms/${classroomId}/today`);
}
