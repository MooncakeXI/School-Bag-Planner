import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createReward, redeem, fulfillRedemption, deleteReward } from "@/lib/rewards";
import { award, balance } from "@/lib/points";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

async function seedSchoolWithTeacherAndStudent(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: `Subject ${label}` } });

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

  it("two concurrent redemptions cannot both succeed past the balance (transaction-safe), and the loser gets a clean rejection, not a raw serialization error", async () => {
    const s = await seedSchoolWithTeacherAndStudent("A");
    const reward = await createReward(s.teacherActor, { schoolId: s.school.id, name: "Pencil case", cost: 100 });
    await award(s.student.id, 100, "PACKING_COMPLETE");

    const results = await Promise.allSettled([redeem(s.studentActor, reward.id), redeem(s.studentActor, reward.id)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // withSerializableRetry (lib/db-retry.ts) retries the loser against the
    // now-committed balance instead of surfacing the raw P2034/40001
    // serialization failure — it lands on the same clean rejection a
    // straightforwardly-insufficient balance would produce.
    expect(rejected[0].reason.message).toBe("แต้มไม่พอ");
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

  it("rejects redeeming past stock, even with plenty of balance", async () => {
    const s = await seedSchoolWithTeacherAndStudent("A");
    const reward = await createReward(s.teacherActor, { schoolId: s.school.id, name: "Pencil", cost: 10, stock: 1 });
    await award(s.student.id, 100, "PACKING_COMPLETE");

    await redeem(s.studentActor, reward.id); // takes the only unit
    await expect(redeem(s.studentActor, reward.id)).rejects.toThrow("ของรางวัลหมดแล้ว");

    // The failed attempt didn't spend anything.
    expect(await balance(s.student.id)).toBe(90);
  });

  it("a null stock is unlimited — redeeming repeatedly never gets rejected for stock", async () => {
    const s = await seedSchoolWithTeacherAndStudent("A");
    const reward = await createReward(s.teacherActor, { schoolId: s.school.id, name: "Sticker", cost: 5 });
    await award(s.student.id, 100, "PACKING_COMPLETE");

    await redeem(s.studentActor, reward.id);
    await redeem(s.studentActor, reward.id);
    const updated = await prisma.reward.findUniqueOrThrow({ where: { id: reward.id } });
    expect(updated.stock).toBeNull();
  });

  it("two concurrent redemptions of the last unit in stock — exactly one succeeds, the other gets a clean out-of-stock rejection", async () => {
    const s = await seedSchoolWithTeacherAndStudent("A");
    const reward = await createReward(s.teacherActor, { schoolId: s.school.id, name: "Pencil case", cost: 10, stock: 1 });
    await award(s.student.id, 100, "PACKING_COMPLETE");

    const results = await Promise.allSettled([redeem(s.studentActor, reward.id), redeem(s.studentActor, reward.id)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Same retry mechanism as the balance race above — the loser retries
    // and finds the reward genuinely out of stock, rather than surfacing
    // the raw serialization failure.
    expect(rejected[0].reason.message).toBe("ของรางวัลหมดแล้ว");

    const updated = await prisma.reward.findUniqueOrThrow({ where: { id: reward.id } });
    expect(updated.stock).toBe(0);
    expect(await prisma.redemption.count({ where: { rewardId: reward.id } })).toBe(1);
  });

  it("deleteReward throws when redemption history exists, pointing at active: false instead", async () => {
    const s = await seedSchoolWithTeacherAndStudent("A");
    const reward = await createReward(s.teacherActor, { schoolId: s.school.id, name: "Notebook", cost: 10 });
    await award(s.student.id, 10, "PACKING_COMPLETE");
    await redeem(s.studentActor, reward.id);

    await expect(deleteReward(s.teacherActor, reward.id)).rejects.toThrow("active: false");

    // Nothing was deleted, and the ledger row's refId still resolves.
    expect(await prisma.reward.findUnique({ where: { id: reward.id } })).not.toBeNull();
    const ledgerRow = await prisma.pointLedger.findFirstOrThrow({ where: { studentId: s.student.id, reason: "REDEMPTION" } });
    const redemption = await prisma.redemption.findUnique({ where: { id: ledgerRow.refId! } });
    expect(redemption).not.toBeNull();
  });

  it("deleteReward still works for a reward with no redemption history", async () => {
    const s = await seedSchoolWithTeacherAndStudent("A");
    const reward = await createReward(s.teacherActor, { schoolId: s.school.id, name: "Unused reward", cost: 10 });

    await deleteReward(s.teacherActor, reward.id);

    expect(await prisma.reward.findUnique({ where: { id: reward.id } })).toBeNull();
  });
});
