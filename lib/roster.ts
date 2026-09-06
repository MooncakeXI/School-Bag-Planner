import bcrypt from "bcryptjs";
import type { ItemCopyState } from "@prisma/client";
import { prisma } from "./prisma";
import { can, type Resource } from "./policy";
import { ForbiddenError } from "./errors";
import { schoolDateToUtcMidnight, schoolToday } from "./time";
import { generateUniqueStudentCode, generatePassword } from "./student-auth";
import { requireTeacherAccessForItemCopy } from "./qr";
import type { Actor } from "./actor";

export async function createStudent(actor: Actor, classroomId: string, name: string) {
  if (!(await can(actor, "edit_roster", { type: "classroom", classroomId }))) {
    throw new ForbiddenError("edit_roster", { type: "classroom", classroomId });
  }
  return prisma.$transaction(async (tx) => {
    const student = await tx.student.create({ data: { name } });
    await tx.enrollment.create({
      data: { studentId: student.id, classroomId, startDate: schoolDateToUtcMidnight(schoolToday()) },
    });
    return student;
  });
}

async function requireClassroomAccessForStudent(
  actor: Actor,
  studentId: string,
  action: "edit_roster" | "edit_student_account",
): Promise<string> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, OR: [{ endDate: null }, { endDate: { gte: schoolDateToUtcMidnight(schoolToday()) } }] },
    orderBy: { startDate: "desc" },
    select: { classroomId: true },
  });
  if (!enrollment) throw new Error("Student has no active enrollment");

  const resource: Resource = { type: "classroom", classroomId: enrollment.classroomId };
  if (!(await can(actor, action, resource))) {
    throw new ForbiddenError(action, resource);
  }
  return enrollment.classroomId;
}

function requireRosterAccessForStudent(actor: Actor, studentId: string): Promise<string> {
  return requireClassroomAccessForStudent(actor, studentId, "edit_roster");
}

/** Homeroom-only: unlike the rest of roster management, any subject
 * teacher in the classroom must NOT be able to link a parent, reset a
 * student's login, or (lib/packing.ts's recordTeacherScan) run the
 * teacher-driven packing flow on a student's behalf — only ครูประจำชั้น
 * (the homeroom teacher). Exported specifically so recordTeacherScan (and
 * the page that gates access to it) can reuse this exact check — resolved
 * from the student's own current classroom, not any classroomId a caller
 * might otherwise supply, so it can't be pointed at the wrong classroom. */
export function requireHomeroomAccessForStudent(actor: Actor, studentId: string): Promise<string> {
  return requireClassroomAccessForStudent(actor, studentId, "edit_student_account");
}

export async function linkParent(actor: Actor, studentId: string, params: { email: string; name: string }) {
  await requireHomeroomAccessForStudent(actor, studentId);

  const parent = await prisma.parent.upsert({
    where: { email: params.email },
    create: { email: params.email, name: params.name },
    update: {},
  });
  await prisma.guardianship.upsert({
    where: { parentId_studentId: { parentId: parent.id, studentId } },
    create: { parentId: parent.id, studentId },
    update: {},
  });
  return parent;
}

export async function setItemCopyState(actor: Actor, itemCopyId: string, state: ItemCopyState) {
  await requireTeacherAccessForItemCopy(actor, itemCopyId);
  return prisma.itemCopy.update({ where: { id: itemCopyId }, data: { state } });
}

/**
 * The classroom-wide counterpart to setItemCopyState — used by the "today"
 * dashboard's collection panel to mark a whole class's copies of one
 * SubjectItem as collected (GRADING) or returned (WITH_STUDENT) in a single
 * tap, instead of one student at a time on the roster page. Same
 * subject-scoped `edit_item_copy` check as every other item-copy action —
 * no new authorization shape, and invariant 5 (GRADING suppresses the item
 * from the packing list) is exactly what already makes "collected" mean
 * something; this is only a bulk way to set the same field.
 *
 * Scoped to currently-enrolled students only, and only to copies that exist
 * (createItemCopy is a separate, deliberate action — this never creates
 * one), so re-running it after enrollment changes or partial onboarding is
 * always safe.
 */
export async function bulkSetItemCopyStateForClassroom(
  actor: Actor,
  params: { classroomId: string; subjectItemId: string; state: ItemCopyState },
) {
  const subjectItem = await prisma.subjectItem.findUniqueOrThrow({
    where: { id: params.subjectItemId },
    select: { subjectId: true },
  });
  const resource: Resource = { type: "item_copy", classroomId: params.classroomId, subjectId: subjectItem.subjectId };
  if (!(await can(actor, "edit_item_copy", resource))) {
    throw new ForbiddenError("edit_item_copy", resource);
  }

  const today = schoolDateToUtcMidnight(schoolToday());
  const result = await prisma.itemCopy.updateMany({
    where: {
      subjectItemId: params.subjectItemId,
      student: {
        enrollments: { some: { classroomId: params.classroomId, OR: [{ endDate: null }, { endDate: { gte: today } }] } },
      },
    },
    data: { state: params.state },
  });
  return { updated: result.count };
}

/** Same subject-scoped check as requireTeacherAccessForItemCopy, but there's
 * no itemCopyId yet to look the subject up from — it comes from the new
 * copy's own subjectItemId instead. */
export async function createItemCopy(actor: Actor, params: { studentId: string; subjectItemId: string }) {
  const classroomId = await requireRosterAccessForStudent(actor, params.studentId);
  const subjectItem = await prisma.subjectItem.findUniqueOrThrow({
    where: { id: params.subjectItemId },
    select: { subjectId: true, archivedAt: true },
  });
  if (subjectItem.archivedAt) {
    throw new Error("This item has been archived and can no longer be assigned to a new copy.");
  }
  const resource: Resource = { type: "item_copy", classroomId, subjectId: subjectItem.subjectId };
  if (!(await can(actor, "edit_item_copy", resource))) {
    throw new ForbiddenError("edit_item_copy", resource);
  }
  return prisma.itemCopy.create({
    data: { studentId: params.studentId, subjectItemId: params.subjectItemId, state: "WITH_STUDENT" },
  });
}

/**
 * Bulk version of createItemCopy for onboarding a whole classroom at once
 * (~40 students × 8 items = 320 copies per classroom otherwise typed one at
 * a time). Authorization is per subject item, not classroom-wide — a
 * subject teacher only passes for their own subject's items — and all-or-
 * nothing: if any single item fails the check, nothing is created.
 * Existing copies are skipped via skipDuplicates on the same
 * [subjectItemId, studentId] unique constraint createItemCopy relies on,
 * so re-running this for the same classroom/items is always a safe no-op.
 */
export async function createItemCopiesForClassroom(
  actor: Actor,
  params: { classroomId: string; subjectItemIds: string[] },
) {
  const subjectItems = await prisma.subjectItem.findMany({
    where: { id: { in: params.subjectItemIds }, archivedAt: null },
    select: { id: true, subjectId: true },
  });
  for (const si of subjectItems) {
    const resource: Resource = { type: "item_copy", classroomId: params.classroomId, subjectId: si.subjectId };
    if (!(await can(actor, "edit_item_copy", resource))) {
      throw new ForbiddenError("edit_item_copy", resource);
    }
  }

  const today = schoolDateToUtcMidnight(schoolToday());
  const students = await prisma.student.findMany({
    where: { enrollments: { some: { classroomId: params.classroomId, OR: [{ endDate: null }, { endDate: { gte: today } }] } } },
    select: { id: true },
  });

  const data = students.flatMap((student) =>
    subjectItems.map((si) => ({ studentId: student.id, subjectItemId: si.id, state: "WITH_STUDENT" as const })),
  );
  const result = await prisma.itemCopy.createMany({ data, skipDuplicates: true });
  return { created: result.count, skipped: data.length - result.count };
}

/**
 * Issues (or resets) a student's login code + password. Homeroom-teacher-only
 * (see requireHomeroomAccessForStudent) — parents stay read-only (CLAUDE.md).
 * Returns the plaintext once; only the bcrypt hash is ever persisted, so this
 * is the only chance to see it — the caller must show it to the teacher
 * immediately.
 */
export async function issueStudentCredentials(actor: Actor, studentId: string) {
  await requireHomeroomAccessForStudent(actor, studentId);

  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { studentCode: true } });
  const studentCode = student.studentCode ?? (await generateUniqueStudentCode());
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.student.update({
    where: { id: studentId },
    data: { studentCode, passwordHash, failedLoginAttempts: 0, nextLoginAttemptAt: null },
  });

  return { studentCode, password };
}
