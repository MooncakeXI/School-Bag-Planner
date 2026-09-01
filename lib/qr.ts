import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { can, type Resource } from "./policy";
import { ForbiddenError } from "./errors";
import { schoolDateToUtcMidnight, schoolToday } from "./time";
import type { Actor } from "./actor";

// Opaque, unguessable — invariant 2: never encode student_id/subject/
// anything meaningful in the code itself.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function generateCode(): string {
  const bytes = randomBytes(12);
  let suffix = "";
  for (const byte of bytes) suffix += ALPHABET[byte % ALPHABET.length];
  return `bk_${suffix}`;
}

export async function createUnassignedCodes(actor: Actor, params: { schoolId: string; count: number }) {
  const resource: Resource = { type: "school", schoolId: params.schoolId };
  if (!(await can(actor, "edit_exceptions", resource))) {
    throw new ForbiddenError("edit_exceptions", resource);
  }
  if (params.count < 1 || params.count > 200) {
    throw new Error("count must be between 1 and 200");
  }

  const codes = Array.from({ length: params.count }, () => generateCode());
  await prisma.qRCode.createMany({ data: codes.map((code) => ({ code })) });
  return codes;
}

export async function requireTeacherAccessForItemCopy(actor: Actor, itemCopyId: string) {
  const itemCopy = await prisma.itemCopy.findUniqueOrThrow({
    where: { id: itemCopyId },
    select: { studentId: true },
  });
  const enrollment = await prisma.enrollment.findFirst({
    where: {
      studentId: itemCopy.studentId,
      OR: [{ endDate: null }, { endDate: { gte: schoolDateToUtcMidnight(schoolToday()) } }],
    },
    orderBy: { startDate: "desc" },
    select: { classroomId: true },
  });
  if (!enrollment) throw new Error("Student has no active enrollment");

  const resource: Resource = { type: "classroom", classroomId: enrollment.classroomId };
  if (!(await can(actor, "edit_roster", resource))) {
    throw new ForbiddenError("edit_roster", resource);
  }
}

/** Binds an UNASSIGNED code to an item copy that has no current code. */
export async function bindCode(actor: Actor, params: { code: string; itemCopyId: string }) {
  await requireTeacherAccessForItemCopy(actor, params.itemCopyId);

  return prisma.$transaction(async (tx) => {
    const code = await tx.qRCode.findUniqueOrThrow({ where: { code: params.code } });
    if (code.state !== "UNASSIGNED") {
      throw new Error(`Code ${params.code} is not available to bind (state: ${code.state})`);
    }
    return tx.qRCode.update({
      where: { code: params.code },
      data: { state: "ASSIGNED", itemCopyId: params.itemCopyId, boundAt: new Date() },
    });
  });
}

/**
 * Replaces whichever code is currently bound to an item copy with a new
 * one — invariant 3: the old code becomes VOID (kept, for history) rather
 * than deleted or reused; the ItemCopy itself never changes identity.
 */
export async function rebindCode(actor: Actor, params: { itemCopyId: string; newCode: string }) {
  await requireTeacherAccessForItemCopy(actor, params.itemCopyId);

  return prisma.$transaction(async (tx) => {
    await tx.qRCode.updateMany({
      where: { itemCopyId: params.itemCopyId, state: "ASSIGNED" },
      data: { state: "VOID" },
    });

    const newCode = await tx.qRCode.findUniqueOrThrow({ where: { code: params.newCode } });
    if (newCode.state !== "UNASSIGNED") {
      throw new Error(`Code ${params.newCode} is not available to bind (state: ${newCode.state})`);
    }
    return tx.qRCode.update({
      where: { code: params.newCode },
      data: { state: "ASSIGNED", itemCopyId: params.itemCopyId, boundAt: new Date() },
    });
  });
}

/** Marks a code VOID directly — the sticker was lost/torn, no replacement bound yet. */
export async function voidCode(actor: Actor, code: string) {
  const existing = await prisma.qRCode.findUniqueOrThrow({ where: { code } });
  if (existing.itemCopyId) {
    // Bound to a real student — scope the check to that classroom.
    await requireTeacherAccessForItemCopy(actor, existing.itemCopyId);
  } else if (!actor.teacherId) {
    // Never bound to anyone — voiding a spare printed sticker isn't
    // student-scoped, so any teacher may do it.
    throw new Error("Only a teacher may void a QR code");
  }
  return prisma.qRCode.update({ where: { code }, data: { state: "VOID" } });
}

export async function currentCodeForItemCopy(itemCopyId: string) {
  return prisma.qRCode.findFirst({ where: { itemCopyId, state: "ASSIGNED" } });
}
