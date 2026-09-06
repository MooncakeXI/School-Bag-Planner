import { prisma } from "./prisma";
import { can } from "./policy";
import { ForbiddenError } from "./errors";
import { balance } from "./points";
import { withSerializableRetry } from "./db-retry";
import type { Actor } from "./actor";

// Rewards are a school-wide catalog, same coarse-grained shape as
// lib/catalog.ts's Subjects: any teacher at the school may manage them,
// scoping is by school membership via a TeachingAssignment, not per-classroom.
async function requireTeacherAtSchool(actor: Actor, schoolId: string) {
  if (!(await can(actor, "edit_rewards", { type: "school", schoolId }))) {
    throw new ForbiddenError("edit_rewards", { type: "school", schoolId });
  }
}

export async function createReward(
  actor: Actor,
  params: { schoolId: string; name: string; cost: number; stock?: number | null },
) {
  await requireTeacherAtSchool(actor, params.schoolId);
  if (params.cost < 1) throw new Error("cost must be positive");
  if (params.stock != null && params.stock < 0) throw new Error("stock must not be negative");
  return prisma.reward.create({ data: params });
}

export async function updateReward(
  actor: Actor,
  rewardId: string,
  params: { name?: string; cost?: number; stock?: number | null; active?: boolean },
) {
  const reward = await prisma.reward.findUniqueOrThrow({ where: { id: rewardId }, select: { schoolId: true } });
  await requireTeacherAtSchool(actor, reward.schoolId);
  return prisma.reward.update({ where: { id: rewardId }, data: params });
}

/**
 * Real delete — refused when any Redemption still references this reward.
 * Redemption.reward is `onDelete: Restrict` (the database enforces this
 * too, not just here), specifically because a PointLedger REDEMPTION row's
 * refId points at the Redemption, and PointLedger only cascades from
 * Student — deleting Redemptions out from under it would leave that refId
 * dangling, breaking invariant 4 (the ledger as the auditable record of
 * every point change). `active: false` (already the soft-hide field) is
 * the correct way to retire a reward that has redemption history.
 */
export async function deleteReward(actor: Actor, rewardId: string) {
  const reward = await prisma.reward.findUniqueOrThrow({ where: { id: rewardId }, select: { schoolId: true, name: true } });
  await requireTeacherAtSchool(actor, reward.schoolId);

  const redemptionCount = await prisma.redemption.count({ where: { rewardId } });
  if (redemptionCount > 0) {
    throw new Error(
      `Cannot delete reward "${reward.name}": ${redemptionCount} redemption(s) still reference it. Set active: false instead to hide it from the shop without losing redemption/audit history.`,
    );
  }
  await prisma.reward.delete({ where: { id: rewardId } });
}

/**
 * A student redeems a reward for themselves only — checked by direct
 * equality, same as lib/packing.ts's scan ownership check. Serializable
 * isolation (not the Postgres default READ COMMITTED) is required here:
 * two concurrent redemptions both reading the same balance before either
 * commits could otherwise both pass the balance check and overspend —
 * Serializable makes Postgres abort one of them instead. The same
 * isolation covers `stock` for free: two concurrent redemptions of the
 * last unit both read-then-write the same Reward row, so Postgres aborts
 * one with a serialization failure exactly like the balance race.
 *
 * That abort is correct, not a bug — but it's a real database error, not a
 * business rejection, so it's wrapped in `withSerializableRetry` (§7.4a):
 * the losing side retries against the now-committed state and almost
 * always either succeeds or lands on a clean "แต้มไม่พอ"/"ของรางวัลหมดแล้ว"
 * instead of surfacing a raw serialization-failure error to the student.
 */
export async function redeem(actor: Actor, rewardId: string) {
  if (!actor.studentId) throw new ForbiddenError("view_student", { type: "student", studentId: "" });
  const studentId = actor.studentId;

  return withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const reward = await tx.reward.findUniqueOrThrow({ where: { id: rewardId } });
        if (!reward.active) throw new Error("ของรางวัลนี้ปิดรับแลกแล้ว");
        if (reward.stock !== null && reward.stock <= 0) throw new Error("ของรางวัลหมดแล้ว");

        const current = await balance(studentId, tx);
        if (current < reward.cost) throw new Error("แต้มไม่พอ");

        // null stock means unlimited — nothing to decrement. Decrementing
        // inside this same transaction (not a separate read-then-write
        // outside it) is what makes the last-unit race safe.
        if (reward.stock !== null) {
          await tx.reward.update({ where: { id: rewardId }, data: { stock: { decrement: 1 } } });
        }

        const redemption = await tx.redemption.create({
          data: { studentId, rewardId, pointsSpent: reward.cost },
        });
        await tx.pointLedger.create({
          data: { studentId, delta: -reward.cost, reason: "REDEMPTION", refId: redemption.id },
        });
        return redemption;
      },
      { isolationLevel: "Serializable" },
    ),
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
