import { DateTime } from "luxon";
import { prisma } from "./prisma";
import { can } from "./policy";
import { ForbiddenError } from "./errors";
import { SCHOOL_TZ, schoolDateToUtcMidnight, schoolNow, schoolToday } from "./time";
import type { Actor } from "./actor";

const MAX_DESCRIPTION_LENGTH = 2_000;
const DEADLINE_FORMATTER = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: SCHOOL_TZ,
});

export type HomeworkTarget = {
  classroomId: string;
  classroomName: string;
  subjectId: string;
  subjectName: string;
};

function normalizeDescription(value: string): string {
  const description = value.trim();
  if (!description) throw new Error("กรุณาระบุรายละเอียดการบ้าน");
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`รายละเอียดการบ้านยาวเกิน ${MAX_DESCRIPTION_LENGTH.toLocaleString()} ตัวอักษร`);
  }
  return description;
}

/**
 * `datetime-local` carries no timezone offset. Homework deadlines are school
 * commitments, so treat its date/time as Asia/Bangkok rather than whichever
 * timezone happens to be configured on the server or a teacher's phone.
 */
export function parseHomeworkDeadline(date: string, time: string): Date {
  const localDeadline = DateTime.fromISO(`${date}T${time}`, { zone: SCHOOL_TZ });
  if (!localDeadline.isValid) throw new Error("วันและเวลากำหนดส่งไม่ถูกต้อง");
  return localDeadline.toUTC().toJSDate();
}

export function formatHomeworkDeadline(deadlineAt: Date): string {
  return DEADLINE_FORMATTER.format(deadlineAt);
}

async function requireHomeworkAccess(actor: Actor, classroomId: string, subjectId: string) {
  const resource = { type: "homework" as const, classroomId, subjectId };
  if (!(await can(actor, "edit_homework", resource))) {
    throw new ForbiddenError("edit_homework", resource);
  }

  // `can()` verifies who may edit this classroom/subject pair. Confirm the
  // pair itself is real too: otherwise a homeroom teacher could submit an
  // arbitrary subject ID from another school through a forged form request.
  const classroom = await prisma.classroom.findUnique({
    where: { id: classroomId },
    select: { schoolId: true },
  });
  if (!classroom) throw new Error("ไม่พบห้องเรียน");
  const subjectIsTaughtHere = await prisma.subject.count({
    where: {
      id: subjectId,
      schoolId: classroom.schoolId,
      teachingAssignments: { some: { classroomId } },
    },
  });
  if (subjectIsTaughtHere === 0) throw new Error("วิชานี้ไม่ได้สอนในห้องเรียนที่เลือก");
}

export async function createHomework(
  actor: Actor,
  params: { classroomId: string; subjectId: string; description: string; deadlineAt: Date },
) {
  await requireHomeworkAccess(actor, params.classroomId, params.subjectId);
  const description = normalizeDescription(params.description);
  if (!Number.isFinite(params.deadlineAt.getTime()) || params.deadlineAt <= schoolNow().toUTC().toJSDate()) {
    throw new Error("กำหนดส่งต้องเป็นเวลาในอนาคต");
  }

  return prisma.homework.create({
    data: {
      classroomId: params.classroomId,
      subjectId: params.subjectId,
      description,
      deadlineAt: params.deadlineAt,
      postedByUserId: actor.userId,
    },
  });
}

/** The classroom/subject pairs this teacher can post to. The database query
 * is deliberately scoped to their own assignments plus every subject in a
 * classroom where they are the homeroom teacher. */
export async function homeworkTargetsForTeacher(actor: Actor): Promise<HomeworkTarget[]> {
  if (!actor.teacherId) return [];

  const assignments = await prisma.teachingAssignment.findMany({
    where: {
      OR: [{ teacherId: actor.teacherId }, { classroom: { homeroomTeacherId: actor.teacherId } }],
    },
    select: {
      classroomId: true,
      subjectId: true,
      classroom: { select: { name: true } },
      subject: { select: { name: true } },
    },
    orderBy: [{ classroom: { name: "asc" } }, { subject: { name: "asc" } }],
  });

  const seen = new Set<string>();
  return assignments.flatMap((assignment) => {
    const key = `${assignment.classroomId}:${assignment.subjectId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      classroomId: assignment.classroomId,
      classroomName: assignment.classroom.name,
      subjectId: assignment.subjectId,
      subjectName: assignment.subject.name,
    }];
  });
}

export async function currentHomeworkForTeacher(actor: Actor, now = new Date()) {
  const targets = await homeworkTargetsForTeacher(actor);
  if (targets.length === 0) return [];

  return prisma.homework.findMany({
    where: {
      deadlineAt: { gt: now },
      OR: targets.map(({ classroomId, subjectId }) => ({ classroomId, subjectId })),
    },
    select: {
      id: true,
      description: true,
      deadlineAt: true,
      classroom: { select: { name: true } },
      subject: { select: { name: true } },
    },
    orderBy: { deadlineAt: "asc" },
  });
}

/** Only current, not-yet-due homework in the student's active classroom is
 * returned. Fetching is scoped in SQL, never filtered after a broad query. */
export async function currentHomeworkForStudent(studentId: string, now = new Date()) {
  const today = schoolDateToUtcMidnight(schoolToday());
  return prisma.homework.findMany({
    where: {
      deadlineAt: { gt: now },
      classroom: {
        enrollments: {
          some: {
            studentId,
            startDate: { lte: today },
            OR: [{ endDate: null }, { endDate: { gte: today } }],
          },
        },
      },
    },
    select: {
      id: true,
      description: true,
      deadlineAt: true,
      classroom: { select: { name: true } },
      subject: { select: { name: true } },
    },
    orderBy: { deadlineAt: "asc" },
  });
}
