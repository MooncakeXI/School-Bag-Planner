import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTerm, rolloverTerm } from "@/lib/terms";
import { resetDb } from "../db-utils";

describe("createTerm", () => {
  beforeEach(resetDb);

  it("denies two overlapping terms for the same school", async () => {
    const school = await prisma.school.create({ data: { name: "School A" } });
    await createTerm({ schoolId: school.id, name: "Term 1", startDate: "2026-05-01", endDate: "2026-10-31" });

    // Starts before term 1 ends.
    await expect(
      createTerm({ schoolId: school.id, name: "Term 2", startDate: "2026-10-15", endDate: "2027-03-31" }),
    ).rejects.toThrow(/overlaps/i);
  });

  it("allows back-to-back terms that touch but don't overlap", async () => {
    const school = await prisma.school.create({ data: { name: "School A" } });
    await createTerm({ schoolId: school.id, name: "Term 1", startDate: "2026-05-01", endDate: "2026-10-31" });

    const term2 = await createTerm({ schoolId: school.id, name: "Term 2", startDate: "2026-11-01", endDate: "2027-03-31" });
    expect(term2.name).toBe("Term 2");
  });

  it("allows overlapping date ranges across different schools", async () => {
    const a = await prisma.school.create({ data: { name: "School A" } });
    const b = await prisma.school.create({ data: { name: "School B" } });
    await createTerm({ schoolId: a.id, name: "Term A", startDate: "2026-05-01", endDate: "2026-10-31" });

    const termB = await createTerm({ schoolId: b.id, name: "Term B", startDate: "2026-05-01", endDate: "2026-10-31" });
    expect(termB.schoolId).toBe(b.id);
  });
});

describe("rolloverTerm", () => {
  beforeEach(resetDb);

  async function seedForRollover() {
    const school = await prisma.school.create({ data: { name: "School A" } });
    const oldClassroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "ป.4/1" } });
    const newClassroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "ป.5/1" } });
    const endingTerm = await createTerm({ schoolId: school.id, name: "Term 1", startDate: "2026-05-01", endDate: "2026-10-31" });

    const subject = await prisma.subject.create({ data: { schoolId: school.id, name: "Math" } });
    const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: "Math workbook" } });
    await prisma.timetableSlot.create({
      data: { termId: endingTerm.id, classroomId: oldClassroom.id, weekday: "MON", period: 1, subjectId: subject.id },
    });

    const student = await prisma.student.create({ data: { name: "Manee" } });
    await prisma.enrollment.create({
      data: { studentId: student.id, classroomId: oldClassroom.id, startDate: new Date("2026-05-01") },
    });
    const itemCopy = await prisma.itemCopy.create({
      data: { studentId: student.id, subjectItemId: subjectItem.id, state: "WITH_STUDENT" },
    });

    return { school, oldClassroom, newClassroom, endingTerm, student, itemCopy };
  }

  it("ends the old enrollment, opens a new one in the mapped classroom, and retires old ItemCopies", async () => {
    const s = await seedForRollover();

    const result = await rolloverTerm({
      schoolId: s.school.id,
      endingTermId: s.endingTerm.id,
      newTerm: { name: "Term 2", startDate: "2026-11-01", endDate: "2027-03-31" },
      classroomPromotions: { [s.oldClassroom.id]: s.newClassroom.id },
    });
    expect(result.studentsRolledOver).toBe(1);

    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: s.student.id },
      orderBy: { startDate: "asc" },
    });
    expect(enrollments).toHaveLength(2);
    expect(enrollments[0].classroomId).toBe(s.oldClassroom.id);
    expect(enrollments[0].endDate).not.toBeNull();
    expect(enrollments[1].classroomId).toBe(s.newClassroom.id);
    expect(enrollments[1].endDate).toBeNull();

    const itemCopy = await prisma.itemCopy.findUniqueOrThrow({ where: { id: s.itemCopy.id } });
    expect(itemCopy.state).toBe("RETIRED");
  });

  it("a classroom mapped to null just ends the enrollment (graduating/leaving)", async () => {
    const s = await seedForRollover();

    await rolloverTerm({
      schoolId: s.school.id,
      endingTermId: s.endingTerm.id,
      newTerm: { name: "Term 2", startDate: "2026-11-01", endDate: "2027-03-31" },
      classroomPromotions: { [s.oldClassroom.id]: null },
    });

    const enrollments = await prisma.enrollment.findMany({ where: { studentId: s.student.id } });
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].endDate).not.toBeNull();
  });

  it("copyTimetable carries the ending term's slots into the new term for the new classroom", async () => {
    const s = await seedForRollover();

    await rolloverTerm({
      schoolId: s.school.id,
      endingTermId: s.endingTerm.id,
      newTerm: { name: "Term 2", startDate: "2026-11-01", endDate: "2027-03-31" },
      classroomPromotions: { [s.oldClassroom.id]: s.newClassroom.id },
      copyTimetable: true,
    });

    const newSlots = await prisma.timetableSlot.findMany({ where: { classroomId: s.newClassroom.id } });
    expect(newSlots).toHaveLength(1);
    expect(newSlots[0].weekday).toBe("MON");
    expect(newSlots[0].period).toBe(1);

    // The old term's own slot is untouched — history isn't rewritten.
    const oldSlots = await prisma.timetableSlot.findMany({ where: { termId: s.endingTerm.id } });
    expect(oldSlots).toHaveLength(1);
  });

  it("without copyTimetable the new term starts empty", async () => {
    const s = await seedForRollover();

    await rolloverTerm({
      schoolId: s.school.id,
      endingTermId: s.endingTerm.id,
      newTerm: { name: "Term 2", startDate: "2026-11-01", endDate: "2027-03-31" },
      classroomPromotions: { [s.oldClassroom.id]: s.newClassroom.id },
    });

    const newSlots = await prisma.timetableSlot.findMany({ where: { classroomId: s.newClassroom.id } });
    expect(newSlots).toHaveLength(0);
  });
});
