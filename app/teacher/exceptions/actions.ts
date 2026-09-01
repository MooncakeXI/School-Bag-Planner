"use server";

import { redirect } from "next/navigation";
import type { ExceptionKind } from "@prisma/client";
import { requireActor } from "@/lib/session";
import { createScheduleException, deleteScheduleException } from "@/lib/timetable";

export async function createExceptionAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const schoolId = formData.get("schoolId") as string;
  const date = formData.get("date") as string;
  const kind = formData.get("kind") as ExceptionKind;
  const periodRaw = formData.get("period") as string;
  const subjectIdRaw = formData.get("subjectId") as string;
  const noteRaw = formData.get("note") as string;

  await createScheduleException(actor, {
    schoolId,
    classroomId,
    date,
    kind,
    period: periodRaw ? Number(periodRaw) : undefined,
    subjectId: subjectIdRaw || undefined,
    note: noteRaw || undefined,
  });

  redirect(`/teacher/exceptions?classroomId=${classroomId}`);
}

export async function deleteExceptionAction(formData: FormData) {
  const actor = await requireActor();
  const exceptionId = formData.get("exceptionId") as string;
  const classroomId = formData.get("classroomId") as string;

  await deleteScheduleException(actor, exceptionId);

  redirect(`/teacher/exceptions?classroomId=${classroomId}`);
}
