"use server";

import { redirect } from "next/navigation";
import type { Weekday } from "@prisma/client";
import { requireActor } from "@/lib/session";
import { setTimetableSlot, clearTimetableSlot } from "@/lib/timetable";

export async function updateTimetableSlotAction(formData: FormData) {
  const actor = await requireActor();
  const classroomId = formData.get("classroomId") as string;
  const weekday = formData.get("weekday") as Weekday;
  const period = Number(formData.get("period"));
  const subjectId = formData.get("subjectId") as string;

  if (subjectId === "") {
    await clearTimetableSlot(actor, { classroomId, weekday, period });
  } else {
    await setTimetableSlot(actor, { classroomId, weekday, period, subjectId });
  }

  redirect(`/teacher/timetable?classroomId=${classroomId}`);
}
