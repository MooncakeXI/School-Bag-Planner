import bcrypt from "bcryptjs";
import type { ItemCopyState } from "@prisma/client";
import { prisma } from "./prisma";
import { can, type Resource } from "./policy";
import { ForbiddenError } from "./errors";
import { schoolDateToUtcMidnight, schoolToday } from "./time";
import { generateUniqueStudentCode, generatePassword } from "./student-auth";
import type { Actor } from "./actor";

export async function createClassroom(
  actor: Actor,
  params: { schoolId: string; name: string; subjectIds: string[] },
) {
  const resource: Resource = { type: "school", schoolId: params.schoolId };
  if (!(await can(actor, "edit_roster", resource))) {
    throw new ForbiddenError("edit_roster", resource);
  }
  if (params.subjectIds.length === 0) {
    throw new Error("A new classroom needs at least one subject so its creator can teach it");
  }

  return prisma.$transaction(async (tx) => {
    const classroom = await tx.classroom.create({
      data: { schoolId: params.schoolId, name: params.name },
    });
    await tx.teachingAssignment.createMany({
      data: params.subjectIds.map((subjectId) => ({
        teacherId: actor.teacherId!,
        classroomId: classroom.id,
        subjectId,
      })),
    });
    return classroom;
  });
}

export async function renameClassroom(actor: Actor, classroomId: string, name: string) {
  if (!(await can(actor, "edit_roster", { type: "classroom", classroomId }))) {
    throw new ForbiddenError("edit_roster", { type: "classroom", classroomId });
  }
  return prisma.classroom.update({ where: { id: classroomId }, data: { name } });
}

export async function deleteClassroom(actor: Actor, classroomId: string) {
  if (!(await can(actor, "edit_roster", { type: "classroom", classroomId }))) {
    throw new ForbiddenError("edit_roster", { type: "classroom", classroomId });
  }
  await prisma.classroom.delete({ where: { id: classroomId } });
}

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

async function requireRosterAccessForStudent(actor: Actor, studentId: string): Promise<string> {
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, OR: [{ endDate: null }, { endDate: { gte: schoolDateToUtcMidnight(schoolToday()) } }] },
    orderBy: { startDate: "desc" },
    select: { classroomId: true },
  });
  if (!enrollment) throw new Error("Student has no active enrollment");

  const resource: Resource = { type: "classroom", classroomId: enrollment.classroomId };
  if (!(await can(actor, "edit_roster", resource))) {
    throw new ForbiddenError("edit_roster", resource);
  }
  return enrollment.classroomId;
}

export async function transferStudent(actor: Actor, studentId: string, toClassroomId: string) {
  const fromClassroomId = await requireRosterAccessForStudent(actor, studentId);
  // Must also be allowed to add students to the destination classroom.
  if (!(await can(actor, "edit_roster", { type: "classroom", classroomId: toClassroomId }))) {
    throw new ForbiddenError("edit_roster", { type: "classroom", classroomId: toClassroomId });
  }
  if (fromClassroomId === toClassroomId) return;

  const today = schoolDateToUtcMidnight(schoolToday());
  await prisma.$transaction([
    prisma.enrollment.updateMany({
      where: { studentId, classroomId: fromClassroomId, endDate: null },
      data: { endDate: today },
    }),
    prisma.enrollment.create({ data: { studentId, classroomId: toClassroomId, startDate: today } }),
  ]);
}

export async function withdrawStudent(actor: Actor, studentId: string) {
  const classroomId = await requireRosterAccessForStudent(actor, studentId);
  const today = schoolDateToUtcMidnight(schoolToday());
  await prisma.enrollment.updateMany({
    where: { studentId, classroomId, endDate: null },
    data: { endDate: today },
  });
}

export async function linkParent(actor: Actor, studentId: string, params: { email: string; name: string }) {
  await requireRosterAccessForStudent(actor, studentId);

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
  const itemCopy = await prisma.itemCopy.findUniqueOrThrow({
    where: { id: itemCopyId },
    select: { studentId: true },
  });
  await requireRosterAccessForStudent(actor, itemCopy.studentId);
  return prisma.itemCopy.update({ where: { id: itemCopyId }, data: { state } });
}

export async function createItemCopy(actor: Actor, params: { studentId: string; subjectItemId: string }) {
  await requireRosterAccessForStudent(actor, params.studentId);
  return prisma.itemCopy.create({
    data: { studentId: params.studentId, subjectItemId: params.subjectItemId, state: "WITH_STUDENT" },
  });
}

/**
 * Issues (or resets) a student's login code + password. Teacher-only, same
 * roster-scoped check as every other student-administration action here —
 * parents stay read-only (CLAUDE.md). Returns the plaintext once; only the
 * bcrypt hash is ever persisted, so this is the only chance to see it —
 * the caller must show it to the teacher immediately.
 */
export async function issueStudentCredentials(actor: Actor, studentId: string) {
  await requireRosterAccessForStudent(actor, studentId);

  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { studentCode: true } });
  const studentCode = student.studentCode ?? (await generateUniqueStudentCode());
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.student.update({
    where: { id: studentId },
    data: { studentCode, passwordHash, failedLoginAttempts: 0, lockedUntil: null },
  });

  return { studentCode, password };
}
