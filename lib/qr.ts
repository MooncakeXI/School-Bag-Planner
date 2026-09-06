import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { can, manageableSubjectsInClassroom, type Resource } from "./policy";
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

/**
 * Print-and-bind in one step: for every ItemCopy in the classroom (optionally
 * narrowed to one subject) that has no currently-ASSIGNED code, generates a
 * fresh code and binds it — so the printed sticker can already carry the
 * student's name and item name, and the separate manual "ผูกรหัส" step
 * disappears for a fresh classroom setup. An ItemCopy that already has an
 * ASSIGNED code is left untouched — rebinding is a deliberate, separate
 * action (invariant 3), never an implicit side effect of this bulk flow.
 *
 * Each code is bound via bindCode() itself, not a shortcut — so every
 * authorization check and state transition it enforces (subject/homeroom
 * scoping, code must be UNASSIGNED) applies here exactly as it does to a
 * single manual bind. No new authorization path.
 */
export async function generateAndBindCodesForClassroom(
  actor: Actor,
  params: { classroomId: string; subjectId?: string },
): Promise<string[]> {
  let subjectIds: string[];
  if (params.subjectId) {
    const resource: Resource = { type: "item_copy", classroomId: params.classroomId, subjectId: params.subjectId };
    if (!(await can(actor, "edit_item_copy", resource))) {
      throw new ForbiddenError("edit_item_copy", resource);
    }
    subjectIds = [params.subjectId];
  } else {
    // No subject chosen — narrow to whatever this actor may manage in this
    // classroom, so a subject teacher naturally gets stickers only for
    // their own subject without needing an explicit per-subject rejection.
    subjectIds = (await manageableSubjectsInClassroom(actor, params.classroomId)).map((s) => s.id);
  }
  if (subjectIds.length === 0) return [];

  const today = schoolDateToUtcMidnight(schoolToday());
  const unboundCopies = await prisma.itemCopy.findMany({
    where: {
      subjectItem: { subjectId: { in: subjectIds } },
      student: {
        enrollments: { some: { classroomId: params.classroomId, OR: [{ endDate: null }, { endDate: { gte: today } }] } },
      },
      qrCodes: { none: { state: "ASSIGNED" } },
    },
    select: { id: true },
  });

  const codes: string[] = [];
  for (const copy of unboundCopies) {
    const code = generateCode();
    await prisma.qRCode.create({ data: { code } });
    const bound = await bindCode(actor, { code, itemCopyId: copy.id });
    codes.push(bound.code);
  }
  return codes;
}

export async function requireTeacherAccessForItemCopy(actor: Actor, itemCopyId: string) {
  const itemCopy = await prisma.itemCopy.findUniqueOrThrow({
    where: { id: itemCopyId },
    select: { studentId: true, subjectItem: { select: { subjectId: true } } },
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

  const resource: Resource = {
    type: "item_copy",
    classroomId: enrollment.classroomId,
    subjectId: itemCopy.subjectItem.subjectId,
  };
  if (!(await can(actor, "edit_item_copy", resource))) {
    throw new ForbiddenError("edit_item_copy", resource);
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

/** Translates a bindCode/voidCode failure into a short Thai message for a
 * teacher-facing UI, without inventing any new rejection logic — every
 * case here is a failure bindCode/voidCode themselves already throw. */
function friendlyQrError(err: unknown): string {
  if (err instanceof ForbiddenError) return "คุณไม่มีสิทธิ์ทำรายการนี้";
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return "ไม่พบรหัสนี้ในระบบ ตรวจสอบว่าพิมพ์สติกเกอร์แผ่นนี้ไว้แล้วหรือยัง";
  }
  if (err instanceof Error && err.message.includes("is not available to bind")) {
    return "รหัสนี้ถูกใช้ไปแล้ว หรือถูกยกเลิกไปแล้ว ลองสติกเกอร์แผ่นอื่น";
  }
  return err instanceof Error ? err.message : "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
}

export type QrScanResult = { ok: true; itemCopyId: string; code: string } | { ok: false; error: string };

/**
 * Same bindCode as the manual-entry form path, wrapped for a camera-driven
 * scan UI that needs a result object instead of a thrown error (so it can
 * show inline feedback and keep the camera open, per app/teacher/classrooms/
 * [id]'s "scan to bind"/"rapid bind" modes) — no new authorization path,
 * this calls bindCode (and therefore requireTeacherAccessForItemCopy)
 * exactly as-is. Kept here, not in the route handler, so it stays testable
 * the same way bindCode itself is (CLAUDE.md: "server logic lives in lib/
 * as plain testable functions").
 */
export async function bindCodeWithResult(actor: Actor, params: { code: string; itemCopyId: string }): Promise<QrScanResult> {
  try {
    const bound = await bindCode(actor, params);
    return { ok: true, itemCopyId: params.itemCopyId, code: bound.code };
  } catch (err) {
    return { ok: false, error: friendlyQrError(err) };
  }
}

/** Same relationship to voidCode that bindCodeWithResult has to bindCode —
 * used by the scan flows' "undo last bind" action. */
export async function voidCodeWithResult(actor: Actor, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await voidCode(actor, code);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyQrError(err) };
  }
}
