import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  bulkSetItemCopyStateForClassroom,
  createItemCopiesForClassroom,
  createItemCopy,
  createStudent,
  linkParent,
  setItemCopyState,
} from "@/lib/roster";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

/** This helper's teacher is also made the classroom's homeroom teacher —
 * the "one teacher, full rights" fixture most tests here want. Tests that
 * specifically exercise the homeroom-vs-subject-teacher distinction seed
 * their own second, subject-only teacher instead. */
async function seedTeacherInSchool(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: `Subject ${label}` } });
  const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: `Item ${label}` } });

  const teacherUser = await prisma.user.create({ data: { email: `teacher-${label}@example.com` } });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, email: teacherUser.email!, name: `Teacher ${label}` },
  });
  await prisma.teachingAssignment.create({
    data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: subject.id },
  });
  await prisma.classroom.update({ where: { id: classroom.id }, data: { homeroomTeacherId: teacher.id } });

  const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };
  return { school, classroom, subject, subjectItem, teacherActor };
}

describe("lib/roster.ts", () => {
  beforeEach(resetDb);

  it("createStudent creates the student with an active enrollment in that classroom", async () => {
    const a = await seedTeacherInSchool("A");
    const student = await createStudent(a.teacherActor, a.classroom.id, "New Kid");

    const enrollment = await prisma.enrollment.findFirst({ where: { studentId: student.id } });
    expect(enrollment?.classroomId).toBe(a.classroom.id);
    expect(enrollment?.endDate).toBeNull();
  });

  it("linkParent is idempotent — re-linking the same email doesn't duplicate the guardianship", async () => {
    const a = await seedTeacherInSchool("A");
    const student = await createStudent(a.teacherActor, a.classroom.id, "Kid");

    await linkParent(a.teacherActor, student.id, { email: "parent@example.com", name: "Parent One" });
    await linkParent(a.teacherActor, student.id, { email: "parent@example.com", name: "Parent One" });

    const guardianships = await prisma.guardianship.findMany({ where: { studentId: student.id } });
    expect(guardianships).toHaveLength(1);
  });

  it("setItemCopyState toggles GRADING/WITH_STUDENT and is denied to a teacher outside the classroom", async () => {
    const a = await seedTeacherInSchool("A");
    const b = await seedTeacherInSchool("B");
    const student = await createStudent(a.teacherActor, a.classroom.id, "Kid");
    const copy = await createItemCopy(a.teacherActor, { studentId: student.id, subjectItemId: a.subjectItem.id });

    const graded = await setItemCopyState(a.teacherActor, copy.id, "GRADING");
    expect(graded.state).toBe("GRADING");

    await expect(setItemCopyState(b.teacherActor, copy.id, "WITH_STUDENT")).rejects.toThrow();
  });

  it("denies createItemCopy for a subject the teacher doesn't teach, even within a classroom they do teach", async () => {
    const a = await seedTeacherInSchool("A"); // homeroom teacher — deliberately NOT used below
    const student = await createStudent(a.teacherActor, a.classroom.id, "Kid");

    const otherSubject = await prisma.subject.create({ data: { schoolId: a.school.id, name: "Other Subject" } });
    const otherItem = await prisma.subjectItem.create({ data: { subjectId: otherSubject.id, name: "Other Item" } });

    const peUser = await prisma.user.create({ data: { email: "pe-teacher-2@example.com" } });
    const peTeacher = await prisma.teacher.create({
      data: { userId: peUser.id, email: peUser.email!, name: "PE Teacher" },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: peTeacher.id, classroomId: a.classroom.id, subjectId: a.subject.id },
    });
    const peActor: Actor = { userId: peUser.id, teacherId: peTeacher.id, parentId: null, studentId: null };

    // peActor teaches a.subject in this classroom (so it's not an outsider),
    // but not otherSubject, and isn't the homeroom teacher.
    await expect(
      createItemCopy(peActor, { studentId: student.id, subjectItemId: otherItem.id }),
    ).rejects.toThrow();
  });

  it("only the homeroom teacher may linkParent — a subject teacher in the same classroom is denied", async () => {
    const a = await seedTeacherInSchool("A"); // a.teacherActor is the homeroom teacher
    const student = await createStudent(a.teacherActor, a.classroom.id, "Kid");

    const peSubject = await prisma.subject.create({ data: { schoolId: a.school.id, name: "PE" } });
    const peUser = await prisma.user.create({ data: { email: "pe-teacher@example.com" } });
    const peTeacher = await prisma.teacher.create({
      data: { userId: peUser.id, email: peUser.email!, name: "PE Teacher" },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: peTeacher.id, classroomId: a.classroom.id, subjectId: peSubject.id },
    });
    const peActor: Actor = { userId: peUser.id, teacherId: peTeacher.id, parentId: null, studentId: null };

    await expect(linkParent(peActor, student.id, { email: "parent@example.com", name: "Parent" })).rejects.toThrow();
    // The homeroom teacher can, from the same classroom.
    await expect(
      linkParent(a.teacherActor, student.id, { email: "parent@example.com", name: "Parent" }),
    ).resolves.toBeDefined();
  });
});

describe("createItemCopiesForClassroom (bulk onboarding)", () => {
  beforeEach(resetDb);

  it("subject-scoped denial rejects the whole batch — nothing is created, not even for the item the teacher does teach", async () => {
    const a = await seedTeacherInSchool("A"); // homeroom teacher — deliberately NOT used below
    const student = await createStudent(a.teacherActor, a.classroom.id, "Kid");

    const otherSubject = await prisma.subject.create({ data: { schoolId: a.school.id, name: "Other Subject" } });
    const otherItem = await prisma.subjectItem.create({ data: { subjectId: otherSubject.id, name: "Other Item" } });

    const peUser = await prisma.user.create({ data: { email: "pe-teacher-bulk@example.com" } });
    const peTeacher = await prisma.teacher.create({
      data: { userId: peUser.id, email: peUser.email!, name: "PE Teacher" },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: peTeacher.id, classroomId: a.classroom.id, subjectId: a.subject.id },
    });
    const peActor: Actor = { userId: peUser.id, teacherId: peTeacher.id, parentId: null, studentId: null };

    // peActor teaches a.subject here (so a.subjectItem alone would pass),
    // but not otherSubject — the whole call must still be rejected.
    await expect(
      createItemCopiesForClassroom(peActor, {
        classroomId: a.classroom.id,
        subjectItemIds: [a.subjectItem.id, otherItem.id],
      }),
    ).rejects.toThrow();

    const copies = await prisma.itemCopy.findMany({ where: { studentId: student.id } });
    expect(copies).toHaveLength(0);
  });

  it("is idempotent — re-running the same batch creates nothing new and reports it as skipped", async () => {
    const a = await seedTeacherInSchool("A");
    await createStudent(a.teacherActor, a.classroom.id, "Kid 1");
    await createStudent(a.teacherActor, a.classroom.id, "Kid 2");

    const first = await createItemCopiesForClassroom(a.teacherActor, {
      classroomId: a.classroom.id,
      subjectItemIds: [a.subjectItem.id],
    });
    expect(first).toEqual({ created: 2, skipped: 0 });

    const second = await createItemCopiesForClassroom(a.teacherActor, {
      classroomId: a.classroom.id,
      subjectItemIds: [a.subjectItem.id],
    });
    expect(second).toEqual({ created: 0, skipped: 2 });

    const copies = await prisma.itemCopy.findMany({ where: { subjectItemId: a.subjectItem.id } });
    expect(copies).toHaveLength(2);
  });

  it("a student whose enrollment has ended gets no copy", async () => {
    const a = await seedTeacherInSchool("A");
    const activeStudent = await createStudent(a.teacherActor, a.classroom.id, "Active Kid");
    const endedStudent = await prisma.student.create({ data: { name: "Left Kid" } });
    await prisma.enrollment.create({
      data: {
        studentId: endedStudent.id,
        classroomId: a.classroom.id,
        startDate: new Date("2025-05-01"),
        endDate: new Date("2025-10-01"), // ended in the past
      },
    });

    const result = await createItemCopiesForClassroom(a.teacherActor, {
      classroomId: a.classroom.id,
      subjectItemIds: [a.subjectItem.id],
    });
    expect(result).toEqual({ created: 1, skipped: 0 });

    const activeCopies = await prisma.itemCopy.findMany({ where: { studentId: activeStudent.id } });
    expect(activeCopies).toHaveLength(1);
    const endedCopies = await prisma.itemCopy.findMany({ where: { studentId: endedStudent.id } });
    expect(endedCopies).toHaveLength(0);
  });
});

describe("bulkSetItemCopyStateForClassroom", () => {
  beforeEach(resetDb);

  it("sets GRADING on every currently-enrolled student's copy of the item, and reports the count", async () => {
    const a = await seedTeacherInSchool("A");
    const s1 = await createStudent(a.teacherActor, a.classroom.id, "Kid 1");
    const s2 = await createStudent(a.teacherActor, a.classroom.id, "Kid 2");
    await createItemCopiesForClassroom(a.teacherActor, { classroomId: a.classroom.id, subjectItemIds: [a.subjectItem.id] });

    const result = await bulkSetItemCopyStateForClassroom(a.teacherActor, {
      classroomId: a.classroom.id,
      subjectItemId: a.subjectItem.id,
      state: "GRADING",
    });
    expect(result).toEqual({ updated: 2 });

    const copies = await prisma.itemCopy.findMany({ where: { studentId: { in: [s1.id, s2.id] } } });
    expect(copies.every((c) => c.state === "GRADING")).toBe(true);

    // Toggling back is the same call with the other state — no separate function.
    const reverted = await bulkSetItemCopyStateForClassroom(a.teacherActor, {
      classroomId: a.classroom.id,
      subjectItemId: a.subjectItem.id,
      state: "WITH_STUDENT",
    });
    expect(reverted).toEqual({ updated: 2 });
  });

  it("leaves a withdrawn student's copy untouched", async () => {
    const a = await seedTeacherInSchool("A");
    const activeStudent = await createStudent(a.teacherActor, a.classroom.id, "Active Kid");
    const leftStudent = await prisma.student.create({ data: { name: "Left Kid" } });
    await prisma.enrollment.create({
      data: {
        studentId: leftStudent.id,
        classroomId: a.classroom.id,
        startDate: new Date("2025-05-01"),
        endDate: new Date("2025-10-01"),
      },
    });
    const activeCopy = await createItemCopy(a.teacherActor, { studentId: activeStudent.id, subjectItemId: a.subjectItem.id });
    const leftCopy = await prisma.itemCopy.create({
      data: { studentId: leftStudent.id, subjectItemId: a.subjectItem.id, state: "WITH_STUDENT" },
    });

    const result = await bulkSetItemCopyStateForClassroom(a.teacherActor, {
      classroomId: a.classroom.id,
      subjectItemId: a.subjectItem.id,
      state: "GRADING",
    });
    expect(result).toEqual({ updated: 1 });

    expect((await prisma.itemCopy.findUniqueOrThrow({ where: { id: activeCopy.id } })).state).toBe("GRADING");
    expect((await prisma.itemCopy.findUniqueOrThrow({ where: { id: leftCopy.id } })).state).toBe("WITH_STUDENT");
  });

  it("is denied for a teacher who doesn't teach that subject, even within a classroom they do teach", async () => {
    const a = await seedTeacherInSchool("A"); // homeroom teacher — deliberately NOT used below
    await createStudent(a.teacherActor, a.classroom.id, "Kid");
    await createItemCopiesForClassroom(a.teacherActor, { classroomId: a.classroom.id, subjectItemIds: [a.subjectItem.id] });

    const peUser = await prisma.user.create({ data: { email: "pe-teacher-bulk-collect@example.com" } });
    const peTeacher = await prisma.teacher.create({ data: { userId: peUser.id, email: peUser.email!, name: "PE Teacher" } });
    const peSubject = await prisma.subject.create({ data: { schoolId: a.school.id, name: "PE" } });
    await prisma.teachingAssignment.create({ data: { teacherId: peTeacher.id, classroomId: a.classroom.id, subjectId: peSubject.id } });
    const peActor: Actor = { userId: peUser.id, teacherId: peTeacher.id, parentId: null, studentId: null };

    await expect(
      bulkSetItemCopyStateForClassroom(peActor, { classroomId: a.classroom.id, subjectItemId: a.subjectItem.id, state: "GRADING" }),
    ).rejects.toThrow();
  });

  it("the homeroom teacher can bulk-collect a subject's item they don't personally teach", async () => {
    const a = await seedTeacherInSchool("A"); // a.teacherActor is homeroom, teaches a.subject
    await createStudent(a.teacherActor, a.classroom.id, "Kid");

    const otherSubject = await prisma.subject.create({ data: { schoolId: a.school.id, name: "Other Subject" } });
    const otherItem = await prisma.subjectItem.create({ data: { subjectId: otherSubject.id, name: "Other Item" } });
    // Created directly, not via createItemCopiesForClassroom, since a.teacherActor
    // (homeroom but not assigned to otherSubject) shouldn't need edit_item_copy
    // on otherSubject just to seed the fixture.
    const student = await prisma.student.findFirstOrThrow({ where: { name: "Kid" } });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: otherItem.id, state: "WITH_STUDENT" } });

    const result = await bulkSetItemCopyStateForClassroom(a.teacherActor, {
      classroomId: a.classroom.id,
      subjectItemId: otherItem.id,
      state: "GRADING",
    });
    expect(result).toEqual({ updated: 1 });
  });
});
