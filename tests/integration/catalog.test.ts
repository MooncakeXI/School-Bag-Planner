import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createSubject, createSubjectItem, deleteSubject, deleteSubjectItem } from "@/lib/catalog";
import { requiredItemsFor } from "@/lib/required-items";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

async function seedTeacherAtSchool(label: string) {
  const school = await prisma.school.create({ data: { name: `School ${label}` } });
  const classroom = await prisma.classroom.create({ data: { schoolId: school.id, name: `Room ${label}` } });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, name: `Subject ${label}` } });

  const user = await prisma.user.create({ data: { email: `teacher-${label}@example.com` } });
  const teacher = await prisma.teacher.create({ data: { userId: user.id, email: user.email!, name: `Teacher ${label}` } });
  await prisma.teachingAssignment.create({ data: { teacherId: teacher.id, classroomId: classroom.id, subjectId: subject.id } });

  const actor: Actor = { userId: user.id, teacherId: teacher.id, parentId: null, studentId: null };
  return { school, classroom, subject, actor };
}

describe("lib/catalog.ts", () => {
  beforeEach(resetDb);

  it("lets a teacher at that school manage its subject catalog", async () => {
    const a = await seedTeacherAtSchool("A");

    const subject = await createSubject(a.actor, a.school.id, "New Subject");
    expect(subject.schoolId).toBe(a.school.id);
    const item = await createSubjectItem(a.actor, subject.id, "New Item");
    expect(item.subjectId).toBe(subject.id);
  });

  it("denies catalog edits to a non-teacher actor", async () => {
    const a = await seedTeacherAtSchool("A");
    const nobody: Actor = { userId: "x", teacherId: null, parentId: null, studentId: null };
    await expect(createSubject(nobody, a.school.id, "Nope")).rejects.toThrow();
  });

  it("denies a teacher at one school from touching another school's catalog — the multi-tenancy fix", async () => {
    const a = await seedTeacherAtSchool("A");
    const b = await seedTeacherAtSchool("B");

    // b's teacher cannot create in a's school...
    await expect(createSubject(b.actor, a.school.id, "Intruder Subject")).rejects.toThrow();
    // ...nor rename or delete an existing subject that belongs to a's school.
    await expect(prisma.subject.findUniqueOrThrow({ where: { id: a.subject.id } })).resolves.toBeDefined();
    const { renameSubject } = await import("@/lib/catalog");
    await expect(renameSubject(b.actor, a.subject.id, "Hijacked")).rejects.toThrow();
    await expect(deleteSubject(b.actor, a.subject.id)).rejects.toThrow();
  });

  it("deleteSubject archives by default — nothing is actually removed", async () => {
    const a = await seedTeacherAtSchool("A");
    const item = await createSubjectItem(a.actor, a.subject.id, "Item");

    const archived = await deleteSubject(a.actor, a.subject.id);
    expect(archived.archivedAt).not.toBeNull();

    const stillThere = await prisma.subjectItem.findUnique({ where: { id: item.id } });
    expect(stillThere).not.toBeNull();
  });

  it("hard delete is blocked when an ItemCopy still exists, and names what's blocking it", async () => {
    const a = await seedTeacherAtSchool("A");
    const item = await createSubjectItem(a.actor, a.subject.id, "Workbook");

    const student = await prisma.student.create({ data: { name: "Kid" } });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: item.id, state: "WITH_STUDENT" } });

    await expect(deleteSubjectItem(a.actor, item.id, { hard: true })).rejects.toThrow(/item cop/i);
    await expect(deleteSubject(a.actor, a.subject.id, { hard: true })).rejects.toThrow(/item cop/i);

    // Nothing was touched by the failed hard deletes.
    expect(await prisma.subjectItem.findUnique({ where: { id: item.id } })).not.toBeNull();
    expect(await prisma.subject.findUnique({ where: { id: a.subject.id } })).not.toBeNull();
  });

  it("hard delete succeeds once nothing references the subject item", async () => {
    const a = await seedTeacherAtSchool("A");
    const item = await createSubjectItem(a.actor, a.subject.id, "Unused Item");

    await deleteSubjectItem(a.actor, item.id, { hard: true });
    expect(await prisma.subjectItem.findUnique({ where: { id: item.id } })).toBeNull();
  });

  it("an archived SubjectItem is hidden from the catalog listing but still resolves through an existing ItemCopy", async () => {
    const a = await seedTeacherAtSchool("A");
    const item = await createSubjectItem(a.actor, a.subject.id, "Old Workbook");

    const student = await prisma.student.create({ data: { name: "Kid" } });
    const DATE = "2026-06-01"; // a Monday
    const term = await prisma.term.create({
      data: { schoolId: a.school.id, name: "Term", startDate: new Date("2026-05-01"), endDate: new Date("2026-10-01") },
    });
    await prisma.enrollment.create({ data: { studentId: student.id, classroomId: a.classroom.id, startDate: new Date("2026-05-01") } });
    await prisma.timetableSlot.create({
      data: { termId: term.id, classroomId: a.classroom.id, weekday: "MON", period: 1, subjectId: a.subject.id },
    });
    await prisma.itemCopy.create({ data: { studentId: student.id, subjectItemId: item.id, state: "WITH_STUDENT" } });

    await deleteSubjectItem(a.actor, item.id); // archive, not hard delete

    // Hidden from the catalog listing (the query app/teacher/subjects/page.tsx uses).
    const listed = await prisma.subjectItem.findMany({ where: { subjectId: a.subject.id, archivedAt: null } });
    expect(listed).toHaveLength(0);

    // But a student who already has a live ItemCopy of it still gets told to pack it —
    // archiving stops NEW assignment, it does not retroactively hide what already exists.
    const required = await requiredItemsFor(student.id, DATE);
    expect(required.items.map((i) => i.subjectItemId)).toContain(item.id);
  });
});
