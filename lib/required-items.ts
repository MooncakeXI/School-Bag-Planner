import type { Weekday } from "@prisma/client";
import { prisma } from "./prisma";
import { applyExceptions, type EffectiveSlot } from "./schedule";
import { termFor, termsCoveringRange, termForSchoolOn } from "./terms";
import { addSchoolDays, schoolDateToUtcMidnight, weekdayOf, type SchoolDate } from "./time";

export type RequiredItem = {
  subjectItemId: string;
  subjectItemName: string;
  subjectId: string;
  subjectName: string;
  itemCopyId: string;
  periods: number[];
};

export type RequiredItemsResult = {
  date: SchoolDate;
  isHoliday: boolean;
  items: RequiredItem[];
};

export type WeekDayResult = RequiredItemsResult & { weekday: Weekday };

type SubjectItemRow = { id: string; name: string; subjectId: string; forExam: boolean; subject: { name: string } };

/**
 * Turns one day's effective timetable slots into the packing list, dropping
 * anything the student has no tracked copy of, or whose copy is GRADING
 * (invariant 5). Pure — the DB fetches happen in the callers below, which
 * pre-filter `subjectItems` to the subjects actually in `effective`.
 *
 * A subject's items are partitioned by `forExam`: on a day where any of
 * that subject's slots came from an EXAM exception (`source: "exam"`, see
 * lib/schedule.ts), only its `forExam` items are required — 2B pencil,
 * eraser, ruler, not the workbook, which the teacher does not want in the
 * exam room. On any other day, it's the reverse: `forExam` items have no
 * place in the regular list. Never both for the same subject on the same
 * day — see ARCHITECTURE.md §3.3 for why this option was chosen over a
 * school-level exam kit.
 */
function assembleItems(
  effective: EffectiveSlot[],
  subjectItems: SubjectItemRow[],
  copyBySubjectItem: Map<string, string>,
): RequiredItem[] {
  const subjectIdsToday = new Set(effective.map((s) => s.subjectId));
  const examSubjectIds = new Set(effective.filter((s) => s.source === "exam").map((s) => s.subjectId));
  const periodsBySubject = new Map<string, number[]>();
  for (const slot of effective) {
    const periods = periodsBySubject.get(slot.subjectId) ?? [];
    periods.push(slot.period);
    periodsBySubject.set(slot.subjectId, periods);
  }

  const items: RequiredItem[] = [];
  for (const si of subjectItems) {
    if (!subjectIdsToday.has(si.subjectId)) continue;
    if (si.forExam !== examSubjectIds.has(si.subjectId)) continue;
    const itemCopyId = copyBySubjectItem.get(si.id);
    if (!itemCopyId) continue; // no tracked copy, or it's GRADING — nothing to tell the student to pack

    items.push({
      subjectItemId: si.id,
      subjectItemName: si.name,
      subjectId: si.subjectId,
      subjectName: si.subject.name,
      itemCopyId,
      periods: (periodsBySubject.get(si.subjectId) ?? []).sort((a, b) => a - b),
    });
  }

  items.sort((a, b) => (a.periods[0] ?? 0) - (b.periods[0] ?? 0));
  return items;
}

/**
 * What a student needs to pack for `date`. Applies ScheduleExceptions
 * (holidays, swaps, exams — CLAUDE.md invariant 6) and drops any item
 * whose copy is currently with the teacher for grading (invariant 5:
 * "the single most valuable behaviour in the app").
 */
export async function requiredItemsFor(studentId: string, date: SchoolDate): Promise<RequiredItemsResult> {
  const target = schoolDateToUtcMidnight(date);

  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, startDate: { lte: target }, OR: [{ endDate: null }, { endDate: { gte: target } }] },
    orderBy: { startDate: "desc" },
    select: { classroomId: true, classroom: { select: { schoolId: true } } },
  });

  if (!enrollment) {
    return { date, isHoliday: false, items: [] };
  }

  const { classroomId } = enrollment;
  const { schoolId } = enrollment.classroom;
  const weekday = weekdayOf(date);

  // Invariant 6, extended: the timetable in effect on `date` is whichever
  // Term covers it, not whatever the timetable currently says — otherwise
  // editing a later term's timetable would silently rewrite the answer for
  // an already-past date. See prisma/schema.prisma's Term/TimetableSlot
  // comments and ARCHITECTURE.md §3.4.
  const [term, exceptions] = await Promise.all([
    termFor(schoolId, date),
    prisma.scheduleException.findMany({
      where: { date: target, OR: [{ classroomId }, { classroomId: null, schoolId }] },
      select: { kind: true, period: true, subjectId: true },
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

  if (effective.length === 0) {
    return { date, isHoliday, items: [] };
  }

  const subjectIds = [...new Set(effective.map((slot) => slot.subjectId))];

  const subjectItems = await prisma.subjectItem.findMany({
    where: { subjectId: { in: subjectIds } },
    select: { id: true, name: true, subjectId: true, forExam: true, subject: { select: { name: true } } },
  });

  const itemCopies = await prisma.itemCopy.findMany({
    where: { studentId, subjectItemId: { in: subjectItems.map((si) => si.id) }, state: { not: "GRADING" } },
    select: { id: true, subjectItemId: true },
  });
  const copyBySubjectItem = new Map(itemCopies.map((c) => [c.subjectItemId, c.id]));

  return { date, isHoliday, items: assembleItems(effective, subjectItems, copyBySubjectItem) };
}

/**
 * The same thing as requiredItemsFor, for the 5 school days (Mon-Fri)
 * starting at `weekStart`. Batches the whole week into a handful of
 * queries instead of calling requiredItemsFor 5 times — also correctly
 * handles a student transferring classrooms mid-week.
 */
export async function requiredItemsForWeek(studentId: string, weekStart: SchoolDate): Promise<WeekDayResult[]> {
  const dates = Array.from({ length: 5 }, (_, i) => addSchoolDays(weekStart, i));
  const rangeStart = schoolDateToUtcMidnight(dates[0]);
  const rangeEnd = schoolDateToUtcMidnight(dates[dates.length - 1]);

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId, startDate: { lte: rangeEnd }, OR: [{ endDate: null }, { endDate: { gte: rangeStart } }] },
    select: { classroomId: true, startDate: true, endDate: true, classroom: { select: { schoolId: true } } },
  });

  if (enrollments.length === 0) {
    return dates.map((date) => ({ date, weekday: weekdayOf(date), isHoliday: false, items: [] }));
  }

  const enrollmentFor = (target: Date) =>
    enrollments.find((e) => e.startDate <= target && (e.endDate === null || e.endDate >= target));

  const classroomIds = [...new Set(enrollments.map((e) => e.classroomId))];
  const schoolIds = [...new Set(enrollments.map((e) => e.classroom.schoolId))];

  const [terms, slots, exceptions] = await Promise.all([
    // Fetched as a batch and resolved per-day below, the same way
    // enrollmentFor(target) resolves each day's enrollment locally instead
    // of querying per day — a week spanning a term boundary must resolve
    // each day against whichever term actually covers it.
    termsCoveringRange(schoolIds, rangeStart, rangeEnd),
    prisma.timetableSlot.findMany({
      where: { classroomId: { in: classroomIds } },
      select: { termId: true, classroomId: true, weekday: true, period: true, subjectId: true },
    }),
    prisma.scheduleException.findMany({
      where: {
        date: { gte: rangeStart, lte: rangeEnd },
        OR: [{ classroomId: { in: classroomIds } }, { classroomId: null, schoolId: { in: schoolIds } }],
      },
      select: { date: true, classroomId: true, schoolId: true, kind: true, period: true, subjectId: true },
    }),
  ]);

  const dayInfo = dates.map((date) => {
    const target = schoolDateToUtcMidnight(date);
    const weekday = weekdayOf(date);
    const enrollment = enrollmentFor(target);
    if (!enrollment) return { date, weekday, isHoliday: false, effective: [] as EffectiveSlot[] };

    const term = termForSchoolOn(terms, enrollment.classroom.schoolId, target);
    const daySlots = term
      ? slots.filter((s) => s.termId === term.id && s.classroomId === enrollment.classroomId && s.weekday === weekday)
      : [];
    const dayExceptions = exceptions.filter((e) => {
      if (e.date.getTime() !== target.getTime()) return false;
      if (e.classroomId === enrollment.classroomId) return true;
      return e.classroomId === null && e.schoolId === enrollment.classroom.schoolId;
    });
    const isHoliday = dayExceptions.some((e) => e.kind === "HOLIDAY");
    return { date, weekday, isHoliday, effective: applyExceptions(daySlots, dayExceptions) };
  });

  const allSubjectIds = [...new Set(dayInfo.flatMap((d) => d.effective.map((s) => s.subjectId)))];

  const subjectItems = allSubjectIds.length
    ? await prisma.subjectItem.findMany({
        where: { subjectId: { in: allSubjectIds } },
        select: { id: true, name: true, subjectId: true, forExam: true, subject: { select: { name: true } } },
      })
    : [];

  const itemCopies = subjectItems.length
    ? await prisma.itemCopy.findMany({
        where: { studentId, subjectItemId: { in: subjectItems.map((si) => si.id) }, state: { not: "GRADING" } },
        select: { id: true, subjectItemId: true },
      })
    : [];
  const copyBySubjectItem = new Map(itemCopies.map((c) => [c.subjectItemId, c.id]));

  return dayInfo.map((d) => ({
    date: d.date,
    weekday: d.weekday,
    isHoliday: d.isHoliday,
    items: assembleItems(d.effective, subjectItems, copyBySubjectItem),
  }));
}
