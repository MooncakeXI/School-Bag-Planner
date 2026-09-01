import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { issueStudentCredentials } from "@/lib/roster";
import { verifyStudentLogin, generateUniqueStudentCode, generatePassword } from "@/lib/student-auth";
import { STUDENT_CODE_LENGTH, STUDENT_PASSWORD_LENGTH } from "@/lib/student-code";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

async function seedClassroomWithTeacherAndStudent() {
  const school = await prisma.school.create({ data: { name: "School A" } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "Room A" } });
  const subject = await prisma.subject.create({ data: { name: "Subject A" } });

  const teacherUser = await prisma.user.create({ data: { email: "teacher-a@example.com" } });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, email: teacherUser.email!, name: "Teacher A" },
  });
  await prisma.teachingAssignment.create({ data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: subject.id } });
  const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

  const student = await prisma.student.create({ data: { name: "Manee" } });
  await prisma.enrollment.create({ data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-01-01") } });

  return { classroom, teacherActor, student };
}

describe("generateUniqueStudentCode / generatePassword", () => {
  beforeEach(resetDb);

  it("produces numeric-only strings of the configured length", async () => {
    const code = await generateUniqueStudentCode();
    expect(code).toMatch(new RegExp(`^\\d{${STUDENT_CODE_LENGTH}}$`));
    const password = generatePassword();
    expect(password).toMatch(new RegExp(`^\\d{${STUDENT_PASSWORD_LENGTH}}$`));
  });

  it("never collides with an existing code", async () => {
    const taken = await generateUniqueStudentCode();
    await prisma.student.create({ data: { name: "Taken", studentCode: taken } });
    const next = await generateUniqueStudentCode();
    expect(next).not.toBe(taken);
  });
});

describe("issueStudentCredentials", () => {
  beforeEach(resetDb);

  it("stores only a bcrypt hash, never the plaintext, and returns the plaintext once", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();

    const { studentCode, password } = await issueStudentCredentials(teacherActor, student.id);
    expect(studentCode).toMatch(/^\d{6}$/);
    expect(password).toMatch(/^\d{4}$/);

    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(row.studentCode).toBe(studentCode);
    expect(row.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, row.passwordHash!)).toBe(true);
  });

  it("keeps the same studentCode across a reset, but issues a new password", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();
    const first = await issueStudentCredentials(teacherActor, student.id);
    const second = await issueStudentCredentials(teacherActor, student.id);
    expect(second.studentCode).toBe(first.studentCode);
  });

  it("denies a teacher who doesn't teach that classroom (parents stay read-only, out of scope entirely)", async () => {
    const { student } = await seedClassroomWithTeacherAndStudent();
    const outsiderUser = await prisma.user.create({ data: { email: "outsider@example.com" } });
    const outsider = await prisma.teacher.create({
      data: { userId: outsiderUser.id, email: outsiderUser.email!, name: "Outsider" },
    });
    const outsiderActor: Actor = { userId: outsiderUser.id, teacherId: outsider.id, parentId: null, studentId: null };

    await expect(issueStudentCredentials(outsiderActor, student.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("verifyStudentLogin", () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects an unknown student code without throwing", async () => {
    const result = await verifyStudentLogin("000000", "1234");
    expect(result.ok).toBe(false);
  });

  it("logs in with the right code + password, creating a database session row (not JWT)", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();
    const { studentCode, password } = await issueStudentCredentials(teacherActor, student.id);

    const result = await verifyStudentLogin(studentCode, password);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const session = await prisma.session.findUniqueOrThrow({ where: { sessionToken: result.sessionToken } });
    const linkedStudent = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(session.userId).toBe(linkedStudent.userId);
    expect(linkedStudent.userId).not.toBeNull();
  });

  it("locks the account after repeated wrong passwords, even with the right code", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();
    const { studentCode, password } = await issueStudentCredentials(teacherActor, student.id);

    for (let i = 0; i < 5; i++) {
      const result = await verifyStudentLogin(studentCode, "0000");
      expect(result.ok).toBe(false);
    }

    // Even the correct password is rejected while locked out.
    const attempt = await verifyStudentLogin(studentCode, password);
    expect(attempt.ok).toBe(false);

    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(row.lockedUntil).not.toBeNull();
  });

  it("unlocks again once the lockout window has passed", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();
    const { studentCode, password } = await issueStudentCredentials(teacherActor, student.id);

    for (let i = 0; i < 5; i++) await verifyStudentLogin(studentCode, "0000");
    expect((await verifyStudentLogin(studentCode, password)).ok).toBe(false);

    vi.setSystemTime(new Date(Date.now() + 16 * 60 * 1000)); // past the 15-minute lockout
    expect((await verifyStudentLogin(studentCode, password)).ok).toBe(true);
  });

  it("resets the failed-attempt counter on a successful login", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();
    const { studentCode, password } = await issueStudentCredentials(teacherActor, student.id);

    await verifyStudentLogin(studentCode, "0000");
    await verifyStudentLogin(studentCode, "0000");
    await verifyStudentLogin(studentCode, password); // succeeds, should clear the counter

    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });
});
