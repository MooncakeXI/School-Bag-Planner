import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requiredItemsFor } from "@/lib/required-items";
import { weekdayOf } from "@/lib/time";
import { resetDb } from "../db-utils";

const DATE = "2026-09-08"; // a Tuesday
const WEEKDAY = weekdayOf(DATE);

async function seedClassroomWithStudent() {
  const school = await prisma.school.create({ data: { name: "Test School" } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "P4/1" } });

  const math = await prisma.subject.create({ data: { name: "Math" } });
  const mathItem = await prisma.subjectItem.create({ data: { subjectId: math.id, name: "Math workbook" } });
  const thai = await prisma.subject.create({ data: { name: "Thai" } });
  const thaiItem = await prisma.subjectItem.create({ data: { subjectId: thai.id, name: "Thai workbook" } });

  const student = await prisma.student.create({ data: { name: "Manee" } });
  await prisma.enrollment.create({
    data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-05-01") },
  });

  await prisma.timetableSlot.create({
    data: { classroomId: classroom.id, weekday: WEEKDAY, period: 1, subjectId: math.id },
  });
  await prisma.timetableSlot.create({
    data: { classroomId: classroom.id, weekday: WEEKDAY, period: 2, subjectId: thai.id },
  });

  return { school, classroom, math, mathItem, thai, thaiItem, student };
}

describe("requiredItemsFor", () => {
  beforeEach(resetDb);

  it("lists items for the day's subjects when the student owns a copy of each", async () => {
    const { mathItem, thaiItem, student } = await seedClassroomWithStudent();
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: mathItem.id, state: "WITH_STUDENT" } });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: thaiItem.id, state: "WITH_STUDENT" } });

    const result = await requiredItemsFor(student.id, DATE);

    expect(result.isHoliday).toBe(false);
    expect(result.items.map((i) => i.subjectItemName).sort()).toEqual(["Math workbook", "Thai workbook"]);
  });

  it("never lists an item whose copy is with the teacher for grading (invariant 5)", async () => {
    const { mathItem, thaiItem, student } = await seedClassroomWithStudent();
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: mathItem.id, state: "GRADING" } });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: thaiItem.id, state: "WITH_STUDENT" } });

    const result = await requiredItemsFor(student.id, DATE);

    expect(result.items.map((i) => i.subjectItemName)).toEqual(["Thai workbook"]);
  });

  it("omits a subject's item when the student has no tracked copy at all", async () => {
    const { thaiItem, student } = await seedClassroomWithStudent();
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: thaiItem.id, state: "WITH_STUDENT" } });
    // No ItemCopy created for Math at all.

    const result = await requiredItemsFor(student.id, DATE);

    expect(result.items.map((i) => i.subjectItemName)).toEqual(["Thai workbook"]);
  });

  it("returns no items and isHoliday=true on a school-wide holiday", async () => {
    const { school, mathItem, thaiItem, student } = await seedClassroomWithStudent();
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: mathItem.id, state: "WITH_STUDENT" } });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: thaiItem.id, state: "WITH_STUDENT" } });
    await prisma.scheduleException.create({
      data: { schoolId: school.id, classroomId: null, date: new Date(DATE), kind: "HOLIDAY" },
    });

    const result = await requiredItemsFor(student.id, DATE);

    expect(result.isHoliday).toBe(true);
    expect(result.items).toEqual([]);
  });

  it("applies a period swap, substituting the swapped-in subject's item", async () => {
    const { school, classroom, mathItem, student } = await seedClassroomWithStudent();
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: mathItem.id, state: "WITH_STUDENT" } });

    const art = await prisma.subject.create({ data: { name: "Art" } });
    const artItem = await prisma.subjectItem.create({ data: { subjectId: art.id, name: "Art supplies" } });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: artItem.id, state: "WITH_STUDENT" } });

    await prisma.scheduleException.create({
      data: {
        schoolId: school.id,
        classroomId: classroom.id,
        date: new Date(DATE),
        kind: "PERIOD_SWAP",
        period: 1,
        subjectId: art.id,
      },
    });

    const result = await requiredItemsFor(student.id, DATE);

    // Period 1 was Math, swapped to Art; period 2 (Thai) has no tracked copy.
    expect(result.items.map((i) => i.subjectItemName)).toEqual(["Art supplies"]);
  });

  it("returns no items for a student with no active enrollment on that date", async () => {
    const student = await prisma.student.create({ data: { name: "Unenrolled" } });

    const result = await requiredItemsFor(student.id, DATE);

    expect(result.items).toEqual([]);
    expect(result.isHoliday).toBe(false);
  });
});
