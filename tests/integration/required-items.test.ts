import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requiredItemsFor, requiredItemsForWeek } from "@/lib/required-items";
import { weekdayOf, mondayOf } from "@/lib/time";
import { resetDb } from "../db-utils";

const DATE = "2026-09-08"; // a Tuesday
const WEEKDAY = weekdayOf(DATE);

async function seedClassroomWithStudent() {
  const school = await prisma.school.create({ data: { name: "Test School" } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "P4/1" } });
  const term = await prisma.term.create({
    data: { schoolId: school.id, name: "Term 1", startDate: new Date("2026-05-01"), endDate: new Date("2026-10-31") },
  });

  const math = await prisma.subject.create({ data: { schoolId: school.id, name: "Math" } });
  const mathItem = await prisma.subjectItem.create({ data: { subjectId: math.id, name: "Math workbook" } });
  const thai = await prisma.subject.create({ data: { schoolId: school.id, name: "Thai" } });
  const thaiItem = await prisma.subjectItem.create({ data: { subjectId: thai.id, name: "Thai workbook" } });

  const student = await prisma.student.create({ data: { name: "Manee" } });
  await prisma.enrollment.create({
    data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-05-01") },
  });

  await prisma.timetableSlot.create({
    data: { termId: term.id, classroomId: classroom.id, weekday: WEEKDAY, period: 1, subjectId: math.id },
  });
  await prisma.timetableSlot.create({
    data: { termId: term.id, classroomId: classroom.id, weekday: WEEKDAY, period: 2, subjectId: thai.id },
  });

  return { school, classroom, term, math, mathItem, thai, thaiItem, student };
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

    const art = await prisma.subject.create({ data: { schoolId: school.id, name: "Art" } });
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

  it("on an exam day, requires the subject's forExam items instead of its normal item — not both", async () => {
    const { school, classroom, math, mathItem, student } = await seedClassroomWithStudent();
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: mathItem.id, state: "WITH_STUDENT" } });

    const examKit = await prisma.subjectItem.create({
      data: { subjectId: math.id, name: "ดินสอ 2B และยางลบ", forExam: true },
    });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: examKit.id, state: "WITH_STUDENT" } });

    await prisma.scheduleException.create({
      data: {
        schoolId: school.id,
        classroomId: classroom.id,
        date: new Date(DATE),
        kind: "EXAM",
        period: 1,
        subjectId: math.id,
      },
    });

    const result = await requiredItemsFor(student.id, DATE);

    // Period 1 (Math) is an exam: the exam kit is required, the normal
    // workbook specifically is not — period 2 (Thai) has no tracked copy.
    expect(result.items.map((i) => i.subjectItemName)).toEqual(["ดินสอ 2B และยางลบ"]);
  });

  it("a forExam item never appears on a normal (non-exam) day, even with a tracked copy", async () => {
    const { math, mathItem, student } = await seedClassroomWithStudent();
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: mathItem.id, state: "WITH_STUDENT" } });
    const examKit = await prisma.subjectItem.create({ data: { subjectId: math.id, name: "Exam kit", forExam: true } });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: examKit.id, state: "WITH_STUDENT" } });

    const result = await requiredItemsFor(student.id, DATE); // no EXAM exception today

    expect(result.items.map((i) => i.subjectItemName)).toContain("Math workbook");
    expect(result.items.map((i) => i.subjectItemName)).not.toContain("Exam kit");
  });

  it("a period swap on the same date still behaves exactly as before — EXAM's item-swap does not leak into PERIOD_SWAP", async () => {
    const { school, classroom, mathItem, student } = await seedClassroomWithStudent();
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: mathItem.id, state: "WITH_STUDENT" } });

    const art = await prisma.subject.create({ data: { schoolId: school.id, name: "Art" } });
    const artItem = await prisma.subjectItem.create({ data: { subjectId: art.id, name: "Art supplies" } });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: artItem.id, state: "WITH_STUDENT" } });
    // A forExam item for the swapped-in subject too, to prove a plain
    // PERIOD_SWAP never triggers exam-item selection — only source: "exam" does.
    const artExamItem = await prisma.subjectItem.create({
      data: { subjectId: art.id, name: "Art exam kit", forExam: true },
    });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: artExamItem.id, state: "WITH_STUDENT" } });

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

    expect(result.items.map((i) => i.subjectItemName)).toEqual(["Art supplies"]);
  });

  it("returns no items for a student with no active enrollment on that date", async () => {
    const student = await prisma.student.create({ data: { name: "Unenrolled" } });

    const result = await requiredItemsFor(student.id, DATE);

    expect(result.items).toEqual([]);
    expect(result.isHoliday).toBe(false);
  });

  it("editing the timetable for a later term does not change what an earlier date required — the modelling bug this fixes", async () => {
    const { school, classroom, mathItem, student } = await seedClassroomWithStudent();
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: mathItem.id, state: "WITH_STUDENT" } });

    const before = await requiredItemsFor(student.id, DATE);
    expect(before.items.map((i) => i.subjectItemName)).toEqual(["Math workbook"]);

    // A new term starts right after the first one ends, with a completely
    // different timetable (Science instead of Math on the same slot).
    const term2 = await prisma.term.create({
      data: { schoolId: school.id, name: "Term 2", startDate: new Date("2026-11-01"), endDate: new Date("2027-03-31") },
    });
    const science = await prisma.subject.create({ data: { schoolId: school.id, name: "Science" } });
    const scienceItem = await prisma.subjectItem.create({ data: { subjectId: science.id, name: "Science kit" } });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: scienceItem.id, state: "WITH_STUDENT" } });
    await prisma.timetableSlot.create({
      data: { termId: term2.id, classroomId: classroom.id, weekday: WEEKDAY, period: 1, subjectId: science.id },
    });

    // DATE is still inside term 1 — the answer must not have changed.
    const after = await requiredItemsFor(student.id, DATE);
    expect(after.items.map((i) => i.subjectItemName).sort()).toEqual(before.items.map((i) => i.subjectItemName).sort());
    expect(after.items.map((i) => i.subjectItemName)).not.toContain("Science kit");
  });
});

describe("requiredItemsForWeek", () => {
  beforeEach(resetDb);

  it("resolves each day of a week spanning a term boundary independently", async () => {
    const school = await prisma.school.create({ data: { name: "Test School" } });
    const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "P4/1" } });

    // Week: Mon 2026-09-07 .. Fri 2026-09-11. Term 1 covers Mon-Wed, term 2
    // covers Thu-Fri — a real boundary falling inside one requested week.
    const term1 = await prisma.term.create({
      data: { schoolId: school.id, name: "Term 1", startDate: new Date("2026-08-01"), endDate: new Date("2026-09-09") },
    });
    const term2 = await prisma.term.create({
      data: { schoolId: school.id, name: "Term 2", startDate: new Date("2026-09-10"), endDate: new Date("2026-12-31") },
    });

    const math = await prisma.subject.create({ data: { schoolId: school.id, name: "Math" } });
    const mathItem = await prisma.subjectItem.create({ data: { subjectId: math.id, name: "Math workbook" } });
    const science = await prisma.subject.create({ data: { schoolId: school.id, name: "Science" } });
    const scienceItem = await prisma.subjectItem.create({ data: { subjectId: science.id, name: "Science kit" } });

    const student = await prisma.student.create({ data: { name: "Manee" } });
    await prisma.enrollment.create({
      data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-05-01") },
    });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: mathItem.id, state: "WITH_STUDENT" } });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: scienceItem.id, state: "WITH_STUDENT" } });

    for (const weekday of ["MON", "TUE", "WED"] as const) {
      await prisma.timetableSlot.create({
        data: { termId: term1.id, classroomId: classroom.id, weekday, period: 1, subjectId: math.id },
      });
    }
    for (const weekday of ["THU", "FRI"] as const) {
      await prisma.timetableSlot.create({
        data: { termId: term2.id, classroomId: classroom.id, weekday, period: 1, subjectId: science.id },
      });
    }

    const weekStart = mondayOf("2026-09-08"); // 2026-09-07
    const week = await requiredItemsForWeek(student.id, weekStart);

    const byWeekday = new Map(week.map((d) => [d.weekday, d.items.map((i) => i.subjectItemName)]));
    expect(byWeekday.get("MON")).toEqual(["Math workbook"]);
    expect(byWeekday.get("TUE")).toEqual(["Math workbook"]);
    expect(byWeekday.get("WED")).toEqual(["Math workbook"]);
    expect(byWeekday.get("THU")).toEqual(["Science kit"]);
    expect(byWeekday.get("FRI")).toEqual(["Science kit"]);
  });
});
