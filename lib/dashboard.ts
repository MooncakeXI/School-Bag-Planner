import { prisma } from "./prisma";
import { applyExceptions } from "./schedule";
import { visibleClassroomWhere } from "./policy";
import { addSchoolDays, schoolDateToUtcMidnight, schoolToday, weekdayOf } from "./time";
import type { Actor } from "./actor";

export type TeacherDashboard = {
  classroomCount: number;
  studentCount: number;
  todayByClassroom: { classroomId: string; classroomName: string; isHoliday: boolean; subjects: string[] }[];
  upcomingExceptions: {
    id: string;
    date: string;
    kind: string;
    classroomName: string | null;
    subjectName: string | null;
    note: string | null;
  }[];
  gradingCount: number;
  pendingRedemptionCount: number;
};

/** Lightweight standalone count for the teacher-nav badge, so the layout doesn't have to pay for the full teacherDashboard() query on every page. */
export async function pendingRedemptionCountForTeacher(actor: Actor): Promise<number> {
  const classrooms = await prisma.classroom.findMany({
    where: visibleClassroomWhere(actor),
    select: { schoolId: true },
  });
  const schoolIds = [...new Set(classrooms.map((c) => c.schoolId))];
  if (schoolIds.length === 0) return 0;
  return prisma.redemption.count({ where: { status: "PENDING", reward: { schoolId: { in: schoolIds } } } });
}

export async function teacherDashboard(actor: Actor): Promise<TeacherDashboard> {
  const classrooms = await prisma.classroom.findMany({
    where: visibleClassroomWhere(actor),
    select: { id: true, name: true, schoolId: true },
    orderBy: { name: "asc" },
  });
  const classroomIds = classrooms.map((c) => c.id);
  const schoolIds = [...new Set(classrooms.map((c) => c.schoolId))];

  const today = schoolToday();
  const todayTarget = schoolDateToUtcMidnight(today);
  const weekday = weekdayOf(today);
  const horizon = schoolDateToUtcMidnight(addSchoolDays(today, 14));

  const [studentCount, todaySlots, todayExceptions, upcomingExceptionRows, gradingCount, pendingRedemptionCount] = await Promise.all([
    prisma.student.count({
      where: { enrollments: { some: { classroomId: { in: classroomIds }, OR: [{ endDate: null }, { endDate: { gte: todayTarget } }] } } },
    }),
    prisma.timetableSlot.findMany({
      where: { classroomId: { in: classroomIds }, weekday },
      select: { classroomId: true, period: true, subjectId: true, subject: { select: { name: true } } },
    }),
    prisma.scheduleException.findMany({
      where: { date: todayTarget, OR: [{ classroomId: { in: classroomIds } }, { classroomId: null, schoolId: { in: schoolIds } }] },
      select: {
        classroomId: true,
        schoolId: true,
        kind: true,
        period: true,
        subjectId: true,
        subject: { select: { name: true } },
      },
    }),
    prisma.scheduleException.findMany({
      where: {
        date: { gt: todayTarget, lte: horizon },
        OR: [{ classroomId: { in: classroomIds } }, { classroomId: null, schoolId: { in: schoolIds } }],
      },
      select: {
        id: true,
        date: true,
        kind: true,
        note: true,
        classroom: { select: { name: true } },
        subject: { select: { name: true } },
      },
      orderBy: { date: "asc" },
      take: 10,
    }),
    prisma.itemCopy.count({
      where: {
        state: "GRADING",
        student: {
          enrollments: {
            some: { classroomId: { in: classroomIds }, OR: [{ endDate: null }, { endDate: { gte: todayTarget } }] },
          },
        },
      },
    }),
    prisma.redemption.count({
      where: { status: "PENDING", reward: { schoolId: { in: schoolIds } } },
    }),
  ]);

  const subjectNameById = new Map([
    ...todaySlots.map((s): [string, string] => [s.subjectId, s.subject.name]),
    ...todayExceptions
      .filter((e) => e.subject != null)
      .map((e): [string, string] => [e.subjectId!, e.subject!.name]),
  ]);

  const todayByClassroom = classrooms.map((classroom) => {
    const daySlots = todaySlots.filter((s) => s.classroomId === classroom.id);
    const dayExceptions = todayExceptions.filter(
      (e) => e.classroomId === classroom.id || (e.classroomId === null && e.schoolId === classroom.schoolId),
    );
    const isHoliday = dayExceptions.some((e) => e.kind === "HOLIDAY");
    const effective = applyExceptions(daySlots, dayExceptions);
    const subjects = [...new Set(effective.map((s) => subjectNameById.get(s.subjectId) ?? s.subjectId))];
    return { classroomId: classroom.id, classroomName: classroom.name, isHoliday, subjects };
  });

  return {
    classroomCount: classrooms.length,
    studentCount,
    todayByClassroom,
    upcomingExceptions: upcomingExceptionRows.map((e) => ({
      id: e.id,
      date: e.date.toISOString().slice(0, 10),
      kind: e.kind,
      classroomName: e.classroom?.name ?? null,
      subjectName: e.subject?.name ?? null,
      note: e.note,
    })),
    gradingCount,
    pendingRedemptionCount,
  };
}
