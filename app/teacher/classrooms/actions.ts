"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { createClassroom, deleteClassroom, renameClassroom } from "@/lib/roster";

export async function createClassroomAction(formData: FormData) {
  const actor = await requireActor();
  const schoolId = formData.get("schoolId") as string;
  const name = formData.get("name") as string;
  const subjectIds = formData.getAll("subjectIds") as string[];

  await createClassroom(actor, { schoolId, name, subjectIds });
  redirect("/teacher/classrooms");
}

export async function renameClassroomAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const name = formData.get("name") as string;

  await renameClassroom(actor, classroomId, name);
  redirect(`/teacher/classrooms/${classroomId}`);
}

export async function deleteClassroomAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;

  await deleteClassroom(actor, classroomId);
  redirect("/teacher/classrooms");
}
