"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import {
  createSubject,
  createSubjectItem,
  deleteSubject,
  deleteSubjectItem,
  setSubjectItemForExam,
} from "@/lib/catalog";

export async function createSubjectAction(formData: FormData) {
  const actor = await requireActor();
  const schoolId = formData.get("schoolId") as string;
  const name = formData.get("name") as string;
  await createSubject(actor, schoolId, name);
  redirect("/teacher/subjects");
}

export async function deleteSubjectAction(formData: FormData) {
  const actor = await requireActor();
  const subjectId = formData.get("subjectId") as string;
  await deleteSubject(actor, subjectId);
  redirect("/teacher/subjects");
}

export async function createSubjectItemAction(formData: FormData) {
  const actor = await requireActor();
  const subjectId = formData.get("subjectId") as string;
  const name = formData.get("name") as string;
  const forExam = formData.get("forExam") === "on";
  await createSubjectItem(actor, subjectId, name, forExam);
  redirect("/teacher/subjects");
}

export async function setSubjectItemForExamAction(formData: FormData) {
  const actor = await requireActor();
  const subjectItemId = formData.get("subjectItemId") as string;
  const forExam = formData.get("forExam") === "true";
  await setSubjectItemForExam(actor, subjectItemId, forExam);
  redirect("/teacher/subjects");
}

export async function deleteSubjectItemAction(formData: FormData) {
  const actor = await requireActor();
  const subjectItemId = formData.get("subjectItemId") as string;
  await deleteSubjectItem(actor, subjectItemId);
  redirect("/teacher/subjects");
}
