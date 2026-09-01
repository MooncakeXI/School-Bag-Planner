import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createClassroom,
  createItemCopy,
  createStudent,
  linkParent,
  setItemCopyState,
  transferStudent,
  withdrawStudent,
} from "@/lib/roster";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

async function seedTeacherInSchool(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { name: `Subject ${label}` } });
  const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: `Item ${label}` } });

  const teacherUser = await prisma.user.create({ data: { email: `teacher-${label}@example.com` } });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, email: teacherUser.email!, name: `Teacher ${label}` },
  });
  await prisma.teachingAssignment.create({
    data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: subject.id },
  });

  const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };
  return { school, classroom, subject, subjectItem, teacherActor };
}

describe("lib/roster.ts", () => {
  beforeEach(resetDb);

  it("createClassroom grants the creator a TeachingAssignment for each selected subject", async () => {
    const a = await seedTeacherInSchool("A");
    const extraSubject = await prisma.subject.create({ data: { name: "Extra" } });

    const classroom = await createClassroom(a.teacherActor, {
      schoolId: a.school.id,
      name: "New Room",
      subjectIds: [a.subject.id, extraSubject.id],
    });

    const assignments = await prisma.teachingAssignment.findMany({ where: { classroomId: classroom.id } });
    expect(assignments.map((x) => x.subjectId).sort()).toEqual([a.subject.id, extraSubject.id].sort());
  });

  it("denies createClassroom for a teacher outside that school", async () => {
    const a = await seedTeacherInSchool("A");
    const b = await seedTeacherInSchool("B");

    await expect(
      createClassroom(b.teacherActor, { schoolId: a.school.id, name: "Intruder Room", subjectIds: [a.subject.id] }),
    ).rejects.toThrow();
  });

  it("createStudent creates the student with an active enrollment in that classroom", async () => {
    const a = await seedTeacherInSchool("A");
    const student = await createStudent(a.teacherActor, a.classroom.id, "New Kid");

    const enrollment = await prisma.enrollment.findFirst({ where: { studentId: student.id } });
    expect(enrollment?.classroomId).toBe(a.classroom.id);
    expect(enrollment?.endDate).toBeNull();
  });

  it("transferStudent ends the old enrollment and starts a new one, only when authorized on both classrooms", async () => {
    const a = await seedTeacherInSchool("A");
    const otherClassroom = await prisma.classroom.create({ data: { schoolId: a.school.id, name: "Room A2" } });
    await prisma.teachingAssignment.create({
      data: { teacherId: a.teacherActor.teacherId!, classroomId: otherClassroom.id, subjectId: a.subject.id },
    });

    const student = await createStudent(a.teacherActor, a.classroom.id, "Mover");
    await transferStudent(a.teacherActor, student.id, otherClassroom.id);

    const enrollments = await prisma.enrollment.findMany({ where: { studentId: student.id }, orderBy: { startDate: "asc" } });
    expect(enrollments).toHaveLength(2);
    expect(enrollments[0].classroomId).toBe(a.classroom.id);
    expect(enrollments[0].endDate).not.toBeNull();
    expect(enrollments[1].classroomId).toBe(otherClassroom.id);
    expect(enrollments[1].endDate).toBeNull();
  });

  it("denies transferStudent into a classroom the teacher doesn't teach", async () => {
    const a = await seedTeacherInSchool("A");
    const b = await seedTeacherInSchool("B");
    const student = await createStudent(a.teacherActor, a.classroom.id, "Mover");

    await expect(transferStudent(a.teacherActor, student.id, b.classroom.id)).rejects.toThrow();
  });

  it("withdrawStudent ends the current enrollment with no replacement", async () => {
    const a = await seedTeacherInSchool("A");
    const student = await createStudent(a.teacherActor, a.classroom.id, "Leaver");

    await withdrawStudent(a.teacherActor, student.id);

    const active = await prisma.enrollment.findFirst({ where: { studentId: student.id, endDate: null } });
    expect(active).toBeNull();
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
});
