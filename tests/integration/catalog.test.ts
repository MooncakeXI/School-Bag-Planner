import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createSubject, createSubjectItem, deleteSubject } from "@/lib/catalog";
import type { Actor } from "@/lib/actor";
import { resetDb } from "../db-utils";

describe("lib/catalog.ts", () => {
  beforeEach(resetDb);

  it("lets any teacher manage the shared subject catalog (deliberate coarse-grained exception)", async () => {
    const user = await prisma.user.create({ data: { email: "t@example.com" } });
    const teacher = await prisma.teacher.create({ data: { userId: user.id, email: user.email!, name: "T" } });
    const actor: Actor = { userId: user.id, teacherId: teacher.id, parentId: null, studentId: null };

    const subject = await createSubject(actor, "New Subject");
    const item = await createSubjectItem(actor, subject.id, "New Item");
    expect(item.subjectId).toBe(subject.id);

    await deleteSubject(actor, subject.id);
    const remaining = await prisma.subjectItem.findUnique({ where: { id: item.id } });
    expect(remaining).toBeNull(); // cascades
  });

  it("denies catalog edits to a non-teacher actor", async () => {
    const nobody: Actor = { userId: "x", teacherId: null, parentId: null, studentId: null };
    await expect(createSubject(nobody, "Nope")).rejects.toThrow();
  });
});
