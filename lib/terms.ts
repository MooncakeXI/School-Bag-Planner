import { prisma } from "./prisma";
import { schoolDateToUtcMidnight, type SchoolDate } from "./time";

export type Term = {
  id: string;
  schoolId: string;
  name: string;
  startDate: Date;
  endDate: Date;
};

/** The term covering `date` for one school, or null if none does (e.g. a
 * school break, or terms not set up for that period). */
export async function termFor(schoolId: string, date: SchoolDate): Promise<Term | null> {
  const target = schoolDateToUtcMidnight(date);
  return prisma.term.findFirst({
    where: { schoolId, startDate: { lte: target }, endDate: { gte: target } },
  });
}

/**
 * All terms (across possibly several schools) overlapping [from, to] — for
 * batching a date-range query instead of calling termFor once per day, the
 * same reason lib/required-items.ts's requiredItemsForWeek fetches all of a
 * student's enrollments overlapping the week instead of resolving each
 * day's enrollment with a separate query. Pair with termForSchoolOn to
 * resolve one specific school+date against the batch.
 */
export async function termsCoveringRange(schoolIds: string[], from: Date, to: Date): Promise<Term[]> {
  if (schoolIds.length === 0) return [];
  return prisma.term.findMany({
    where: { schoolId: { in: schoolIds }, startDate: { lte: to }, endDate: { gte: from } },
  });
}

/** Resolves one school+date against a batch fetched by termsCoveringRange. */
export function termForSchoolOn(terms: Term[], schoolId: string, target: Date): Term | undefined {
  return terms.find((t) => t.schoolId === schoolId && t.startDate <= target && t.endDate >= target);
}

async function assertNoOverlap(schoolId: string, startDate: Date, endDate: Date, excludeTermId?: string) {
  const overlapping = await prisma.term.findFirst({
    where: {
      schoolId,
      id: excludeTermId ? { not: excludeTermId } : undefined,
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
  });
  if (overlapping) {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    throw new Error(
      `Term overlaps existing term "${overlapping.name}" (${fmt(overlapping.startDate)}–${fmt(overlapping.endDate)})`,
    );
  }
}

/**
 * Out-of-band, admin-managed — same precedent as classroom creation
 * (CLAUDE.md/ARCHITECTURE.md: "classroom creation is not a product
 * feature"). An academic calendar is set by school administration, not
 * through a teacher-facing UI, so this takes no actor and does no can()
 * check, matching prisma/seed.ts's/the rollover script's own direct
 * access. Overlap is still always checked *here*, not left to each caller,
 * so a script (or a future admin tool) can't accidentally violate the
 * no-overlap invariant just by forgetting to check.
 */
export async function createTerm(params: {
  schoolId: string;
  name: string;
  startDate: SchoolDate;
  endDate: SchoolDate;
}) {
  const startDate = schoolDateToUtcMidnight(params.startDate);
  const endDate = schoolDateToUtcMidnight(params.endDate);
  if (startDate > endDate) throw new Error("Term startDate must be before endDate");
  await assertNoOverlap(params.schoolId, startDate, endDate);
  return prisma.term.create({ data: { schoolId: params.schoolId, name: params.name, startDate, endDate } });
}

/**
 * Academic-year rollover for one school — out-of-band, no UI, same trust
 * level as createTerm/prisma/seed.ts (see that comment above). Intended to
 * be run manually or from a scheduled job via scripts/rollover-term.ts.
 *
 * There is no schema concept of "which classroom comes after which" — real
 * schools reshuffle sections yearly, not just promote everyone 1:1 — so
 * `classroomPromotions` (oldClassroomId -> newClassroomId, or `null` for a
 * student who is leaving/graduating) is a required input, never inferred.
 *
 * In order:
 *  1. Creates the new Term (via createTerm, so the no-overlap invariant is
 *     checked the same way it would be for any other caller).
 *  2. Per promotion pair: ends every active Enrollment in the old classroom
 *     (endDate = the day before the new term starts), and — unless mapped
 *     to `null` — opens a new Enrollment for the same student in the new
 *     classroom starting on the new term's first day.
 *  3. Retires (state: RETIRED) every non-RETIRED ItemCopy belonging to a
 *     rolled-over student — last year's workbooks are done regardless of
 *     which classroom they move into next.
 *  4. If `copyTimetable` is true, copies the ending term's TimetableSlots
 *     for each old classroom into the new term for its mapped new
 *     classroom (same weekday/period/subject). Only sensible when the new
 *     classroom keeps the same curriculum — a same-grade section reshuffle
 *     might, a grade promotion (P.4 -> P.5, different subjects/workbooks)
 *     usually won't. This function doesn't try to guess; the caller
 *     decides via the flag. If false (or omitted), the new term starts
 *     with an empty timetable, same as a school's very first term does.
 */
export async function rolloverTerm(params: {
  schoolId: string;
  endingTermId: string;
  newTerm: { name: string; startDate: SchoolDate; endDate: SchoolDate };
  classroomPromotions: Record<string, string | null>;
  copyTimetable?: boolean;
}): Promise<{ newTermId: string; studentsRolledOver: number }> {
  const newTerm = await createTerm({
    schoolId: params.schoolId,
    name: params.newTerm.name,
    startDate: params.newTerm.startDate,
    endDate: params.newTerm.endDate,
  });
  const newTermStart = schoolDateToUtcMidnight(params.newTerm.startDate);
  const priorEnrollmentEnd = new Date(newTermStart.getTime() - 24 * 60 * 60 * 1000); // the day before the new term starts

  const rolledOverStudentIds: string[] = [];

  for (const [oldClassroomId, newClassroomId] of Object.entries(params.classroomPromotions)) {
    const activeEnrollments = await prisma.enrollment.findMany({
      where: { classroomId: oldClassroomId, endDate: null },
      select: { id: true, studentId: true },
    });
    if (activeEnrollments.length === 0) continue;

    await prisma.enrollment.updateMany({
      where: { id: { in: activeEnrollments.map((e) => e.id) } },
      data: { endDate: priorEnrollmentEnd },
    });
    rolledOverStudentIds.push(...activeEnrollments.map((e) => e.studentId));

    if (newClassroomId) {
      await prisma.enrollment.createMany({
        data: activeEnrollments.map((e) => ({ studentId: e.studentId, classroomId: newClassroomId, startDate: newTermStart })),
      });

      if (params.copyTimetable) {
        const oldSlots = await prisma.timetableSlot.findMany({
          where: { termId: params.endingTermId, classroomId: oldClassroomId },
          select: { weekday: true, period: true, subjectId: true },
        });
        if (oldSlots.length > 0) {
          await prisma.timetableSlot.createMany({
            data: oldSlots.map((s) => ({
              termId: newTerm.id,
              classroomId: newClassroomId,
              weekday: s.weekday,
              period: s.period,
              subjectId: s.subjectId,
            })),
          });
        }
      }
    }
  }

  if (rolledOverStudentIds.length > 0) {
    await prisma.itemCopy.updateMany({
      where: { studentId: { in: rolledOverStudentIds }, state: { not: "RETIRED" } },
      data: { state: "RETIRED" },
    });
  }

  return { newTermId: newTerm.id, studentsRolledOver: rolledOverStudentIds.length };
}
