import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  bindCode,
  bindCodeWithResult,
  createUnassignedCodes,
  generateAndBindCodesForClassroom,
  generateCode,
  rebindCode,
  voidCode,
  voidCodeWithResult,
} from "@/lib/qr";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

async function seedTeacherWithStudent(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: `Subject ${label}` } });
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

  it("denies binding to a subject the teacher doesn't teach, even within a classroom they do teach — real teachers are subject-specific", async () => {
    const school = await prisma.school.create({ data: { name: "School X" } });
    const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "Room X" } });
    const mathSubject = await prisma.subject.create({ data: { schoolId: school.id, name: "Math" } });
    const peSubject = await prisma.subject.create({ data: { schoolId: school.id, name: "PE" } });
    const peItem = await prisma.subjectItem.create({ data: { subjectId: peSubject.id, name: "PE Kit" } });

    const teacherUser = await prisma.user.create({ data: { email: "math-teacher@example.com" } });
    const teacher = await prisma.teacher.create({
      data: { userId: teacherUser.id, email: teacherUser.email!, name: "Math Teacher" },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: mathSubject.id },
    });
    const teacherActor: Actor = { userId: teacherUser.id, teacherId: teacher.id, parentId: null, studentId: null };

    const student = await prisma.student.create({ data: { name: "Kid" } });
    await prisma.enrollment.create({
      data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-05-01") },
    });
    const peItemCopy = await prisma.itemCopy.create({
      data: { studentId: student.id, subjectItemId: peItem.id, state: "WITH_STUDENT" },
    });

    // Printing spare stickers is school-wide, not subject-scoped, so this still succeeds.
    const [code] = await createUnassignedCodes(teacherActor, { schoolId: school.id, count: 1 });
    await expect(bindCode(teacherActor, { code, itemCopyId: peItemCopy.id })).rejects.toThrow();
  });
});

// The camera-driven "scan to bind"/"rapid bind" UI (app/teacher/classrooms/[id])
// goes through bindCodeWithResult/voidCodeWithResult instead of bindCode/voidCode
// directly — same lib/qr.ts functions underneath (bindCodeWithResult's only job
// is catching bindCode's throw and mapping it to a Thai message), so every
// rejection bindCode/voidCode themselves enforce must hold here too, just
// surfaced as `{ ok: false }` instead of a thrown error.
describe("bindCodeWithResult / voidCodeWithResult (the scan-to-bind entry path)", () => {
  beforeEach(resetDb);

  it("rejects an already-ASSIGNED code the same as bindCode does, regardless of entry path", async () => {
    const a = await seedTeacherWithStudent("A");
    const [code] = await createUnassignedCodes(a.teacherActor, { schoolId: a.school.id, count: 1 });

    const first = await bindCodeWithResult(a.teacherActor, { code, itemCopyId: a.itemCopy.id });
    expect(first.ok).toBe(true);

    const second = await bindCodeWithResult(a.teacherActor, { code, itemCopyId: a.itemCopy.id });
    expect(second.ok).toBe(false);
  });

  it("still enforces the subject-scoped denial — a PE teacher cannot bind a Math item via the scan path either", async () => {
    const school = await prisma.school.create({ data: { name: "School Y" } });
    const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: "Room Y" } });
    const mathSubject = await prisma.subject.create({ data: { schoolId: school.id, name: "Math" } });
    const peSubject = await prisma.subject.create({ data: { schoolId: school.id, name: "PE" } });
    const mathItem = await prisma.subjectItem.create({ data: { subjectId: mathSubject.id, name: "Math workbook" } });

    const peUser = await prisma.user.create({ data: { email: "pe-teacher-scan@example.com" } });
    const peTeacher = await prisma.teacher.create({
      data: { userId: peUser.id, email: peUser.email!, name: "PE Teacher" },
    });
    await prisma.teachingAssignment.create({
      data: { teacherId: peTeacher.id, classroomId: classroom.id, subjectId: peSubject.id },
    });
    const peActor: Actor = { userId: peUser.id, teacherId: peTeacher.id, parentId: null, studentId: null };

    const student = await prisma.student.create({ data: { name: "Kid" } });
    await prisma.enrollment.create({
      data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-05-01") },
    });
    const mathItemCopy = await prisma.itemCopy.create({
      data: { studentId: student.id, subjectItemId: mathItem.id, state: "WITH_STUDENT" },
    });

    const [code] = await createUnassignedCodes(peActor, { schoolId: school.id, count: 1 });
    const result = await bindCodeWithResult(peActor, { code, itemCopyId: mathItemCopy.id });
    expect(result.ok).toBe(false);

    // The code must still be UNASSIGNED — a failed bind attempt via the scan
    // path must not leave the code half-bound.
    const row = await prisma.qRCode.findUniqueOrThrow({ where: { code } });
    expect(row.state).toBe("UNASSIGNED");
  });

  it("undo (voidCodeWithResult) reverts a bind so the item can be scanned again", async () => {
    const a = await seedTeacherWithStudent("A");
    const [code] = await createUnassignedCodes(a.teacherActor, { schoolId: a.school.id, count: 1 });
    await bindCodeWithResult(a.teacherActor, { code, itemCopyId: a.itemCopy.id });

    const undone = await voidCodeWithResult(a.teacherActor, code);
    expect(undone.ok).toBe(true);

    const row = await prisma.qRCode.findUniqueOrThrow({ where: { code } });
    expect(row.state).toBe("VOID");

    // A fresh code can now be bound to the same item copy.
    const [freshCode] = await createUnassignedCodes(a.teacherActor, { schoolId: a.school.id, count: 1 });
    const rebind = await bindCodeWithResult(a.teacherActor, { code: freshCode, itemCopyId: a.itemCopy.id });
    expect(rebind.ok).toBe(true);
  });
});

async function seedClassroomWithTwoSubjects(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const mathSubject = await prisma.subject.create({ data: { schoolId: school.id, name: "Math" } });
  const peSubject = await prisma.subject.create({ data: { schoolId: school.id, name: "PE" } });
  const mathItem = await prisma.subjectItem.create({ data: { subjectId: mathSubject.id, name: "Math workbook" } });
  const peItem = await prisma.subjectItem.create({ data: { subjectId: peSubject.id, name: "PE kit" } });

  const mathUser = await prisma.user.create({ data: { email: `math-${label}@example.com` } });
  const mathTeacher = await prisma.teacher.create({
    data: { userId: mathUser.id, email: mathUser.email!, name: "Math Teacher" },
  });
  await prisma.teachingAssignment.create({
    data: { teacherId: mathTeacher.id, classroomId: classroom.id, subjectId: mathSubject.id },
  });
  const mathActor: Actor = { userId: mathUser.id, teacherId: mathTeacher.id, parentId: null, studentId: null };

  const student = await prisma.student.create({ data: { name: `Student ${label}` } });
  await prisma.enrollment.create({
    data: { studentId: student.id, classroomId: classroom.id, startDate: new Date("2026-05-01") },
  });
  const mathCopy = await prisma.itemCopy.create({
    data: { studentId: student.id, subjectItemId: mathItem.id, state: "WITH_STUDENT" },
  });
  const peCopy = await prisma.itemCopy.create({
    data: { studentId: student.id, subjectItemId: peItem.id, state: "WITH_STUDENT" },
  });

  return { school, classroom, mathSubject, peSubject, mathCopy, peCopy, mathActor };
}

// Print-and-bind in one step (app/teacher/classrooms/[id]/print-qr's "สร้างและ
// ผูกรหัส" flow) — every generated code still goes through bindCode() itself
// (§ generateAndBindCodesForClassroom's own doc comment), so it inherits
// every guarantee bindCode already enforces; these tests cover the new
// bulk-scoping behavior layered on top of that.
describe("generateAndBindCodesForClassroom (print-and-bind)", () => {
  beforeEach(resetDb);

  it("binds exactly the unbound copies and leaves an already-bound copy untouched", async () => {
    const a = await seedTeacherWithStudent("A");
    const student2 = await prisma.student.create({ data: { name: "Student A2" } });
    await prisma.enrollment.create({
      data: { studentId: student2.id, classroomId: a.classroom.id, startDate: new Date("2026-05-01") },
    });
    const copy2 = await prisma.itemCopy.create({
      data: { studentId: student2.id, subjectItemId: a.itemCopy.subjectItemId, state: "WITH_STUDENT" },
    });

    const [preboundCode] = await createUnassignedCodes(a.teacherActor, { schoolId: a.school.id, count: 1 });
    await bindCode(a.teacherActor, { code: preboundCode, itemCopyId: a.itemCopy.id });

    const codes = await generateAndBindCodesForClassroom(a.teacherActor, { classroomId: a.classroom.id });
    expect(codes).toHaveLength(1); // only copy2 was unbound

    // The already-bound copy keeps its exact original code — never rebound.
    const copy1Codes = await prisma.qRCode.findMany({ where: { itemCopyId: a.itemCopy.id } });
    expect(copy1Codes).toHaveLength(1);
    expect(copy1Codes[0].code).toBe(preboundCode);

    const copy2Codes = await prisma.qRCode.findMany({ where: { itemCopyId: copy2.id, state: "ASSIGNED" } });
    expect(copy2Codes).toHaveLength(1);
    expect(codes[0]).toBe(copy2Codes[0].code);
  });

  it("a subject teacher only gets stickers for their own subject's items when no subject is chosen", async () => {
    const a = await seedClassroomWithTwoSubjects("A");

    const codes = await generateAndBindCodesForClassroom(a.mathActor, { classroomId: a.classroom.id });
    expect(codes).toHaveLength(1);

    const mathCode = await prisma.qRCode.findFirst({ where: { itemCopyId: a.mathCopy.id, state: "ASSIGNED" } });
    expect(mathCode?.code).toBe(codes[0]);
    const peCode = await prisma.qRCode.findFirst({ where: { itemCopyId: a.peCopy.id } });
    expect(peCode).toBeNull();
  });

  it("rejects an explicit subjectId the teacher doesn't teach, rather than silently skipping it", async () => {
    const a = await seedClassroomWithTwoSubjects("B");

    await expect(
      generateAndBindCodesForClassroom(a.mathActor, { classroomId: a.classroom.id, subjectId: a.peSubject.id }),
    ).rejects.toThrow();

    const peCode = await prisma.qRCode.findFirst({ where: { itemCopyId: a.peCopy.id } });
    expect(peCode).toBeNull();
  });
});
