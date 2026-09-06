import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createHomework,
  currentHomeworkForStudent,
  homeworkTargetsForTeacher,
  parseHomeworkDeadline,
} from "@/lib/homework";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

const NOW = new Date("2026-09-07T12:00:00Z");
const FUTURE = new Date("2026-09-10T12:00:00Z");

async function seedClassroom(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const otherClassroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Other room ${label}` } });
  const math = await prisma.subject.create({ data: { schoolId: school.id, name: `Math ${label}` } });
  const science = await prisma.subject.create({ data: { schoolId: school.id, name: `Science ${label}` } });

  const mathUser = await prisma.user.create({ data: { email: `math-${label}@example.com` } });
  const mathTeacher = await prisma.teacher.create({
    data: { userId: mathUser.id, email: mathUser.email!, name: `Math teacher ${label}` },
  });
  await prisma.teachingAssignment.create({ data: { teacherId: mathTeacher.id, classroomId: classroom.id, subjectId: math.id } });
  const mathActor: Actor = { userId: mathUser.id, teacherId: mathTeacher.id, parentId: null, studentId: null };

  const scienceUser = await prisma.user.create({ data: { email: `science-${label}@example.com` } });
  const scienceTeacher = await prisma.teacher.create({
    data: { userId: scienceUser.id, email: scienceUser.email!, name: `Science teacher ${label}` },
  });
  await prisma.teachingAssignment.create({ data: { teacherId: scienceTeacher.id, classroomId: classroom.id, subjectId: science.id } });

  const homeroomUser = await prisma.user.create({ data: { email: `homeroom-${label}@example.com` } });
  const homeroomTeacher = await prisma.teacher.create({
    data: { userId: homeroomUser.id, email: homeroomUser.email!, name: `Homeroom teacher ${label}` },
  });
  await prisma.classroom.update({ where: { id: classroom.id }, data: { homeroomTeacherId: homeroomTeacher.id } });
  const homeroomActor: Actor = { userId: homeroomUser.id, teacherId: homeroomTeacher.id, parentId: null, studentId: null };

  const student = await prisma.student.create({ data: { name: `Student ${label}` } });
  await prisma.enrollment.create({ data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2020-01-01") } });

  return { classroom, otherClassroom, math, science, mathActor, homeroomActor, student };
}

describe("homework", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("lets a subject teacher post to their assigned classroom/subject and shows it to the enrolled student", async () => {
    const s = await seedClassroom("A");

    const homework = await createHomework(s.mathActor, {
      classroomId: s.classroom.id,
      subjectId: s.math.id,
      description: "  Complete questions 1–5.  ",
      deadlineAt: FUTURE,
    });

    expect(homework.description).toBe("Complete questions 1–5.");
    expect(homework.postedByUserId).toBe(s.mathActor.userId);
    await expect(currentHomeworkForStudent(s.student.id, NOW)).resolves.toEqual([
      expect.objectContaining({ id: homework.id, description: "Complete questions 1–5." }),
    ]);
  });

  it("does not let a subject teacher post for another teacher's subject", async () => {
    const s = await seedClassroom("B");

    await expect(
      createHomework(s.mathActor, {
        classroomId: s.classroom.id,
        subjectId: s.science.id,
        description: "Write a science report",
        deadlineAt: FUTURE,
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("lets the homeroom teacher post any subject actually taught in their classroom", async () => {
    const s = await seedClassroom("C");

    const targets = await homeworkTargetsForTeacher(s.homeroomActor);
    expect(targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classroomId: s.classroom.id, subjectId: s.math.id }),
        expect.objectContaining({ classroomId: s.classroom.id, subjectId: s.science.id }),
      ]),
    );

    await expect(
      createHomework(s.homeroomActor, {
        classroomId: s.classroom.id,
        subjectId: s.science.id,
        description: "Observe the moon",
        deadlineAt: FUTURE,
      }),
    ).resolves.toEqual(expect.objectContaining({ subjectId: s.science.id }));
  });

  it("returns only unexpired homework from the student's active classroom", async () => {
    const s = await seedClassroom("D");
    await prisma.homework.createMany({
      data: [
        {
          classroomId: s.classroom.id,
          subjectId: s.math.id,
          description: "Current work",
          deadlineAt: FUTURE,
          postedByUserId: s.mathActor.userId,
        },
        {
          classroomId: s.classroom.id,
          subjectId: s.science.id,
          description: "Expired work",
          deadlineAt: new Date("2026-09-06T12:00:00Z"),
          postedByUserId: s.mathActor.userId,
        },
        {
          classroomId: s.otherClassroom.id,
          subjectId: s.math.id,
          description: "Another room's work",
          deadlineAt: FUTURE,
          postedByUserId: s.mathActor.userId,
        },
      ],
    });

    const homework = await currentHomeworkForStudent(s.student.id, NOW);
    expect(homework.map((item) => item.description)).toEqual(["Current work"]);
  });

  it("interprets form deadline fields in the school's Bangkok timezone", () => {
    expect(parseHomeworkDeadline("2026-09-08", "23:59").toISOString()).toBe("2026-09-08T16:59:00.000Z");
  });
});
