import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createReward, redeem, fulfillRedemption } from "@/lib/rewards";
import { award, balance } from "@/lib/points";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

async function seedSchoolWithTeacherAndStudent(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { name: `Subject ${label}` } });

  const teacherUser = await prisma.user.create({ data: { email: `teacher-${label}@example.com` } });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, email: teacherUser.email!, name: `Teacher ${label}` },
  });
  await prisma.teachingAssignment.create({ data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: subject.id } });
  const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

  const student = await prisma.student.create({ data: { name: `Student ${label}` } });
  await prisma.enrollment.create({ data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-01-01") } });
  const studentActor: Actor = { userId: `student-user-${label}`, teacherId: null, parentId: null, studentId: student.id };

  return { school, classroom, teacherActor, student, studentActor };
}

describe("rewards & redemption", () => {
  beforeEach(resetDb);

  it("rejects redeeming when the student's balance is below cost", async () => {
    const s = await seedSchoolWithTeacherAndStudent("A");
    const reward = await createReward(s.teacherActor, { schoolId: s.school.id, name: "Notebook", cost: 100 });

    await expect(redeem(s.studentActor, reward.id)).rejects.toThrow("แต้มไม่พอ");
    expect(await balance(s.student.id)).toBe(0);
  });

  it("redeems successfully, deducting an append-only ledger row equal to cost", async () => {
    const s = await seedSchoolWithTeacherAndStudent("A");
    const reward = await createReward(s.teacherActor, { schoolId: s.school.id, name: "Pencil", cost: 50 });
    await award(s.student.id, 60, "PACKING_COMPLETE");

    const redemption = await redeem(s.studentActor, reward.id);
    expect(redemption.status).toBe("PENDING");
    expect(redemption.pointsSpent).toBe(50);
    expect(await balance(s.student.id)).toBe(10);
  });

  it("two concurrent redemptions cannot both succeed past the balance (transaction-safe)", async () => {
    const s = await seedSchoolWithTeacherAndStudent("A");
    const reward = await createReward(s.teacherActor, { schoolId: s.school.id, name: "Pencil case", cost: 100 });
    await award(s.student.id, 100, "PACKING_COMPLETE");

    const results = await Promise.allSettled([redeem(s.studentActor, reward.id), redeem(s.studentActor, reward.id)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await balance(s.student.id)).toBe(0);
  });

  it("a teacher outside the school cannot create rewards for it", async () => {
    const a = await seedSchoolWithTeacherAndStudent("A");
    const b = await seedSchoolWithTeacherAndStudent("B");
    await expect(createReward(b.teacherActor, { schoolId: a.school.id, name: "Sticker", cost: 10 })).rejects.toThrow();
  });

  it("fulfilling a redemption stamps the audit fields", async () => {
    const s = await seedSchoolWithTeacherAndStudent("A");
    const reward = await createReward(s.teacherActor, { schoolId: s.school.id, name: "Eraser", cost: 20 });
    await award(s.student.id, 20, "PACKING_COMPLETE");
    const redemption = await redeem(s.studentActor, reward.id);

    const fulfilled = await fulfillRedemption(s.teacherActor, redemption.id);
    expect(fulfilled.status).toBe("FULFILLED");
    expect(fulfilled.fulfilledByTeacherId).toBe(s.teacherActor.teacherId);
    expect(fulfilled.fulfilledAt).not.toBeNull();
  });
});
