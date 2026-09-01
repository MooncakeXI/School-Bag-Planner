import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { can, visibleClassroomWhere, visibleStudentWhere } from "@/lib/policy";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

async function makeUser(email: string) {
  return prisma.user.create({ data: { email } });
}

async function seedSchoolWithPeople(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { name: `Subject ${label}` } });

  const teacherUser = await makeUser(`teacher-${label}@example.com`);
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, email: teacherUser.email!, name: `Teacher ${label}` },
  });
  await prisma.teachingAssignment.create({
    data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: subject.id },
  });

  const student = await prisma.student.create({ data: { name: `Student ${label}` } });
  const studentUser = await makeUser(`student-${label}@example.com`);
  await prisma.student.update({ where: { id: student.id }, data: { userId: studentUser.id } });
  await prisma.enrollment.create({
    data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-05-01") },
  });

  const parentUser = await makeUser(`parent-${label}@example.com`);
  const parent = await prisma.parent.create({
    data: { userId: parentUser.id, email: parentUser.email!, name: `Parent ${label}` },
  });
  await prisma.guardianship.create({ data: { parentId: parent.id, studentId: student.id } });

  const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };
  const studentActor: Actor = { userId: studentUser.id, teacherId: null, parentId: null, studentId: student.id };
  const parentActor: Actor = { userId: parentUser.id, teacherId: null, parentId: parent.id, studentId: null };

  return { school, classroom, teacherActor, studentActor, parentActor, studentId: student.id };
}

describe("can() policy matrix", () => {
  beforeEach(resetDb);

  it("grants a teacher view/edit on their own classroom and its school", async () => {
    const a = await seedSchoolWithPeople("A");
    expect(await can(a.teacherActor, "view_timetable", { type: "classroom", classroomId: a.classroom.id })).toBe(true);
    expect(await can(a.teacherActor, "edit_timetable", { type: "classroom", classroomId: a.classroom.id })).toBe(true);
    expect(await can(a.teacherActor, "edit_exceptions", { type: "school", schoolId: a.school.id })).toBe(true);
  });

  it("denies a teacher any access to another classroom or school", async () => {
    const a = await seedSchoolWithPeople("A");
    const b = await seedSchoolWithPeople("B");

    expect(await can(a.teacherActor, "view_timetable", { type: "classroom", classroomId: b.classroom.id })).toBe(false);
    expect(await can(a.teacherActor, "edit_timetable", { type: "classroom", classroomId: b.classroom.id })).toBe(false);
    expect(await can(a.teacherActor, "view_exceptions", { type: "classroom", classroomId: b.classroom.id })).toBe(false);
    expect(await can(a.teacherActor, "edit_exceptions", { type: "school", schoolId: b.school.id })).toBe(false);
    expect(await can(a.teacherActor, "view_student", { type: "student", studentId: b.studentId })).toBe(false);
  });

  it("lets a student view (never edit) their own classroom, and denies another classroom entirely", async () => {
    const a = await seedSchoolWithPeople("A");
    const b = await seedSchoolWithPeople("B");

    expect(await can(a.studentActor, "view_timetable", { type: "classroom", classroomId: a.classroom.id })).toBe(true);
    expect(await can(a.studentActor, "edit_timetable", { type: "classroom", classroomId: a.classroom.id })).toBe(false);
    expect(await can(a.studentActor, "view_timetable", { type: "classroom", classroomId: b.classroom.id })).toBe(false);
    expect(await can(a.studentActor, "view_student", { type: "student", studentId: a.studentId })).toBe(true);
    expect(await can(a.studentActor, "view_student", { type: "student", studentId: b.studentId })).toBe(false);
  });

  it("lets a parent view their own child's classroom and data, and denies another family's entirely", async () => {
    const a = await seedSchoolWithPeople("A");
    const b = await seedSchoolWithPeople("B");

    expect(await can(a.parentActor, "view_timetable", { type: "classroom", classroomId: a.classroom.id })).toBe(true);
    expect(await can(a.parentActor, "edit_timetable", { type: "classroom", classroomId: a.classroom.id })).toBe(false);
    expect(await can(a.parentActor, "view_student", { type: "student", studentId: a.studentId })).toBe(true);
    expect(await can(a.parentActor, "view_timetable", { type: "classroom", classroomId: b.classroom.id })).toBe(false);
    expect(await can(a.parentActor, "view_student", { type: "student", studentId: b.studentId })).toBe(false);
  });

  it("denies a logged-in user with no linked profile everything", async () => {
    const a = await seedSchoolWithPeople("A");
    const nobody: Actor = { userId: "unaffiliated-user", teacherId: null, parentId: null, studentId: null };

    expect(await can(nobody, "view_timetable", { type: "classroom", classroomId: a.classroom.id })).toBe(false);
    expect(await can(nobody, "edit_timetable", { type: "classroom", classroomId: a.classroom.id })).toBe(false);
    expect(await can(nobody, "view_student", { type: "student", studentId: a.studentId })).toBe(false);
    expect(await can(nobody, "edit_exceptions", { type: "school", schoolId: a.school.id })).toBe(false);
  });
});

describe("visible*Where scoping", () => {
  beforeEach(resetDb);

  it("scopes classroom listings to only what the actor may see", async () => {
    const a = await seedSchoolWithPeople("A");
    const b = await seedSchoolWithPeople("B");

    const teacherAClassrooms = await prisma.classroom.findMany({ where: visibleClassroomWhere(a.teacherActor) });
    expect(teacherAClassrooms.map((c) => c.id)).toEqual([a.classroom.id]);

    const parentAClassrooms = await prisma.classroom.findMany({ where: visibleClassroomWhere(a.parentActor) });
    expect(parentAClassrooms.map((c) => c.id)).toEqual([a.classroom.id]);

    const nobody = { userId: "x", teacherId: null, parentId: null, studentId: null };
    const nobodyClassrooms = await prisma.classroom.findMany({ where: visibleClassroomWhere(nobody) });
    expect(nobodyClassrooms).toEqual([]);

    void b; // exists only to prove it's excluded above
  });

  it("scopes student listings to only what the actor may see", async () => {
    const a = await seedSchoolWithPeople("A");
    await seedSchoolWithPeople("B");

    const teacherAStudents = await prisma.student.findMany({ where: visibleStudentWhere(a.teacherActor) });
    expect(teacherAStudents.map((s) => s.id)).toEqual([a.studentId]);

    const parentAStudents = await prisma.student.findMany({ where: visibleStudentWhere(a.parentActor) });
    expect(parentAStudents.map((s) => s.id)).toEqual([a.studentId]);
  });
});
