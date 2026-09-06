"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { createHomework, parseHomeworkDeadline } from "@/lib/homework";

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string") throw new Error("ข้อมูลฟอร์มไม่ถูกต้อง");
  return value;
}

export async function createHomeworkAction(formData: FormData) {
  const actor = await requireActor();
  const target = readText(formData, "target");
  const [classroomId, subjectId, ...unexpected] = target.split("|");
  if (!classroomId || !subjectId || unexpected.length > 0) throw new Error("ห้องเรียนหรือวิชาไม่ถูกต้อง");

  await createHomework(actor, {
    classroomId,
    subjectId,
    description: readText(formData, "description"),
    deadlineAt: parseHomeworkDeadline(readText(formData, "deadlineDate"), readText(formData, "deadlineTime")),
  });
  redirect("/teacher/homework");
}
