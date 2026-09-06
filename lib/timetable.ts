import type { ExceptionKind } from "@prisma/client";
import { prisma } from "./prisma";
import { can, type Resource } from "./policy";
import { ForbiddenError } from "./errors";
import { termFor } from "./terms";
import { schoolDateToUtcMidnight, schoolToday, type SchoolDate } from "./time";
import type { Actor } from "./actor";

// Read-only: the timetable itself has no teacher-facing edit path (see
// app/teacher/timetable/page.tsx) — a real school's actual weekly schedule
// is set up out-of-band (imported/seeded, same as classroom creation and
// prisma/seed.ts's own generation) and, day to day, deviates from it only
// through a ScheduleException (holiday/swap/exam — edit_exceptions below),
// never by rewriting the base TimetableSlot rows at runtime. There used to
// be a setTimetableSlot/clearTimetableSlot pair behind a per-cell dropdown
// on that page; removed outright (not left "half-alive" with no caller)
// once it was raised that letting any teacher freely rewrite the shared
// class schedule doesn't match how a real school actually operates one.

/**
 * A timetable is always resolved *within* a term (see prisma/schema.prisma's
 * TimetableSlot comment). The teacher UI doesn't expose a term picker today,
 * so callers may omit termId and get "the term covering today" for this
 * classroom's school — the only term that matters until a multi-term picker
 * exists.
 */
async function resolveTermId(classroomId: string, explicitTermId?: string): Promise<string | null> {
  if (explicitTermId) return explicitTermId;
  const classroom = await prisma.classroom.findUniqueOrThrow({ where: { id: classroomId }, select: { schoolId: true } });
  const term = await termFor(classroom.schoolId, schoolToday());
  return term?.id ?? null;
}

export async function listTimetableSlots(actor: Actor, classroomId: string, termId?: string) {
  if (!(await can(actor, "view_timetable", { type: "classroom", classroomId }))) {
    throw new ForbiddenError("view_timetable", { type: "classroom", classroomId });
  }
  const resolvedTermId = await resolveTermId(classroomId, termId);
  if (!resolvedTermId) return [];
  return prisma.timetableSlot.findMany({
    where: { termId: resolvedTermId, classroomId },
    include: { subject: true },
    orderBy: [{ weekday: "asc" }, { period: "asc" }],
  });
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
  if (params.subjectId) {
    const subject = await prisma.subject.findUniqueOrThrow({ where: { id: params.subjectId }, select: { archivedAt: true } });
    if (subject.archivedAt) {
      throw new Error("This subject has been archived and can no longer be used in a new schedule exception.");
    }
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
