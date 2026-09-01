import { prisma } from "./prisma";
import { can } from "./policy";
import { ForbiddenError } from "./errors";
import { balance } from "./points";
import type { Actor } from "./actor";

// Rewards are a school-wide catalog, same coarse-grained shape as
// lib/catalog.ts's Subjects: any teacher at the school may manage them,
// scoping is by school membership via a TeachingAssignment, not per-classroom.
async function requireTeacherAtSchool(actor: Actor, schoolId: string) {
  if (!(await can(actor, "edit_rewards", { type: "school", schoolId }))) {
    throw new ForbiddenError("edit_rewards", { type: "school", schoolId });
  }
}

export async function createReward(actor: Actor, params: { schoolId: string; name: string; cost: number }) {
  await requireTeacherAtSchool(actor, params.schoolId);
  if (params.cost < 1) throw new Error("cost must be positive");
  return prisma.reward.create({ data: params });
}

export async function updateReward(
  actor: Actor,
  rewardId: string,
  params: { name?: string; cost?: number; active?: boolean },
) {
  const reward = await prisma.reward.findUniqueOrThrow({ where: { id: rewardId }, select: { schoolId: true } });
  await requireTeacherAtSchool(actor, reward.schoolId);
  return prisma.reward.update({ where: { id: rewardId }, data: params });
}

export async function deleteReward(actor: Actor, rewardId: string) {
  const reward = await prisma.reward.findUniqueOrThrow({ where: { id: rewardId }, select: { schoolId: true } });
  await requireTeacherAtSchool(actor, reward.schoolId);
  await prisma.reward.delete({ where: { id: rewardId } });
}

/**
 * A student redeems a reward for themselves only — checked by direct
 * equality, same as lib/packing.ts's scan ownership check. Serializable
 * isolation (not the Postgres default READ COMMITTED) is required here:
 * two concurrent redemptions both reading the same balance before either
 * commits could otherwise both pass the balance check and overspend —
 * Serializable makes Postgres abort one of them instead.
 */
export async function redeem(actor: Actor, rewardId: string) {
  if (!actor.studentId) throw new ForbiddenError("view_student", { type: "student", studentId: "" });
  const studentId = actor.studentId;

  return prisma.$transaction(
    async (tx) => {
      const reward = await tx.reward.findUniqueOrThrow({ where: { id: rewardId } });
      if (!reward.active) throw new Error("ของรางวัลนี้ปิดรับแลกแล้ว");

      const current = await balance(studentId, tx);
      if (current < reward.cost) throw new Error("แต้มไม่พอ");

      const redemption = await tx.redemption.create({
        data: { studentId, rewardId, pointsSpent: reward.cost },
      });
      await tx.pointLedger.create({
        data: { studentId, delta: -reward.cost, reason: "REDEMPTION", refId: redemption.id },
      });
      return redemption;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function fulfillRedemption(actor: Actor, redemptionId: string) {
  const redemption = await prisma.redemption.findUniqueOrThrow({
    where: { id: redemptionId },
    include: { reward: { select: { schoolId: true } } },
  });
  await requireTeacherAtSchool(actor, redemption.reward.schoolId);
  // requireTeacherAtSchool already guarantees this; re-checked so TS can narrow actor.teacherId below.
  if (!actor.teacherId) throw new ForbiddenError("edit_rewards", { type: "school", schoolId: redemption.reward.schoolId });

  return prisma.redemption.update({
    where: { id: redemptionId },
    data: { status: "FULFILLED", fulfilledAt: new Date(), fulfilledByTeacherId: actor.teacherId },
  });
}
