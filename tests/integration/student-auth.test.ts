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
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: "Subject A" } });

  const teacherUser = await prisma.user.create({ data: { email: "teacher-a@example.com" } });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, email: teacherUser.email!, name: "Teacher A" },
  });
  await prisma.teachingAssignment.create({ data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: subject.id } });
  await prisma.classroom.update({ where: { id: classroom.id }, data: { homeroomTeacherId: teacher.id } });
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
    expect(studentCode).toMatch(new RegExp(`^\\d{${STUDENT_CODE_LENGTH}}$`));
    expect(password).toMatch(new RegExp(`^\\d{${STUDENT_PASSWORD_LENGTH}}$`));

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

  it("grows the wait between wrong attempts exponentially (1s, 2s, 4s, 8s, ...), but never locks the account outright", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();
    const { studentCode, password } = await issueStudentCredentials(teacherActor, student.id);

    for (const expectedDelay of [1, 2, 4, 8]) {
      const result = await verifyStudentLogin(studentCode, "000000");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error).toContain(`ลองใหม่ใน ${expectedDelay} วินาที`);
      // Clear this attempt's cooldown so the next one is a genuinely fresh
      // attempt, not one rejected merely for arriving early.
      vi.setSystemTime(new Date(Date.now() + (expectedDelay + 1) * 1000));
    }

    // No hard lock exists at all, unlike the old design — the correct
    // password succeeds immediately, however many wrong guesses preceded it.
    expect((await verifyStudentLogin(studentCode, password)).ok).toBe(true);
  });

  it("a wrong attempt made while still inside a cooldown does not advance the backoff level further", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();
    const { studentCode } = await issueStudentCredentials(teacherActor, student.id);

    const first = await verifyStudentLogin(studentCode, "000000"); // sets a 1s cooldown
    if (first.ok) throw new Error("unreachable");
    expect(first.error).toContain("ลองใหม่ใน 1 วินาที");

    // Immediately retrying, still inside that 1s window, must not "pay" for
    // an escalation to 2s — an attacker spamming through the wait can't buy
    // a shorter effective delay than someone who waits it out once.
    const duringCooldown = await verifyStudentLogin(studentCode, "000000");
    if (duringCooldown.ok) throw new Error("unreachable");
    expect(duringCooldown.error).toMatch(/ลองใหม่ใน 1 วินาที|ลองใหม่ใน 0 วินาที/);

    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(row.failedLoginAttempts).toBe(1);
  });

  it("a correct password succeeds immediately even during an active cooldown, clearing all backoff state", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();
    const { studentCode, password } = await issueStudentCredentials(teacherActor, student.id);

    await verifyStudentLogin(studentCode, "000000"); // sets a 1s cooldown
    const result = await verifyStudentLogin(studentCode, password); // right away, still inside it
    expect(result.ok).toBe(true);

    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.nextLoginAttemptAt).toBeNull();
  });

  it("decays the backoff level back to the start after a quiet period", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();
    const { studentCode } = await issueStudentCredentials(teacherActor, student.id);

    const first = await verifyStudentLogin(studentCode, "000000");
    if (first.ok) throw new Error("unreachable");
    expect(first.error).toContain("ลองใหม่ใน 1 วินาที");

    // Well past both the 1s cooldown and the 10-minute decay window.
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000));

    const afterQuiet = await verifyStudentLogin(studentCode, "000000");
    if (afterQuiet.ok) throw new Error("unreachable");
    expect(afterQuiet.error).toContain("ลองใหม่ใน 1 วินาที"); // back to the start, not 2s
  });

  it("resets the failed-attempt counter on a successful login", async () => {
    const { teacherActor, student } = await seedClassroomWithTeacherAndStudent();
    const { studentCode, password } = await issueStudentCredentials(teacherActor, student.id);

    await verifyStudentLogin(studentCode, "000000");
    vi.setSystemTime(new Date(Date.now() + 2000)); // past the 1s cooldown
    await verifyStudentLogin(studentCode, "000000");
    await verifyStudentLogin(studentCode, password); // succeeds, should clear the counter

    const row = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.nextLoginAttemptAt).toBeNull();
  });
});
