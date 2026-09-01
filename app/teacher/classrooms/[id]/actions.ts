"use server";

import { redirect } from "next/navigation";
import type { ItemCopyState } from "@prisma/client";
import { requireActor } from "@/lib/session";
import {
  createItemCopy,
  createStudent,
  issueStudentCredentials,
  linkParent,
  setItemCopyState,
  transferStudent,
  withdrawStudent,
} from "@/lib/roster";
import { bindCode, rebindCode, voidCode } from "@/lib/qr";

function backToClassroom(classroomId: string) {
  redirect(`/teacher/classrooms/${classroomId}`);
}

export async function createStudentAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const name = formData.get("name") as string;

  await createStudent(actor, classroomId, name);
  backToClassroom(classroomId);
}

export async function transferStudentAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const studentId = formData.get("studentId") as string;
  const toClassroomId = formData.get("toClassroomId") as string;

  await transferStudent(actor, studentId, toClassroomId);
  backToClassroom(classroomId);
}

export async function withdrawStudentAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const studentId = formData.get("studentId") as string;

  await withdrawStudent(actor, studentId);
  backToClassroom(classroomId);
}

export async function linkParentAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const studentId = formData.get("studentId") as string;
  const email = formData.get("email") as string;
  const name = formData.get("name") as string;

  await linkParent(actor, studentId, { email, name });
  backToClassroom(classroomId);
}

export async function setItemCopyStateAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const itemCopyId = formData.get("itemCopyId") as string;
  const state = formData.get("state") as ItemCopyState;

  await setItemCopyState(actor, itemCopyId, state);
  backToClassroom(classroomId);
}

export async function createItemCopyAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const studentId = formData.get("studentId") as string;
  const subjectItemId = formData.get("subjectItemId") as string;

  await createItemCopy(actor, { studentId, subjectItemId });
  backToClassroom(classroomId);
}

export async function bindCodeAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const itemCopyId = formData.get("itemCopyId") as string;
  const code = (formData.get("code") as string).trim();

  await bindCode(actor, { code, itemCopyId });
  backToClassroom(classroomId);
}

export async function rebindCodeAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const itemCopyId = formData.get("itemCopyId") as string;
  const newCode = (formData.get("newCode") as string).trim();

  await rebindCode(actor, { itemCopyId, newCode });
  backToClassroom(classroomId);
}

export async function voidCodeAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const code = formData.get("code") as string;

  await voidCode(actor, code);
  backToClassroom(classroomId);
}

// Called directly from a client component (components/issue-credentials-button.tsx),
// not a <form>, because the plaintext password it returns must reach the
// screen exactly once — a redirect-based action would discard it.
export async function issueStudentCredentialsAction(studentId: string) {
  const actor = await requireActor();
  return issueStudentCredentials(actor, studentId);
}
