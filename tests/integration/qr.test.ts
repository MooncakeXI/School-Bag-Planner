import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { bindCode, createUnassignedCodes, generateCode, rebindCode, voidCode } from "@/lib/qr";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

async function seedTeacherWithStudent(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { name: `Subject ${label}` } });
  const subjectItem = await prisma.subjectItem.create({ data: { subjectId: subject.id, name: `Item ${label}` } });

  const teacherUser = await prisma.user.create({ data: { email: `teacher-${label}@example.com` } });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, email: teacherUser.email!, name: `Teacher ${label}` },
  });
  await prisma.teachingAssignment.create({
    data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: subject.id },
  });

  const student = await prisma.student.create({ data: { name: `Student ${label}` } });
  await prisma.enrollment.create({
    data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-05-01") },
  });
  const itemCopy = await prisma.itemCopy.create({
    data: { studentId: student.id, subjectItemId: subjectItem.id, state: "WITH_STUDENT" },
  });

  const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };
  return { school, classroom, teacherActor, itemCopy };
}

describe("generateCode", () => {
  it("produces an opaque bk_-prefixed code (invariant 2: no embedded data)", () => {
    const code = generateCode();
    expect(code).toMatch(/^bk_[A-Z0-9]{12}$/);
  });

  it("is not predictable/sequential across calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateCode()));
    expect(codes.size).toBe(20);
  });
});

describe("QR lifecycle", () => {
  beforeEach(resetDb);

  it("creates UNASSIGNED codes only for a teacher who teaches in that school", async () => {
    const a = await seedTeacherWithStudent("A");
    const b = await seedTeacherWithStudent("B");

    const codes = await createUnassignedCodes(a.teacherActor, { schoolId: a.school.id, count: 3 });
    expect(codes).toHaveLength(3);

    const rows = await prisma.qRCode.findMany({ where: { code: { in: codes } } });
    expect(rows.every((r) => r.state === "UNASSIGNED" && r.itemCopyId === null)).toBe(true);

    await expect(createUnassignedCodes(b.teacherActor, { schoolId: a.school.id, count: 1 })).rejects.toThrow();
  });

  it("binds an unassigned code to an item copy, and rejects binding an already-assigned code", async () => {
    const a = await seedTeacherWithStudent("A");
    const [code] = await createUnassignedCodes(a.teacherActor, { schoolId: a.school.id, count: 1 });

    const bound = await bindCode(a.teacherActor, { code, itemCopyId: a.itemCopy.id });
    expect(bound.state).toBe("ASSIGNED");
    expect(bound.itemCopyId).toBe(a.itemCopy.id);
    expect(bound.boundAt).not.toBeNull();

    await expect(bindCode(a.teacherActor, { code, itemCopyId: a.itemCopy.id })).rejects.toThrow();
  });

  it("denies binding when the actor doesn't teach the item's classroom", async () => {
    const a = await seedTeacherWithStudent("A");
    const b = await seedTeacherWithStudent("B");
    const [code] = await createUnassignedCodes(a.teacherActor, { schoolId: a.school.id, count: 1 });

    await expect(bindCode(b.teacherActor, { code, itemCopyId: a.itemCopy.id })).rejects.toThrow();
  });

  it("rebinding voids the old code (keeping its itemCopyId for history) and assigns the new one — invariant 3", async () => {
    const a = await seedTeacherWithStudent("A");
    const [oldCode, newCode] = await createUnassignedCodes(a.teacherActor, { schoolId: a.school.id, count: 2 });
    await bindCode(a.teacherActor, { code: oldCode, itemCopyId: a.itemCopy.id });

    const rebound = await rebindCode(a.teacherActor, { itemCopyId: a.itemCopy.id, newCode });
    expect(rebound.state).toBe("ASSIGNED");
    expect(rebound.code).toBe(newCode);

    const old = await prisma.qRCode.findUniqueOrThrow({ where: { code: oldCode } });
    expect(old.state).toBe("VOID");
    expect(old.itemCopyId).toBe(a.itemCopy.id); // history preserved, not nulled out

    const assignedCodes = await prisma.qRCode.findMany({ where: { itemCopyId: a.itemCopy.id, state: "ASSIGNED" } });
    expect(assignedCodes).toHaveLength(1);
    expect(assignedCodes[0].code).toBe(newCode);
  });

  it("voids a bound code directly, leaving the item with no current code", async () => {
    const a = await seedTeacherWithStudent("A");
    const [code] = await createUnassignedCodes(a.teacherActor, { schoolId: a.school.id, count: 1 });
    await bindCode(a.teacherActor, { code, itemCopyId: a.itemCopy.id });

    const voided = await voidCode(a.teacherActor, code);
    expect(voided.state).toBe("VOID");
    expect(voided.itemCopyId).toBe(a.itemCopy.id);

    const assignedCodes = await prisma.qRCode.findMany({ where: { itemCopyId: a.itemCopy.id, state: "ASSIGNED" } });
    expect(assignedCodes).toHaveLength(0);
  });

  it("denies voiding a bound code for a teacher outside that classroom", async () => {
    const a = await seedTeacherWithStudent("A");
    const b = await seedTeacherWithStudent("B");
    const [code] = await createUnassignedCodes(a.teacherActor, { schoolId: a.school.id, count: 1 });
    await bindCode(a.teacherActor, { code, itemCopyId: a.itemCopy.id });

    await expect(voidCode(b.teacherActor, code)).rejects.toThrow();
  });
});
