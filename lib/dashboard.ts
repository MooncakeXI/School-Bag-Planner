import { prisma } from "./prisma";
import { applyExceptions } from "./schedule";
import { can, manageableSubjectsInClassroom, visibleClassroomWhere } from "./policy";
import { termFor, termsCoveringRange } from "./terms";
import { getPackingStatus } from "./packing";
import { ForbiddenError } from "./errors";
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

  // Which term is in effect today, per school — the timetable query below
  // must only look at slots belonging to that term, not "whatever the
  // timetable currently says" (see prisma/schema.prisma's TimetableSlot
  // comment and ARCHITECTURE.md §3.4).
  const todaysTerms = await termsCoveringRange(schoolIds, todayTarget, todayTarget);
  const todaysTermIds = todaysTerms.map((t) => t.id);

  const [studentCount, todaySlots, todayExceptions, upcomingExceptionRows, gradingCount, pendingRedemptionCount] = await Promise.all([
    prisma.student.count({
      where: { enrollments: { some: { classroomId: { in: classroomIds }, OR: [{ endDate: null }, { endDate: { gte: todayTarget } }] } } },
    }),
    prisma.timetableSlot.findMany({
      where: { termId: { in: todaysTermIds }, classroomId: { in: classroomIds }, weekday },
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

export type ClassroomTodayStudent = {
  id: string;
  name: string;
  status: "complete" | "partial" | "not_started";
  continuous: boolean;
  // The actual anti-cheat mechanism (CLAUDE.md "Anti-cheat") — a teacher
  // spot-checks one of these against the real bag and, if it's not there,
  // spotCheck() deducts points and breaks the streak. Carried through here
  // so the "today" dashboard's spot-check list doesn't need a second
  // per-student query on top of this one.
  checkedItems: { itemCopyId: string; subjectItemName: string }[];
};

export type CollectibleItem = {
  subjectItemId: string;
  subjectItemName: string;
  subjectId: string;
  subjectName: string;
  periods: number[];
  totalStudents: number;
  collectedCount: number;
};

export type ClassroomTodayDashboard = {
  classroomId: string;
  classroomName: string;
  isHomeroom: boolean;
  isHoliday: boolean;
  // Whole-bag packing status — homeroom-only, same reasoning as spot_check
  // (CLAUDE.md "Anti-cheat"/ARCHITECTURE.md §6.4/§10): ครูประจำชั้น checks
  // the whole bag once, not each subject teacher a partial view of it. Null
  // for a non-homeroom subject teacher — they see collectibleItems only,
  // scoped to their own subjects.
  packing: {
    totalStudents: number;
    completeCount: number;
    partialCount: number;
    notStartedCount: number;
    students: ClassroomTodayStudent[];
  } | null;
  // Scoped to actor.manageableSubjectsInClassroom — a subject teacher sees
  // and can collect only their own subject's items; homeroom sees every
  // subject, matching edit_item_copy's existing scoping everywhere else.
  collectibleItems: CollectibleItem[];
};

/**
 * The per-classroom "today" dashboard: who's packed (homeroom-only) and
 * which subjects' workbooks are due for collection today (subject-scoped).
 * "Collectible" reuses invariant 5's existing ItemCopy.state=GRADING as
 * "collected" — this introduces no new state, just a classroom-wide read
 * over it, resolved the same way lib/required-items.ts resolves a single
 * student's day: today's TimetableSlots for whichever Term covers today,
 * with ScheduleExceptions applied (a holiday collects nothing; an EXAM
 * exception excludes that subject's ordinary item, matching forExam's
 * existing split — you don't collect a workbook you didn't require packed).
 */
export async function classroomTodayDashboard(actor: Actor, classroomId: string): Promise<ClassroomTodayDashboard> {
  const resource = { type: "classroom" as const, classroomId };
  if (!(await can(actor, "edit_roster", resource))) {
    throw new ForbiddenError("edit_roster", resource);
  }

  const classroom = await prisma.classroom.findUniqueOrThrow({
    where: { id: classroomId },
    select: { name: true, schoolId: true, homeroomTeacherId: true },
  });
  const isHomeroom = actor.teacherId != null && classroom.homeroomTeacherId === actor.teacherId;

  const today = schoolToday();
  const todayTarget = schoolDateToUtcMidnight(today);
  const weekday = weekdayOf(today);
  const activeEnrollment = { OR: [{ endDate: null }, { endDate: { gte: todayTarget } }] };

  const [term, exceptions, manageableSubjects, students] = await Promise.all([
    termFor(classroom.schoolId, today),
    prisma.scheduleException.findMany({
      where: { date: todayTarget, OR: [{ classroomId }, { classroomId: null, schoolId: classroom.schoolId }] },
      select: { kind: true, period: true, subjectId: true },
    }),
    manageableSubjectsInClassroom(actor, classroomId),
    prisma.student.findMany({
      where: { enrollments: { some: { classroomId, ...activeEnrollment } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const slots = term
    ? await prisma.timetableSlot.findMany({
        where: { termId: term.id, classroomId, weekday },
        select: { period: true, subjectId: true },
      })
    : [];
  const isHoliday = exceptions.some((e) => e.kind === "HOLIDAY");
  const effective = applyExceptions(slots, exceptions);

  const periodsBySubject = new Map<string, number[]>();
  for (const slot of effective) {
    const periods = periodsBySubject.get(slot.subjectId) ?? [];
    periods.push(slot.period);
    periodsBySubject.set(slot.subjectId, periods);
  }
  const examSubjectIds = new Set(effective.filter((s) => s.source === "exam").map((s) => s.subjectId));
  const manageableSubjectIds = new Set(manageableSubjects.map((s) => s.id));
  const subjectIdsToday = [...new Set(effective.map((s) => s.subjectId))].filter(
    (id) => manageableSubjectIds.has(id) && !examSubjectIds.has(id),
  );

  let collectibleItems: CollectibleItem[] = [];
  if (subjectIdsToday.length > 0) {
    const subjectItems = await prisma.subjectItem.findMany({
      where: { subjectId: { in: subjectIdsToday }, archivedAt: null, forExam: false },
      select: { id: true, name: true, subjectId: true, subject: { select: { name: true } } },
    });
    const itemCopies = subjectItems.length
      ? await prisma.itemCopy.findMany({
          where: {
            subjectItemId: { in: subjectItems.map((si) => si.id) },
            student: { enrollments: { some: { classroomId, ...activeEnrollment } } },
          },
          select: { subjectItemId: true, state: true },
        })
      : [];

    collectibleItems = subjectItems
      .map((si) => {
        const copies = itemCopies.filter((c) => c.subjectItemId === si.id);
        return {
          subjectItemId: si.id,
          subjectItemName: si.name,
          subjectId: si.subjectId,
          subjectName: si.subject.name,
          periods: (periodsBySubject.get(si.subjectId) ?? []).sort((a, b) => a - b),
          totalStudents: copies.length,
          collectedCount: copies.filter((c) => c.state === "GRADING").length,
        };
      })
      .sort((a, b) => (a.periods[0] ?? 0) - (b.periods[0] ?? 0));
  }

  let packing: ClassroomTodayDashboard["packing"] = null;
  if (isHomeroom) {
    const statuses = await Promise.all(
      students.map(async (s) => ({ student: s, status: await getPackingStatus(s.id, today) })),
    );
    const summarizedStudents: ClassroomTodayStudent[] = statuses.map(({ student, status }) => ({
      id: student.id,
      name: student.name,
      status: status.isComplete ? "complete" : status.packedCount > 0 ? "partial" : "not_started",
      continuous: status.continuous,
      checkedItems: status.items
        .filter((i) => i.checked)
        .map((i) => ({ itemCopyId: i.itemCopyId, subjectItemName: i.subjectItemName })),
    }));
    packing = {
      totalStudents: students.length,
      completeCount: summarizedStudents.filter((s) => s.status === "complete").length,
      partialCount: summarizedStudents.filter((s) => s.status === "partial").length,
      notStartedCount: summarizedStudents.filter((s) => s.status === "not_started").length,
      students: summarizedStudents,
    };
  }

  return { classroomId, classroomName: classroom.name, isHomeroom, isHoliday, packing, collectibleItems };
}
