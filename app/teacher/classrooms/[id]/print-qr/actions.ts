"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { createUnassignedCodes } from "@/lib/qr";

export async function generateCodesAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const schoolId = formData.get("schoolId") as string;
  const count = Number(formData.get("count"));

  const codes = await createUnassignedCodes(actor, { schoolId, count });
  redirect(`/teacher/classrooms/${classroomId}/print-qr?codes=${codes.join(",")}`);
}
