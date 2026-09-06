import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { classroomTodayDashboard } from "@/lib/dashboard";
import { createStudent, createItemCopy } from "@/lib/roster";
import { recordScan } from "@/lib/packing";
import { generateCode } from "@/lib/qr";
import { weekdayOf } from "@/lib/time";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

// 2026-09-08 11:00 Bangkok (04:00 UTC) — a fixed midday instant, well
// outside either packing window, so "today" is unambiguous. Same calendar
// date packing.test.ts's TOMORROW constant uses, so WEEKDAY (Tuesday)
// matches across both suites.
const TODAY_NOW = new Date("2026-09-08T04:00:00Z");
const TODAY = "2026-09-08";
const WEEKDAY = weekdayOf(TODAY);

/** Homeroom teacher, one subject/item, a term covering TODAY, a timetable
 * slot for TODAY's weekday/period 1. Individual tests add students/copies. */
async function seedClassroomForToday(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: `Subject ${label}` } });
  const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: `Item ${label}` } });
  const term = await prisma.term.create({
    data: { schoolId: school.id, name: "Term", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") },
  });
  await prisma.timetableSlot.create({
    data: { termId: term.id, classroomId: classroom.id, weekday: WEEKDAY, period: 1, subjectId: subject.id },
  });

  const teacherUser = await prisma.user.create({ data: { email: `homeroom-${label}@example.com` } });
  const teacher = await prisma.teacher.create({ data: { userId: teacherUser.id, email: teacherUser.email!, name: `Teacher ${label}` } });
  await prisma.teachingAssignment.create({ data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: subject.id } });
  await prisma.classroom.update({ where: { id: classroom.id }, data: { homeroomTeacherId: teacher.id } });
  const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

  return { school, classroom, subject, subjectItem, teacherActor };
}

describe("classroomTodayDashboard", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
    vi.setSystemTime(TODAY_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the homeroom teacher sees correct complete/partial/not-started counts", async () => {
    const a = await seedClassroomForToday("A");
    const complete = await createStudent(a.teacherActor, a.classroom.id, "Complete Kid");
    const notStarted = await createStudent(a.teacherActor, a.classroom.id, "Not Started Kid");

    const copy = await createItemCopy(a.teacherActor, { studentId: complete.id, subjectItemId: a.subjectItem.id });
    const code = generateCode();
    await prisma.qRCode.create({ data: { code, state: "ASSIGNED", itemCopyId: copy.id, boundAt: new Date() } });
    const studentActor: Actor = { userId: `user-${complete.id}`, teacherId: null, parentId: null, studentId: complete.id };
    // 06:00 Bangkok on TODAY — inside the morning window, targets TODAY.
    vi.setSystemTime(new Date("2026-09-07T23:00:00Z"));
    await recordScan(studentActor, { code });
    vi.setSystemTime(TODAY_NOW);

    const dashboard = await classroomTodayDashboard(a.teacherActor, a.classroom.id);
    expect(dashboard.packing).not.toBeNull();
    expect(dashboard.packing!.totalStudents).toBe(2);
    expect(dashboard.packing!.completeCount).toBe(1);
    expect(dashboard.packing!.notStartedCount).toBe(1);
    expect(dashboard.packing!.partialCount).toBe(0);
    const notStartedRow = dashboard.packing!.students.find((s) => s.id === notStarted.id);
    expect(notStartedRow?.checkedItems).toEqual([]);
  });

  it("a non-homeroom subject teacher gets packing: null, and collectibleItems scoped to only their own subject", async () => {
    const a = await seedClassroomForToday("A"); // a.teacherActor is homeroom, teaches a.subject
    await createStudent(a.teacherActor, a.classroom.id, "Kid");

    const otherSubject = await prisma.subject.create({ data: { schoolId: a.school.id, name: "Other Subject" } });
    const otherItem = await prisma.subjectItem.create({ data: { subjectId: otherSubject.id, name: "Other Item" } });
    const term = await prisma.term.findFirstOrThrow({ where: { schoolId: a.school.id } });
    await prisma.timetableSlot.create({
      data: { termId: term.id, classroomId: a.classroom.id, weekday: WEEKDAY, period: 2, subjectId: otherSubject.id },
    });

    const peUser = await prisma.user.create({ data: { email: "pe-dashboard@example.com" } });
    const peTeacher = await prisma.teacher.create({ data: { userId: peUser.id, email: peUser.email!, name: "PE Teacher" } });
    await prisma.teachingAssignment.create({ data: { teacherId: peTeacher.id, classroomId: a.classroom.id, subjectId: otherSubject.id } });
    const peActor: Actor = { userId: peUser.id, teacherId: peTeacher.id, parentId: null, studentId: null };

    const dashboard = await classroomTodayDashboard(peActor, a.classroom.id);
    expect(dashboard.packing).toBeNull();
    expect(dashboard.collectibleItems.map((i) => i.subjectItemId)).toEqual([otherItem.id]);
  });

  it("a holiday zeroes out collectibleItems and sets isHoliday", async () => {
    const a = await seedClassroomForToday("A");
    await prisma.scheduleException.create({
      data: { schoolId: a.school.id, classroomId: a.classroom.id, date: new Date(TODAY), kind: "HOLIDAY" },
    });

    const dashboard = await classroomTodayDashboard(a.teacherActor, a.classroom.id);
    expect(dashboard.isHoliday).toBe(true);
    expect(dashboard.collectibleItems).toEqual([]);
  });

  it("an EXAM exception excludes that subject's ordinary item from collectibleItems", async () => {
    const a = await seedClassroomForToday("A");
    await createStudent(a.teacherActor, a.classroom.id, "Kid");
    await prisma.scheduleException.create({
      data: {
        schoolId: a.school.id,
        classroomId: a.classroom.id,
        date: new Date(TODAY),
        kind: "EXAM",
        period: 1,
        subjectId: a.subject.id,
      },
    });

    const dashboard = await classroomTodayDashboard(a.teacherActor, a.classroom.id);
    expect(dashboard.collectibleItems).toEqual([]);
  });

  it("collectedCount reflects how many tracked copies are currently GRADING", async () => {
    const a = await seedClassroomForToday("A");
    const s1 = await createStudent(a.teacherActor, a.classroom.id, "Kid 1");
    const s2 = await createStudent(a.teacherActor, a.classroom.id, "Kid 2");
    const copy1 = await createItemCopy(a.teacherActor, { studentId: s1.id, subjectItemId: a.subjectItem.id });
    await createItemCopy(a.teacherActor, { studentId: s2.id, subjectItemId: a.subjectItem.id });
    await prisma.itemCopy.update({ where: { id: copy1.id }, data: { state: "GRADING" } });

    const dashboard = await classroomTodayDashboard(a.teacherActor, a.classroom.id);
    const item = dashboard.collectibleItems.find((i) => i.subjectItemId === a.subjectItem.id);
    expect(item).toMatchObject({ totalStudents: 2, collectedCount: 1, periods: [1] });
  });

  it("denies a teacher with no relationship to the classroom", async () => {
    const a = await seedClassroomForToday("A");
    const outsiderUser = await prisma.user.create({ data: { email: "outsider-dashboard@example.com" } });
    const outsider = await prisma.teacher.create({ data: { userId: outsiderUser.id, email: outsiderUser.email!, name: "Outsider" } });
    const outsiderActor: Actor = { userId: outsiderUser.id, teacherId: outsider.id, parentId: null, studentId: null };

    await expect(classroomTodayDashboard(outsiderActor, a.classroom.id)).rejects.toThrow(ForbiddenError);
  });
});
