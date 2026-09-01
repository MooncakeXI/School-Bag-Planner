import type { ExceptionKind, Weekday } from "@prisma/client";
import { prisma } from "./prisma";
import { can, type Resource } from "./policy";
import { ForbiddenError } from "./errors";
import { schoolDateToUtcMidnight, type SchoolDate } from "./time";
import type { Actor } from "./actor";

export async function listTimetableSlots(actor: Actor, classroomId: string) {
  if (!(await can(actor, "view_timetable", { type: "classroom", classroomId }))) {
    throw new ForbiddenError("view_timetable", { type: "classroom", classroomId });
  }
  return prisma.timetableSlot.findMany({
    where: { classroomId },
    include: { subject: true },
    orderBy: [{ weekday: "asc" }, { period: "asc" }],
  });
}

export async function setTimetableSlot(
  actor: Actor,
  params: { classroomId: string; subjectId: string; weekday: Weekday; period: number },
) {
  if (!(await can(actor, "edit_timetable", { type: "classroom", classroomId: params.classroomId }))) {
    throw new ForbiddenError("edit_timetable", { type: "classroom", classroomId: params.classroomId });
  }
  return prisma.timetableSlot.upsert({
    where: {
      classroomId_weekday_period: {
        classroomId: params.classroomId,
        weekday: params.weekday,
        period: params.period,
      },
    },
    create: params,
    update: { subjectId: params.subjectId },
  });
}

export async function clearTimetableSlot(
  actor: Actor,
  params: { classroomId: string; weekday: Weekday; period: number },
) {
  if (!(await can(actor, "edit_timetable", { type: "classroom", classroomId: params.classroomId }))) {
    throw new ForbiddenError("edit_timetable", { type: "classroom", classroomId: params.classroomId });
  }
  await prisma.timetableSlot.deleteMany({ where: params });
}

export async function listScheduleExceptions(
  actor: Actor,
  classroomId: string,
  range: { from: SchoolDate; to: SchoolDate },
) {
  if (!(await can(actor, "view_exceptions", { type: "classroom", classroomId }))) {
    throw new ForbiddenError("view_exceptions", { type: "classroom", classroomId });
  }
  const classroom = await prisma.classroom.findUniqueOrThrow({
    where: { id: classroomId },
    select: { schoolId: true },
  });
  return prisma.scheduleException.findMany({
    where: {
      date: { gte: schoolDateToUtcMidnight(range.from), lte: schoolDateToUtcMidnight(range.to) },
      OR: [{ classroomId }, { classroomId: null, schoolId: classroom.schoolId }],
    },
    orderBy: { date: "asc" },
  });
}

export async function createScheduleException(
  actor: Actor,
  params: {
    schoolId: string;
    classroomId: string | null;
    date: SchoolDate;
    kind: ExceptionKind;
    period?: number;
    subjectId?: string;
    note?: string;
  },
) {
  const resource: Resource = params.classroomId
    ? { type: "classroom", classroomId: params.classroomId }
    : { type: "school", schoolId: params.schoolId };
  if (!(await can(actor, "edit_exceptions", resource))) {
    throw new ForbiddenError("edit_exceptions", resource);
  }
  return prisma.scheduleException.create({
    data: {
      schoolId: params.schoolId,
      classroomId: params.classroomId,
      date: schoolDateToUtcMidnight(params.date),
      kind: params.kind,
      period: params.period ?? null,
      subjectId: params.subjectId ?? null,
      note: params.note ?? null,
    },
  });
}

export async function deleteScheduleException(actor: Actor, exceptionId: string) {
  const exception = await prisma.scheduleException.findUniqueOrThrow({ where: { id: exceptionId } });
  const resource: Resource = exception.classroomId
    ? { type: "classroom", classroomId: exception.classroomId }
    : { type: "school", schoolId: exception.schoolId };
  if (!(await can(actor, "edit_exceptions", resource))) {
    throw new ForbiddenError("edit_exceptions", resource);
  }
  await prisma.scheduleException.delete({ where: { id: exceptionId } });
}
